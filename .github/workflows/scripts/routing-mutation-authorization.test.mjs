import assert from 'node:assert/strict';
import test from 'node:test';
import { reauthorizeRoutingMutation } from './routing-mutation-authorization.mjs';

test('shadow mutation authorization uses central and target credentials and denies when authority is revoked', async () => {
  let observedEnv;
  const authorized = await reauthorizeRoutingMutation({
    env: {
      DECISION_ROUTING_MODE: 'shadow',
      GITHUB_TOKEN: 'target-token',
      CENTRAL_GITHUB_TOKEN: 'central-token',
      TARGET_REPO: 'owner/repo',
    },
    authorize: async ({ env, writeOutput }) => {
      observedEnv = env;
      assert.equal(writeOutput(), undefined);
      throw new Error('revoked');
    },
  });

  assert.equal(authorized, false);
  assert.equal(observedEnv.GITHUB_TOKEN, 'central-token');
  assert.equal(observedEnv.TARGET_TOKEN, 'target-token');
});

test('off mode does not fetch routing authorization', async () => {
  let calls = 0;
  const authorized = await reauthorizeRoutingMutation({
    env: { DECISION_ROUTING_MODE: 'off' },
    authorize: async () => { calls++; return true; },
  });

  assert.equal(authorized, true);
  assert.equal(calls, 0);
});
