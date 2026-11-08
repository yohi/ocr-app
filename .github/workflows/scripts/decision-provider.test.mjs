import test from 'node:test';
import assert from 'node:assert/strict';
import { requestReviewDecision, formatDecisionDiagnostic } from './decision-provider.mjs';

const state = {
  schema_version: '1', all_changed_file_count_bucket: '1-5', reviewable_file_count_bucket: '1-5',
  excluded_file_count_bucket: '0', additions_bucket: '1-100', deletions_bucket: '0', change_size: 'small',
  language_families: ['typescript'], change_areas: ['docs'], test_files_changed: false,
  security_signal: 'metadata_not_observed', migration_signal: 'metadata_not_observed', review_scope_gap: false,
  features_incomplete: false, classification_status: 'allowlisted_docs_only',
};
const expectedBinding = { workflowRunId: '123', runAttempt: 2, headSha: 'a'.repeat(40), mode: 'shadow' };
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

for (const [label, changes, expected] of [
  ['denied grant', { grant: { ...grant, allowed: false } }],
  ['stale run ID', { grant: { ...grant, workflow_run_id: '124' } }],
  ['wrong run ID type', { grant: { ...grant, workflow_run_id: 123 } }],
  ['wrong attempt type', { grant: { ...grant, run_attempt: '2' } }],
  ['swapped attempt', { grant: { ...grant, run_attempt: 3 } }],
  ['swapped HEAD', { grant: { ...grant, head_sha: 'b'.repeat(40) } }],
  ['wrong grant schema version', { grant: { ...grant, schema_version: '2' } }],
  ['wrong grant destination', { grant: { ...grant, destination: 'unauthorized-destination' } }, { status: 'egress_denied', reason: 'egress_denied' }],
  ['extra state key', { decisionState: { ...state, unexpected: true } }],
  ['wrong state schema version', { decisionState: { ...state, schema_version: '2' } }, { status: 'decision_unavailable', reason: 'invalid_input' }],
  ['invalid state enum', { decisionState: { ...state, change_size: 'huge' } }],
]) {
  test(`${label} is rejected before HTTP`, async () => {
    let calls = 0;
    const result = await invoke(changes, async () => { calls++; return response(); });
    assert.equal(calls, 0);
    assert.ok(['egress_denied', 'decision_unavailable'].includes(result.status));
    if (expected?.status) assert.equal(result.status, expected.status);
    if (expected?.reason) assert.equal(result.reason, expected.reason);
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
    questions: { review_strategy: { type: 'choice', instructions: 'Choose code review depth from PR metadata only. Deep is preferred for high impact or uncertainty. Fast is limited to allowlisted low-risk changes. This is advisory; application policy may override.', criteria: { fast: 'Low-impact allowlisted documentation or low-risk code changes', deep: 'Code, security-sensitive, unknown, complex or high-impact changes' } } },
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

test('trusted question describes low-risk code allowlist, not only docs', async () => {
  const calls = [];
  await invoke({}, async (url, options) => { calls.push(options); return response(); });
  const question = JSON.parse(calls[0].body).questions.review_strategy;
  assert.match(question.instructions, /allowlisted/i);
  assert.match(question.criteria.fast, /low-risk|allowlisted|code/i);
});

test('sent body contains only the 15 DecisionState/v1 keys and no raw diff or paths', async () => {
  const calls = [];
  const codeState = {
    ...state, change_areas: ['other'], language_families: ['typescript'], test_files_changed: false,
  };
  await invoke({ decisionState: codeState }, async (url, options) => { calls.push(options); return response(); });
  const body = JSON.parse(calls[0].body);
  assert.equal(Object.keys(body.state).length, 15);
  assert.deepEqual(Object.keys(body.state).sort(), Object.keys(state).sort());
  for (const forbidden of ['all_changed_files', 'ocr_reviewable_paths', 'head_sha', 'diff', 'pr_title', 'raw']) {
    assert.equal(Object.hasOwn(body.state, forbidden), false, forbidden);
    assert.equal(Object.hasOwn(body, forbidden), false, forbidden);
  }
});


test('safe failure diagnostics distinguish HTTP status without response body or tokens', async () => {
  for (const httpStatus of [401, 403, 429, 500, 503]) {
    const result = await invoke({}, async () => ({
      ok: false, status: httpStatus,
      text: async () => { throw new Error('HTTP_BODY_SECRET_SENTINEL'); },
      headers: { authorization: 'Bearer HEADER_SECRET_SENTINEL' },
    }));
    assert.equal(result.status, 'decision_unavailable');
    assert.equal(result.reason, 'http_error');
    assert.equal(result.failureClass, 'http_error');
    assert.equal(result.httpStatus, httpStatus);
    const log = formatDecisionDiagnostic(result);
    assert.match(log, /^DECISION_LLM_DIAGNOSTIC status=decision_unavailable reason=http_error failure_class=http_error http_status=[0-9]+ latency_ms=[0-9]+$/);
    assert.ok(log.includes('http_status=' + httpStatus));
    assert.doesNotMatch(log, /SECRET_SENTINEL|Bearer/);
  }
});

test('safe failure diagnostics distinguish timeout from transport exceptions', async () => {
  const timeout = await invoke({}, async () => { throw new DOMException('SENSITIVE_TIMEOUT_SENTINEL', 'TimeoutError'); });
  const transport = await invoke({}, async () => { throw new Error('SENSITIVE_TRANSPORT_SENTINEL'); });
  assert.equal(timeout.reason, 'request_failed');
  assert.equal(timeout.failureClass, 'timeout');
  assert.equal(transport.reason, 'request_failed');
  assert.equal(transport.failureClass, 'transport_error');
  assert.match(formatDecisionDiagnostic(timeout), /failure_class=timeout/);
  assert.match(formatDecisionDiagnostic(transport), /failure_class=transport_error/);
  assert.doesNotMatch(formatDecisionDiagnostic(timeout), /SENSITIVE/);
  assert.doesNotMatch(formatDecisionDiagnostic(transport), /SENSITIVE/);
});

test('safe failure diagnostics distinguish response read, JSON parse, and schema validation', async () => {
  const read = await invoke({}, async () => ({
    ok: true, text: async () => { throw new Error('SENSITIVE_READ_SENTINEL'); },
  }));
  const json = await invoke({}, async () => ({ ok: true, text: async () => '{not json SENSITIVE_JSON_SENTINEL' }));
  const schema = await invoke({}, async () => response({ answers: { review_strategy: { type: 'text', choice: 'fast' } } }));
  const tooLarge = await invoke({}, async () => ({ ok: true, text: async () => 'x'.repeat(1024 * 1024 + 1) }));
  for (const [value, kind] of [
    [read, 'response_read_error'], [json, 'response_json_invalid'],
    [schema, 'response_schema_invalid'], [tooLarge, 'response_too_large'],
  ]) {
    assert.equal(value.status, 'invalid_response');
    assert.equal(value.reason, 'invalid_response');
    assert.equal(value.failureClass, kind);
    assert.ok(formatDecisionDiagnostic(value).includes('failure_class=' + kind));
    assert.doesNotMatch(formatDecisionDiagnostic(value), /SENSITIVE_SENTINEL|SENSITIVE_|x{40}/);
  }
});

test('sanitized diagnostics never echo unexpected provider fields', async () => {
  const unavailable = await invoke({ apiKey: '' });
  assert.equal(unavailable.reason, 'missing_api_key');
  assert.match(formatDecisionDiagnostic(unavailable), /status=decision_unavailable reason=missing_api_key failure_class=not_sent http_status=none/);
  const good = await invoke();
  assert.match(formatDecisionDiagnostic(good), /status=decision_available reason=none failure_class=none http_status=none/);
  const hostile = formatDecisionDiagnostic({
    status: 'INJECTED_STATUS_SECRET', reason: 'INJECTED_REASON_SECRET',
    failureClass: 'INJECTED_FAILURE_SECRET', httpStatus: 'INJECTED_HTTP_SECRET',
    latencyMs: Number.POSITIVE_INFINITY, message: 'INJECTED_MESSAGE_SECRET',
  });
  assert.equal(hostile, 'DECISION_LLM_DIAGNOSTIC status=unknown reason=unknown failure_class=unknown http_status=none latency_ms=unknown');
});

test('safe failure diagnostics identify known transport causes without echoing codes or exceptions', async () => {
  for (const [causeCode, expectedClass] of [
    ['UND_ERR_CONNECT_TIMEOUT', 'timeout'],
    ['ETIMEDOUT', 'timeout'],
    ['ENOTFOUND', 'dns_error'],
    ['EAI_AGAIN', 'dns_error'],
    ['CERT_HAS_EXPIRED', 'tls_error'],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'tls_error'],
    ['ECONNREFUSED', 'connection_error'],
    ['ECONNRESET', 'connection_error'],
    ['UNEXPECTED_SECRET_SENTINEL', 'transport_error'],
  ]) {
    const result = await invoke({}, async () => {
      throw Object.assign(new Error('SENSITIVE_TRANSPORT_SENTINEL'), { cause: { code: causeCode } });
    });
    assert.equal(result.status, 'decision_unavailable');
    assert.equal(result.failureClass, expectedClass);
    const log = formatDecisionDiagnostic(result);
    assert.ok(log.includes('failure_class=' + expectedClass));
    assert.doesNotMatch(log, /SENSITIVE|SENTINEL|UND_ERR|ECONN|ENOTFOUND|CERT_HAS_EXPIRED/);
  }
});
