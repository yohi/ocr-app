import assert from 'node:assert/strict';
import { execFile as nodeExecFile, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { buildReviewContext } from './prepare-ocr-review-context.mjs';
import { validateReviewResult } from './validate-ocr-result.mjs';
import {
  validateOpenCodeReviewPreview,
  validateOpenCodeReviewRules,
} from './opencodereview-contract.mjs';

const execFile = promisify(nodeExecFile);
const EXPECTED_REVIEWABLE_PATHS = ['README.md'];
const EXPECTED_EXCLUDED_PATHS = ['notes.md'];
const INITIAL_README = '# OpenCodeReview contract fixture\n\nOriginal text.\n';
const UPDATED_README = `${INITIAL_README}\nChanged content for the contract check.\n`;
const EXCLUDED_MARKDOWN = '# Outside the configured include patterns\n\nExcluded fixture.\n';

export function getExecutablePaths(env = process.env) {
  return {
    git: '/usr/bin/git',
    ocr: join(env.HOME, '.local/bin/ocr'),
  };
}

function runGit(args, cwd, gitExecutable) {
  return execFileSync(gitExecutable, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function parseCliJson(output, errorCode) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(errorCode);
  }
}

async function createFixture(root, gitExecutable) {
  const repoPath = join(root, 'target-repo');
  const remotePath = join(root, 'origin.git');
  await mkdir(repoPath);
  runGit(['init', '--quiet', '--bare', remotePath], root, gitExecutable);
  runGit(['init', '--quiet', '--initial-branch=main', repoPath], root, gitExecutable);
  runGit(['config', 'user.name', 'OpenCodeReview Contract Check'], repoPath, gitExecutable);
  runGit(['config', 'user.email', 'opencodereview-contract@localhost'], repoPath, gitExecutable);

  await writeFile(join(repoPath, 'README.md'), INITIAL_README);
  runGit(['add', 'README.md'], repoPath, gitExecutable);
  runGit(['commit', '--quiet', '-m', 'contract fixture base'], repoPath, gitExecutable);
  runGit(['remote', 'add', 'origin', remotePath], repoPath, gitExecutable);
  runGit(['push', '--quiet', '--set-upstream', 'origin', 'main'], repoPath, gitExecutable);

  await writeFile(join(repoPath, 'README.md'), UPDATED_README);
  await writeFile(join(repoPath, 'notes.md'), EXCLUDED_MARKDOWN);
  runGit(['add', 'README.md', 'notes.md'], repoPath, gitExecutable);
  runGit(['commit', '--quiet', '-m', 'contract fixture change'], repoPath, gitExecutable);

  return { repoPath, commitSha: runGit(['rev-parse', 'HEAD'], repoPath, gitExecutable) };
}

export async function checkOpenCodeReviewContract({
  env = process.env,
  runCommand = execFile,
} = {}) {
  const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
  const rulePath = resolve(scriptsDirectory, '../config/markdown-review-rules.json');
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'opencodereview-contract-'));
  const executables = getExecutablePaths(env);

  try {
    const { repoPath, commitSha } = await createFixture(temporaryDirectory, executables.git);
    const cliEnv = { ...env, OCR_NO_UPDATE: '1' };
    const previewOutput = execFileSync(executables.ocr, [
      'delegate',
      'preview',
      '--format',
      'json',
      '--rule',
      rulePath,
      '--from',
      'origin/main',
      '--to',
      commitSha,
    ], {
      cwd: repoPath,
      encoding: 'utf8',
      env: cliEnv,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const preview = validateOpenCodeReviewPreview(
      parseCliJson(previewOutput, 'OCR_PREVIEW_JSON_INVALID'),
    );

    assert.deepEqual(
      preview.reviewable_files.map(file => file.path).sort(),
      EXPECTED_REVIEWABLE_PATHS,
      'OpenCodeReview must select only the configured reviewable fixture',
    );
    assert.deepEqual(
      preview.excluded_files.map(file => file.path).sort(),
      EXPECTED_EXCLUDED_PATHS,
      'OpenCodeReview must report the out-of-scope fixture as excluded',
    );

    const context = await buildReviewContext({
      preview,
      baseRef: 'main',
      commitSha,
      rulePath,
      cwd: repoPath,
      runCommand: (command, args, { cwd }) => runCommand(command, args, {
        cwd,
        encoding: 'utf8',
        env: cliEnv,
        maxBuffer: 10 * 1024 * 1024,
      }).then(({ stdout }) => stdout),
    });
    validateOpenCodeReviewRules(context.rules);

    assert.deepEqual(
      context.rules.groups.flatMap(group => group.files).sort(),
      EXPECTED_REVIEWABLE_PATHS,
      'OpenCodeReview rules must cover the selected fixture',
    );
    assert.ok(context.diff.includes('Changed content for the contract check.'));

    validateReviewResult({
      expectedReviewableFiles: EXPECTED_REVIEWABLE_PATHS.length,
      expectedReviewablePaths: EXPECTED_REVIEWABLE_PATHS,
      result: { status: 'success', coverage: 1, findings: [] },
    });

    return {
      reviewableFiles: preview.reviewable_files.length,
      excludedFiles: preview.excluded_files.length,
      ruleGroups: context.rules.groups.length,
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await checkOpenCodeReviewContract();
    console.log(`OPENCODEREVIEW_CONTRACT_OK ${JSON.stringify(result)}`);
  } catch (error) {
    console.error(error?.message ?? 'OPENCODEREVIEW_CONTRACT_FAILED');
    process.exitCode = 1;
  }
}
