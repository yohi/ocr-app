import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { fetchCurrentHead, run } from './check-pr-head.mjs';

test('fetchCurrentHead reads the current PR head from GitHub', async () => {
  const calls = [];
  const sha = await fetchCurrentHead({
    token: 'token',
    targetRepo: 'owner/repo',
    prNumber: '123',
    fetchImpl: async (url, options) => {
      calls.push({ options, url });
      return { ok: true, status: 200, json: async () => ({ head: { sha: 'head-sha' } }) };
    },
  });

  assert.equal(sha, 'head-sha');
  assert.equal(calls[0].url, 'https://api.github.com/repos/owner/repo/pulls/123');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token');
});

for (const [name, setup, expected] of [
  ['mismatch', "globalThis.fetch = async () => ({ ok: true, json: async () => ({ head: { sha: 'changed' } }) });", 'HEAD_CHANGED'],
  ['API exception', "globalThis.fetch = async () => { throw new Error('PR_SECRET_SENTINEL'); };", 'HEAD_VALIDATION_FAILED'],
]) {
  test(`enforce HEAD CLI reports a fixed ${name} reason without raw errors`, () => {
    const directory = fs.mkdtempSync(join(tmpdir(), 'head-check-'));
    try {
      const output = join(directory, 'output');
      const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(setup)}`,
        fileURLToPath(new URL('./check-pr-head.mjs', import.meta.url))], {
        encoding: 'utf8', env: { DECISION_ROUTING_MODE: 'enforce', GITHUB_OUTPUT: output,
          EXPECTED_SHA: 'expected', TARGET_REPO: 'owner/repo', PR_NUMBER: '1' },
      });
      assert.equal(result.status, 1);
      assert.equal(result.stderr.trim(), expected);
      assert.equal(fs.readFileSync(output, 'utf8'), `HEAD_FAILURE_REASON=${expected}\n`);
      assert.doesNotMatch(result.stderr + result.stdout, /PR_SECRET_SENTINEL/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('run refuses to publish when the PR head differs from EXPECTED_SHA', async () => {
  await assert.rejects(
    run({
      env: {
        GITHUB_TOKEN: 'token',
        TARGET_REPO: 'owner/repo',
        PR_NUMBER: '123',
        EXPECTED_SHA: 'expected-sha',
      },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ head: { sha: 'new-sha' } }),
      }),
    }),
    /refusing to publish stale results/,
  );
});
