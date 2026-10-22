import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeDecisionEgress } from './authorize-decision-egress.mjs';

const binding = { workflowRunId: '9007199254740993', runAttempt: 2, headSha: 'a'.repeat(40), mode: 'shadow' };
const policy = { allowed_repositories: [{ id: 42, full_name: 'owner/repo', approval_ref: 'OWNER-123' }], approval_reference_format: 'OWNER-<approval-id>', destination: 'openrouter-decisions', policy_version: 'v1' };
const input = { targetRepo: 'owner/repo', headSha: binding.headSha, checkoutIdentity: { fullName: 'owner/repo', headSha: binding.headSha }, runBinding: binding, installationToken: 'secret-token', policy };
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const execute = (body, status = 200, options = {}) => authorizeDecisionEgress({ ...input, ...options, fetchImpl: options.fetchImpl ?? (async (_url, init) => { assert.equal(init.headers.Authorization, 'Bearer secret-token'); return response(body, status); }) });
const repo = { id: 42, full_name: 'owner/repo', private: false, visibility: 'public' };

test('authorizes a public repository only on exact trusted id and name match', async () => {
  const grant = await execute(repo);
  assert.deepEqual({ allowed: grant.allowed, reason: grant.reason, visibility: grant.visibility, repo_id: grant.repo_id, full_name: grant.full_name, destination: grant.destination, workflow_run_id: grant.workflow_run_id, run_attempt: grant.run_attempt }, { allowed: true, reason: 'authorized', visibility: 'public', repo_id: 42, full_name: 'owner/repo', destination: 'openrouter-decisions', workflow_run_id: binding.workflowRunId, run_attempt: 2 });
});

for (const [name, body] of [['private', { ...repo, private: true, visibility: 'private' }], ['internal', { ...repo, private: true, visibility: 'internal' }]]) {
  test(`classifies ${name} as restricted`, async () => {
    const grant = await execute(body);
    assert.equal(grant.visibility, 'restricted');
    assert.equal(grant.allowed, true);
  });
}

test('denies contradictory visibility as unknown', async () => {
  const grant = await execute({ ...repo, private: false, visibility: 'private' });
  assert.equal(grant.visibility, 'visibility_unknown');
  assert.equal(grant.reason, 'egress_denied');
  assert.equal(grant.allowed, false);
});

for (const [name, body] of [['numeric ID mismatch', { ...repo, id: 43 }], ['full_name mismatch', { ...repo, full_name: 'owner/other' }]]) {
  test(`denies ${name}`, async () => assert.equal((await execute(body)).allowed, false));
}

for (const [name, status, body] of [['403', 403, {}], ['404', 404, {}], ['5xx', 503, {}], ['broken JSON', 200, null]]) {
  test(`denies ${name} response`, async () => assert.equal((await execute(body, status)).allowed, false));
}

test('denies timeout without leaking arbitrary error text', async () => {
  const grant = await execute(repo, 200, { fetchImpl: async () => { throw new Error('secret-token response body'); } });
  assert.equal(grant.allowed, false);
  assert.equal(grant.reason, 'egress_denied');
});

test('denies a hanging GitHub lookup after the request timeout', async () => {
  const grant = await execute(repo, 200, { fetchImpl: (_url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  }) });
  assert.equal(grant.allowed, false);
  assert.equal(grant.reason, 'egress_denied');
});

test('does not trust dispatch visibility and rejects checkout identity or head mismatch', async () => {
  assert.equal((await execute(repo, 200, { targetRepo: { owner: 'owner', repo: 'repo', visibility: 'public' } })).allowed, true);
  assert.equal((await execute(repo, 200, { checkoutIdentity: { fullName: 'attacker/repo', headSha: binding.headSha } })).allowed, false);
  assert.equal((await execute(repo, 200, { checkoutIdentity: { fullName: 'owner/repo', headSha: 'b'.repeat(40) } })).allowed, false);
  assert.equal((await execute(repo, 200, { headSha: 'b'.repeat(40) })).allowed, false);
  assert.equal((await execute(repo, 200, { runBinding: { ...binding, headSha: 'b'.repeat(40) } })).allowed, false);
});

test('checkout mismatch denies egress without a Decision POST', async () => {
  const methods = [];
  const grant = await authorizeDecisionEgress({
    ...input,
    checkoutIdentity: { fullName: 'other/repo', headSha: binding.headSha },
    fetchImpl: async (_url, init) => { methods.push(init.method); return response(repo); },
  });
  assert.equal(grant.allowed, false);
  assert.equal(grant.reason, 'egress_denied');
  assert.equal(methods.filter(method => method === 'POST').length, 0);
});

test('denies an unapproved repository and absent or invalid Owner approval reference', async () => {
  assert.equal((await execute(repo, 200, { policy: { ...policy, allowed_repositories: [] } })).allowed, false);
  assert.equal((await execute(repo, 200, { policy: { ...policy, allowed_repositories: [{ id: 42, full_name: 'owner/repo' }] } })).allowed, false);
  assert.equal((await execute(repo, 200, { policy: { ...policy, allowed_repositories: [{ id: 42, full_name: 'owner/repo', approval_ref: '*' }] } })).allowed, false);
  assert.equal((await execute(repo, 200, { policy: { ...policy, allowed_repositories: [{ id: 42, full_name: 'owner/repo', approval_ref: 'APPROVER-1' }] } })).allowed, false);
  assert.equal((await execute(repo, 200, { policy: { ...policy, allowed_repositories: null } })).allowed, false);
});

test('denies malformed RunBinding fields without throwing', async () => {
  for (const runBinding of [
    { ...binding, workflowRunId: 'abc' }, { ...binding, runAttempt: Number.MAX_SAFE_INTEGER + 1 },
    { ...binding, headSha: 'not-a-sha' }, { ...binding, mode: 'off' },
  ]) {
    const grant = await execute(repo, 200, { runBinding });
    assert.equal(grant.allowed, false);
    assert.equal(grant.reason, 'egress_denied');
  }
});

test('performs exactly one GET and never makes a downstream POST', async () => {
  const methods = [];
  await authorizeDecisionEgress({ ...input, fetchImpl: async (_url, init) => { methods.push(init.method); return response(repo); } });
  assert.deepEqual(methods, ['GET']);
});
