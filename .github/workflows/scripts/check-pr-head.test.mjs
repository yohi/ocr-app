import assert from 'node:assert/strict';
import test from 'node:test';

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
