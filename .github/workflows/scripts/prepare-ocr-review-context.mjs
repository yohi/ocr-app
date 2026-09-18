import fs from 'node:fs';
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(nodeExecFile);
const DEFAULT_MAX_DIFF_CHARS = 500_000;
const DIFF_CONTEXT_LINES = '80';

function isSafeReviewPath(filePath) {
  return typeof filePath === 'string' && filePath.length > 0 &&
    !filePath.includes('\0') && !filePath.startsWith('/') && !filePath.startsWith('\\') &&
    !filePath.split(/[\\/]+/).includes('..');
}

function isSafeBaseRef(baseRef) {
  return typeof baseRef === 'string' && /^[A-Za-z0-9._/-]+$/.test(baseRef) &&
    !baseRef.startsWith('/') && !baseRef.endsWith('/') &&
    !baseRef.includes('..') && !baseRef.includes('//');
}

function isCommitSha(commitSha) {
  return typeof commitSha === 'string' && /^[0-9a-f]{40}$/i.test(commitSha);
}

function normalizeReviewableFiles(preview) {
  if (!preview || !Array.isArray(preview.reviewable_files)) {
    throw new Error('OCR preview has no reviewable file list');
  }

  return preview.reviewable_files.map(file => {
    const path = file?.path;
    if (!isSafeReviewPath(path)) throw new Error(`Unsafe review path: ${String(path)}`);
    return {
      path,
      status: typeof file.status === 'string' ? file.status : 'modified',
    };
  });
}

async function executeCommand(command, args, { cwd }) {
  const { stdout } = await execFile(command, args, {
    cwd,
    maxBuffer: DEFAULT_MAX_DIFF_CHARS * 2,
  });
  return stdout;
}

function parseRules(rawRules) {
  let rules;
  try {
    rules = JSON.parse(rawRules);
  } catch (error) {
    throw new Error(`OCR rule output is not valid JSON: ${error.message}`);
  }
  if (!rules || typeof rules !== 'object' || !Array.isArray(rules.groups)) {
    throw new Error('OCR rule output has no groups');
  }
  return rules;
}

export async function buildReviewContext({
  preview,
  baseRef,
  commitSha,
  rulePath,
  cwd,
  runCommand = executeCommand,
  maxDiffChars = DEFAULT_MAX_DIFF_CHARS,
}) {
  const reviewableFiles = normalizeReviewableFiles(preview);
  if (!isSafeBaseRef(baseRef)) throw new Error('Base ref is invalid');
  if (!isCommitSha(commitSha)) throw new Error('Commit SHA is invalid');
  if (typeof rulePath !== 'string' || rulePath.length === 0) throw new Error('Rule path is required');
  if (!Number.isInteger(maxDiffChars) || maxDiffChars <= 0) throw new Error('Maximum diff size is invalid');

  if (reviewableFiles.length === 0) {
    return {
      base_ref: baseRef,
      commit_sha: commitSha,
      reviewable_files: [],
      rules: { schema_version: '1', groups: [] },
      diff: '',
    };
  }

  const paths = reviewableFiles.map(file => file.path);
  const ruleOutput = await runCommand('ocr', [
    'delegate',
    'rule',
    '--format',
    'json',
    '--rule',
    rulePath,
    ...paths,
  ], { cwd });
  const diff = await runCommand('git', [
    'diff',
    '--no-ext-diff',
    '--no-color',
    `--unified=${DIFF_CONTEXT_LINES}`,
    `origin/${baseRef}...${commitSha}`,
    '--',
    ...paths,
  ], { cwd });

  if (typeof diff !== 'string') throw new Error('Git diff output is invalid');
  if (diff.length > maxDiffChars) throw new Error('Review diff is too large');

  return {
    base_ref: baseRef,
    commit_sha: commitSha,
    reviewable_files: reviewableFiles,
    rules: parseRules(ruleOutput),
    diff,
  };
}

export async function main({ env = process.env } = {}) {
  const previewPath = env.OCR_PREVIEW_PATH || '/tmp/ocr-preview.json';
  const outputPath = env.OCR_CONTEXT_PATH || '/tmp/ocr-review-context.json';
  const preview = JSON.parse(fs.readFileSync(previewPath, 'utf8'));
  const context = await buildReviewContext({
    preview,
    baseRef: env.BASE_REF,
    commitSha: env.COMMIT_SHA,
    rulePath: env.OCR_RULE_PATH,
    cwd: env.GITHUB_WORKSPACE || process.cwd(),
  });
  fs.writeFileSync(outputPath, JSON.stringify(context));
  console.log(`Prepared OCR review context for ${context.reviewable_files.length} file(s)`);
  return context;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
