import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunBindingFromEnv, assertRunBindingEquals, assertSerializedRunBindingMatches } from './ocr-run-binding.mjs';

const sha = 'A'.repeat(40);
const env = (overrides = {}) => ({ GITHUB_RUN_ID: '9007199254740993', GITHUB_RUN_ATTEMPT: '2', COMMIT_SHA: sha, DECISION_ROUTING_MODE: 'shadow', ...overrides });

test('preserves the run id string and parses attempt once as number', () => {
  assert.deepEqual(createRunBindingFromEnv(env()), { workflowRunId: '9007199254740993', runAttempt: 2, headSha: sha.toLowerCase(), mode: 'shadow' });
});

for (const value of ['0', '02', '+2', '2e1', '9007199254740992', ' 2', '2 ']) {
  test(`rejects invalid GITHUB_RUN_ATTEMPT ${JSON.stringify(value)}`, () => {
    assert.throws(() => createRunBindingFromEnv(env({ GITHUB_RUN_ATTEMPT: value })), { code: 'RUN_BINDING_INVALID' });
  });
}

for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'COMMIT_SHA', 'DECISION_ROUTING_MODE']) {
  test(`rejects missing ${key}`, () => {
    const values = env();
    delete values[key];
    assert.throws(() => createRunBindingFromEnv(values), { code: 'RUN_BINDING_INVALID' });
  });
}

test('rejects noncanonical run IDs', () => {
  for (const value of ['0', '02', '+2', '2e1', ' '.repeat(1) + '2', '1'.repeat(33)]) {
    assert.throws(() => createRunBindingFromEnv(env({ GITHUB_RUN_ID: value })), { code: 'RUN_BINDING_INVALID' });
  }
});

test('rejects mismatched serialized numeric types without coercion', () => {
  const binding = createRunBindingFromEnv(env());
  assert.throws(() => assertSerializedRunBindingMatches(binding, { workflow_run_id: 123, run_attempt: 2, head_sha: binding.headSha, effective_mode: binding.mode }), { code: 'RUN_BINDING_MISMATCH' });
  assert.throws(() => assertSerializedRunBindingMatches(binding, { workflow_run_id: binding.workflowRunId, run_attempt: '2', head_sha: binding.headSha, effective_mode: binding.mode }), { code: 'RUN_BINDING_MISMATCH' });
});

test('rejects differences in each run binding field', () => {
  const binding = createRunBindingFromEnv(env());
  for (const difference of [{ headSha: 'b'.repeat(40) }, { mode: 'enforce' }, { workflowRunId: '9' }, { runAttempt: 1 }, { runAttempt: '2' }]) {
    assert.throws(() => assertRunBindingEquals(binding, { ...binding, ...difference }), { code: 'RUN_BINDING_MISMATCH' });
  }
});
