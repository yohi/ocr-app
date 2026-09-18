import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';

import { buildReviewContext } from './prepare-ocr-review-context.mjs';

const commitSha = 'a'.repeat(40);
const execFile = promisify(nodeExecFile);

test('buildReviewContext prepares rules and diff for the selected files', async () => {
  const calls = [];
  const context = await buildReviewContext({
    preview: {
      reviewable_files: [
        { path: 'README.md', status: 'modified' },
        { path: 'docs/example.md', status: 'added' },
      ],
    },
    baseRef: 'master',
    commitSha,
    rulePath: '../self-repo/.github/workflows/config/markdown-review-rules.json',
    cwd: 'target-repo',
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === 'ocr') {
        return JSON.stringify({ schema_version: '1', groups: [{ group_id: 1, rule: 'review' }] });
      }
      return 'diff --git a/README.md b/README.md\n+changed';
    },
  });

  assert.deepEqual(context, {
    base_ref: 'master',
    commit_sha: commitSha,
    reviewable_files: [
      { path: 'README.md', status: 'modified' },
      { path: 'docs/example.md', status: 'added' },
    ],
    rules: { schema_version: '1', groups: [{ group_id: 1, rule: 'review' }] },
    diff: 'diff --git a/README.md b/README.md\n+changed',
  });
  assert.deepEqual(calls, [
    {
      command: 'ocr',
      args: [
        'delegate',
        'rule',
        '--format',
        'json',
        '--rule',
        '../self-repo/.github/workflows/config/markdown-review-rules.json',
        'README.md',
        'docs/example.md',
      ],
      options: { cwd: 'target-repo' },
    },
    {
      command: 'git',
      args: [
        'diff',
        '--no-ext-diff',
        '--no-color',
        '--unified=80',
        `origin/master...${commitSha}`,
        '--',
        'README.md',
        'docs/example.md',
      ],
      options: { cwd: 'target-repo' },
    },
  ]);
});

test('buildReviewContext does not invoke tools when no files are reviewable', async () => {
  let calls = 0;
  const context = await buildReviewContext({
    preview: { reviewable_files: [] },
    baseRef: 'master',
    commitSha,
    rulePath: '../rules.json',
    cwd: 'target-repo',
    runCommand: async () => {
      calls++;
      return '';
    },
  });

  assert.equal(calls, 0);
  assert.deepEqual(context, {
    base_ref: 'master',
    commit_sha: commitSha,
    reviewable_files: [],
    rules: { schema_version: '1', groups: [] },
    diff: '',
  });
});

test('buildReviewContext rejects unsafe review paths before invoking Git', async () => {
  await assert.rejects(
    () => buildReviewContext({
      preview: { reviewable_files: [{ path: '../secret.txt' }] },
      baseRef: 'master',
      commitSha,
      rulePath: '../rules.json',
      cwd: 'target-repo',
      runCommand: async () => {
        throw new Error('must not run');
      },
    }),
    /unsafe review path/i,
  );
});

test('buildReviewContext rejects an oversized diff instead of truncating review input', async () => {
  await assert.rejects(
    () => buildReviewContext({
      preview: { reviewable_files: [{ path: 'README.md' }] },
      baseRef: 'master',
      commitSha,
      rulePath: '../rules.json',
      cwd: 'target-repo',
      maxDiffChars: 4,
      runCommand: async (command) => command === 'ocr' ? '{"schema_version":"1","groups":[]}' : '12345',
    }),
    /diff is too large/i,
  );
});

test('CLI context preparation uses the workflow step working directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ocr-context-test-'));
  const targetDirectory = join(root, 'target-repo');
  const workspaceDirectory = join(root, 'github-workspace');
  const binDirectory = join(root, 'bin');
  const cwdLogPath = join(root, 'cwd.log');
  const previewPath = join(root, 'preview.json');
  const contextPath = join(root, 'context.json');
  const scriptPath = new URL('./prepare-ocr-review-context.mjs', import.meta.url);

  try {
    await Promise.all([
      mkdir(targetDirectory),
      mkdir(workspaceDirectory),
      mkdir(binDirectory),
    ]);
    await writeFile(join(binDirectory, 'ocr'), '#!/bin/sh\nprintf \'%s\\n\' "$PWD" >> "$OCR_TEST_CWD_LOG"\nprintf \'%s\' \'{"schema_version":"1","groups":[]}\'\n');
    await writeFile(join(binDirectory, 'git'), '#!/bin/sh\nprintf \'%s\\n\' "$PWD" >> "$OCR_TEST_CWD_LOG"\nprintf \'%s\' \'diff --git a/README.md b/README.md\\n+changed\'\n');
    await chmod(join(binDirectory, 'ocr'), 0o755);
    await chmod(join(binDirectory, 'git'), 0o755);
    await writeFile(previewPath, JSON.stringify({ reviewable_files: [{ path: 'README.md' }] }));

    await execFile(process.execPath, [scriptPath.pathname], {
      cwd: targetDirectory,
      env: {
        ...process.env,
        BASE_REF: 'master',
        COMMIT_SHA: commitSha,
        OCR_RULE_PATH: 'rules.json',
        OCR_PREVIEW_PATH: previewPath,
        OCR_CONTEXT_PATH: contextPath,
        GITHUB_WORKSPACE: workspaceDirectory,
        OCR_TEST_CWD_LOG: cwdLogPath,
        PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
      },
    });

    assert.deepEqual(
      (await readFile(cwdLogPath, 'utf8')).trim().split('\n'),
      [targetDirectory, targetDirectory],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
