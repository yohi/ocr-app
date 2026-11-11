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
      excluded_files: [
        { path: '_mk/system.mk', status: 'modified', exclude_reason: 'unsupported_ext' },
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
      return [
        'diff --git a/README.md b/README.md\n+changed',
        'diff --git a/docs/example.md b/docs/example.md\n+docs change',
      ].join('\n');
    },
  });

  assert.deepEqual(context, {
    base_ref: 'master',
    commit_sha: commitSha,
    reviewable_files: [
      { path: 'README.md', status: 'modified' },
      { path: 'docs/example.md', status: 'added' },
    ],
    excluded_files: [
      { path: '_mk/system.mk', status: 'modified', exclude_reason: 'unsupported_ext' },
    ],
    rules: { schema_version: '1', groups: [{ group_id: 1, rule: 'review' }] },
    diff: [
      'diff --git a/README.md b/README.md\n+changed',
      'diff --git a/docs/example.md b/docs/example.md\n+docs change',
    ].join('\n'),
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
        '--literal-pathspecs',
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
    excluded_files: [],
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

test('oversized high-context diff retries with less context without dropping changed lines', async () => {
  const levels = [];
  const context = await buildReviewContext({
    preview: { reviewable_files: [{ path: 'src/reviewed.ts' }] },
    baseRef: 'master', commitSha, rulePath: '../rules.json', cwd: 'target-repo',
    maxDiffChars: 20,
    runCommand: async (command, args) => {
      if (command === 'ocr') return '{"schema_version":"1","groups":[]}';
      const level = args.find(arg => arg.startsWith('--unified='));
      levels.push(level);
      return level === '--unified=80' ? 'x'.repeat(21) : 'complete diff';
    },
  });
  assert.deepEqual(levels, ['--unified=80', '--unified=20']);
  assert.equal(context.diff, 'complete diff');
  assert.equal(context.reviewable_files.length, 1);
});

test('oversized diff remains a hard failure even with zero context', async () => {
  const levels = [];
  await assert.rejects(() => buildReviewContext({
    preview: { reviewable_files: [{ path: 'src/reviewed.ts' }] },
    baseRef: 'master', commitSha, rulePath: '../rules.json', cwd: 'target-repo',
    maxDiffChars: 4,
    runCommand: async (command, args) => {
      if (command === 'ocr') return '{"schema_version":"1","groups":[]}';
      levels.push(args.find(arg => arg.startsWith('--unified=')));
      return '12345';
    },
  }), /Review diff is too large/);
  assert.deepEqual(levels, ['--unified=80', '--unified=20', '--unified=3', '--unified=0']);
});

test('git stdout buffer overflow retries but unrelated git errors fail closed', async () => {
  const input = { preview: { reviewable_files: [{ path: 'README.md' }] },
    baseRef: 'master', commitSha, rulePath: '../rules.json', cwd: 'target-repo' };
  let attempts = 0;
  const context = await buildReviewContext({ ...input,
    runCommand: async command => {
      if (command === 'ocr') return '{"schema_version":"1","groups":[]}';
      attempts++;
      if (attempts === 1) throw Object.assign(new Error('stdout maxBuffer exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
      return 'complete diff';
    },
  });
  assert.equal(context.diff, 'complete diff');
  assert.equal(attempts, 2);
  attempts = 0;
  await assert.rejects(() => buildReviewContext({ ...input,
    runCommand: async command => {
      if (command === 'ocr') return '{"schema_version":"1","groups":[]}';
      attempts++;
      throw Object.assign(new Error('git failed'), { code: 'EACCES' });
    },
  }), /git failed/);
  assert.equal(attempts, 1);
});

test('pathspec magic is passed literally and cannot expand the review scope', async () => {
  const gitCommands = [];
  await buildReviewContext({
    preview: { reviewable_files: [{ path: ':(glob)**' }] },
    baseRef: 'master', commitSha, rulePath: '../rules.json', cwd: 'target-repo',
    runCommand: async (command, args) => {
      if (command === 'ocr') return '{"schema_version":"1","groups":[]}';
      gitCommands.push(args);
      return 'diff --git a/:(glob)** b/:(glob)**';
    },
  });
  assert.equal(gitCommands.length, 1);
  assert.equal(gitCommands[0][0], '--literal-pathspecs');
  assert.deepEqual(gitCommands[0].slice(-2), ['--', ':(glob)**']);
});

test('empty diff with reviewable files is rejected', async () => {
  await assert.rejects(() => buildReviewContext({
    preview: { reviewable_files: [{ path: 'README.md' }] },
    baseRef: 'master', commitSha, rulePath: '../rules.json', cwd: 'target-repo',
    runCommand: async command => command === 'ocr' ? '{"schema_version":"1","groups":[]}' : '',
  }), /Review diff is empty/);
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
