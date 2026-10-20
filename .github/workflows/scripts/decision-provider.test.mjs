import test from 'node:test';
import assert from 'node:assert/strict';
import { requestReviewDecision } from './decision-provider.mjs';

const state = {
  schema_version: '1', all_changed_file_count_bucket: '1-5', reviewable_file_count_bucket: '1-5',
  excluded_file_count_bucket: '0', additions_bucket: '1-100', deletions_bucket: '0', change_size: 'small',
  language_families: ['typescript'], change_areas: ['docs'], test_files_changed: false,
  security_signal: 'metadata_not_observed', migration_signal: 'metadata_not_observed', review_scope_gap: false,
  features_incomplete: false, classification_status: 'allowlisted_docs_only',
};
const expectedBinding = { workflowRunId: '123', runAttempt: 2, headSha: 'a'.repeat(40), mode: 'shadow', destination: 'openrouter-decisions' };
const grant = { schema_version: '1', allowed: true, reason: 'authorized', visibility: 'public', repo_id: 1, full_name: 'org/repo', head_sha: expectedBinding.headSha, workflow_run_id: '123', run_attempt: 2, destination: 'openrouter-decisions', policy_version: '1', approval_ref: 'APPROVED-1', checked_at: '2026-01-01T00:00:00.000Z' };
const answer = { answers: { review_strategy: { type: 'choice', choice: 'fast', probabilities: { fast: 0.8, deep: 0.2 }, confidence: 0.8 } } };
const response = (body = answer, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const FIXED_REASONS = new Set(['egress_denied', 'invalid_input', 'missing_api_key', 'request_failed', 'http_error', 'invalid_response']);
const invoke = (overrides = {}, fetchImpl = async () => response()) => requestReviewDecision({ decisionState: state, grant, expectedBinding, apiKey: 'secret-test-key', fetchImpl, ...overrides });

test('missing key denies without a request', async () => {
  let calls = 0;
  const result = await invoke({ apiKey: '' }, async () => { calls++; return response(); });
  assert.equal(calls, 0);
  assert.equal(result.status, 'decision_unavailable');
});

for (const [label, changes] of [
  ['denied grant', { grant: { ...grant, allowed: false } }],
  ['stale run ID', { grant: { ...grant, workflow_run_id: '124' } }],
  ['wrong run ID type', { grant: { ...grant, workflow_run_id: 123 } }],
  ['wrong attempt type', { grant: { ...grant, run_attempt: '2' } }],
  ['swapped attempt', { grant: { ...grant, run_attempt: 3 } }],
  ['swapped HEAD', { grant: { ...grant, head_sha: 'b'.repeat(40) } }],
  ['wrong grant schema version', { grant: { ...grant, schema_version: '2' } }],
  ['extra state key', { decisionState: { ...state, unexpected: true } }],
  ['invalid state enum', { decisionState: { ...state, change_size: 'huge' } }],
]) {
  test(`${label} is rejected before HTTP`, async () => {
    let calls = 0;
    const result = await invoke(changes, async () => { calls++; return response(); });
    assert.equal(calls, 0);
    assert.ok(['egress_denied', 'decision_unavailable'].includes(result.status));
    assert.equal(result.choice, null);
  });
}

test('posts the fixed free decision request once and normalizes success', async () => {
  const calls = [];
  const result = await invoke({}, async (url, options) => { calls.push({ url, options }); return response(); });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://openrouter.ai/api/alpha/decisions');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-test-key');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    model: 'inception/mercury-decide:free', state,
    questions: { review_strategy: { type: 'choice', instructions: 'Choose code review depth from PR metadata only. Deep is preferred for high impact or uncertainty. This is advisory; application policy may override.', criteria: { fast: 'Low-impact allowlisted documentation changes only', deep: 'Code, security-sensitive, unknown, complex or high-impact changes' } } },
  });
  const body = JSON.parse(calls[0].options.body);
  for (const forbidden of ['apiKey', 'grant', 'expectedBinding']) assert.equal(Object.hasOwn(body, forbidden), false);
  assert.equal(result.status, 'decision_available');
  assert.equal(result.choice, 'fast');
});

for (const [label, run] of [
  ['timeout', async () => { throw new DOMException('aborted', 'TimeoutError'); }],
  ...[302, 401, 402, 429, 500, 503].map(status => [`HTTP ${status}`, async () => response({}, status)]),
  ['malformed JSON text', async () => ({ ok: true, text: async () => '{not json' })],
  ['wrong answer type', async () => response({ answers: { review_strategy: { ...answer.answers.review_strategy, type: 'text' } } })],
  ['unknown choice', async () => response({ answers: { review_strategy: { ...answer.answers.review_strategy, choice: 'cheap' } } })],
  // JSON serializes NaN as null; null must be rejected as a non-numeric probability.
  ['NaN serialized as null probability', async () => response({ answers: { review_strategy: { ...answer.answers.review_strategy, probabilities: { fast: NaN, deep: 0 } } } })],
  ['out of range probability', async () => response({ answers: { review_strategy: { ...answer.answers.review_strategy, probabilities: { fast: 1.1, deep: -0.1 } } } })],
  ['non-unit probability sum', async () => response({ answers: { review_strategy: { ...answer.answers.review_strategy, probabilities: { fast: 0.6, deep: 0.2 } } } })],
  ['invalid optional confidence', async () => response({ answers: { review_strategy: { ...answer.answers.review_strategy, confidence: 2 } } })],
]) {
  test(`${label} returns a sanitized failure with at most one request`, async () => {
    let calls = 0;
    const result = await invoke({}, async () => { calls++; return run(); });
    assert.equal(calls, 1);
    const invalidResponse = ['malformed JSON text', 'wrong answer type', 'unknown choice', 'NaN serialized as null probability', 'out of range probability', 'non-unit probability sum', 'invalid optional confidence'].includes(label);
    assert.equal(result.status, invalidResponse ? 'invalid_response' : 'decision_unavailable');
    assert.equal(result.choice, null);
    assert.equal(result.probabilities, null);
    assert.equal(result.confidence, null);
    assert.equal(FIXED_REASONS.has(result.reason), true);
    assert.doesNotMatch(result.reason, /secret|body|aborted/i);
  });
}
