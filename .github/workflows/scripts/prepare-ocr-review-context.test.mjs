import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReviewContext } from './prepare-ocr-review-context.mjs';

const commitSha = 'a'.repeat(40);

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
