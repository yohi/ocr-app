import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRoutingDecisionRecord,
  writeRoutingDecision,
  createAttemptRecorder,
  finalizeRoutingAudit,
  writeRoutingAudit,
  validateRoutingDecisionRecord,
  validateRoutingAudit,
} from './ocr-routing-audit.mjs';

const binding = { workflowRunId: '9007199254740993', runAttempt: 2, headSha: 'a'.repeat(40), mode: 'enforce' };
const features = { classification_status: 'unclassified_code', risk_floor: 'deep', reviewable_file_count: 2, review_scope_gap: false, features_incomplete: false };
const route = { proposedStrategy: 'deep', selectedStrategy: 'deep', routeSource: 'deterministic_fallback', decisionStatus: 'unavailable', proposedReviewModel: 'claude-opus-4-6-thinking', selectedReviewModel: 'claude-opus-4-6-thinking' };
const versions = { policyVersion: '1.0.0', modelCatalogVersion: '1.0.0' };
const decision = () => createRoutingDecisionRecord({ runBinding: binding, features, decision: { latencyMs: null, cost: null }, egressStatus: 'denied', route, policyVersions: versions });
const catalog = { models: [{ model_id: 'claude-opus-4-6-thinking', capability_tier: 'deep', certification_status: 'certified' }] };
const event = (fields) => ({ schema_version: '1', run_attempt_id: 'a'.repeat(32), attempt_index: 1, event: 'attempt_started', model: 'claude-opus-4-6-thinking', result: null, timestamp: '2026-10-20T12:00:00.000Z', duration_ms: null, host_status: null, ...fields });

 test('decision record is strict, bound, and frozen', () => {
  const record = decision();
  assert.equal(Object.isFrozen(record), true);
  assert.deepEqual(Object.keys(record), ['schema_version','effective_mode','head_sha','workflow_run_id','run_attempt','classification_status','risk_floor','reviewable_file_count','proposed_strategy','selected_strategy','route_source','decision_status','egress_status','observer_status','decision_latency_ms','decision_api_cost','policy_version','feature_schema_version','decision_state_version','model_catalog_version']);
  assert.equal(Object.keys(record).length, 20);
});

test('decision record rejects an invalid enum and malformed binding', () => {
  assert.throws(() => createRoutingDecisionRecord({ runBinding: { ...binding, workflowRunId: 123 }, features, decision: {}, egressStatus: 'denied', route, policyVersions: versions }));
  assert.throws(() => createRoutingDecisionRecord({ runBinding: binding, features: { ...features, classification_status: 'private/path' }, decision: {}, egressStatus: 'denied', route, policyVersions: versions }));
  assert.throws(() => createRoutingDecisionRecord({ runBinding: binding, features: { ...features, reviewable_file_count: 1 }, decision: {}, egressStatus: 'denied', route: { ...route, routeSource: 'not_requested' }, policyVersions: versions }));
});

test('decision writer creates private files once', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
  try {
    writeRoutingDecision({ runTemp, record: decision() });
    const path = join(runTemp, 'ocr-routing', 'decision.json');
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).workflow_run_id, binding.workflowRunId);
    assert.equal(statSync(join(runTemp, 'ocr-routing')).mode & 0o777, 0o700);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.throws(() => writeRoutingDecision({ runTemp, record: decision() }));
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('attempt recorder rejects unknown events and does not persist catalog-external models', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
  try {
    const recorder = createAttemptRecorder({ runTemp, mode: 'shadow', catalog, runAttemptId: 'a'.repeat(32) });
    assert.equal(recorder.runAttemptId, 'a'.repeat(32));
    recorder.onAttemptEvent(event({ event: 'ignored' }));
    recorder.onAttemptEvent(event({ event: 'attempt_started', model: 'legacy-model' }));
    assert.equal(recorder.health(), 'unavailable');
    assert.equal(existsSync(join(runTemp, 'ocr-routing', 'attempts.ndjson')), false);
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('attempt recorder binds generated IDs and enforces attempts.ndjson mode', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
  try {
    const recorder = createAttemptRecorder({ runTemp, mode: 'enforce', catalog });
    assert.match(recorder.runAttemptId, /^[a-f0-9]{32}$/);
    recorder.onAttemptEvent(event({ run_attempt_id: recorder.runAttemptId }));
    recorder.onAttemptEvent(event({ run_attempt_id: recorder.runAttemptId, event: 'attempt_completed', result: 'host_validated_success', duration_ms: 12 }));
    recorder.seal();
    const attemptsPath = join(runTemp, 'ocr-routing', 'attempts.ndjson');
    assert.equal(statSync(attemptsPath).mode & 0o777, 0o600);
    assert.equal(readFileSync(attemptsPath, 'utf8').trim().split('\n').length, 2);
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('attempt recorder marks malformed events unavailable and throws only in enforce', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
  try {
    const shadow = createAttemptRecorder({ runTemp, mode: 'shadow', catalog, runAttemptId: 'a'.repeat(32) });
    shadow.onAttemptEvent(event({ timestamp: 'not-a-date' }));
    assert.equal(shadow.health(), 'unavailable');
    assert.equal(existsSync(join(runTemp, 'ocr-routing', 'attempts.ndjson')), false);
    const enforce = createAttemptRecorder({ runTemp: join(runTemp, 'enforce'), mode: 'enforce', catalog, runAttemptId: 'a'.repeat(32) });
    assert.throws(() => enforce.onAttemptEvent(event({ event: 'unknown' })), { message: 'AUDIT_EVENT_INVALID' });
    assert.throws(() => enforce.onAttemptEvent(event({ duration_ms: -1 })), { message: 'AUDIT_EVENT_INVALID' });
    assert.equal(enforce.health(), 'unavailable');
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('final audit only identifies a validated single host success', () => {
  const record = decision();
  const attempts = [
    event({ event: 'attempt_started' }),
    event({ event: 'attempt_completed', result: 'host_validated_success', duration_ms: 10 }),
    event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 10, host_status: 'success' }),
  ];
  const final = finalizeRoutingAudit({ decision: record, attempts, reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, ownerApprovalRef: null, review_scope_gap: false, features_incomplete: false }, catalog });
  assert.equal(Object.isFrozen(final), true);
  assert.equal(final.workflow_run_id, binding.workflowRunId);
  assert.equal(final.executed_review_model, 'claude-opus-4-6-thinking');
  assert.deepEqual(final.attempted_review_models, ['claude-opus-4-6-thinking']);
  const invalid = finalizeRoutingAudit({ decision: record, attempts: [], reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog });
  assert.equal(invalid.host_success_model, null);
  assert.equal(invalid.executed_review_model, null);
  const failedValidation = finalizeRoutingAudit({ decision: record, attempts, reviewResult: { status: 'success' }, validation: { status: 'failed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog });
  assert.equal(failedValidation.host_success_model, 'claude-opus-4-6-thinking');
  assert.equal(failedValidation.executed_review_model, null);
  const outOfOrder = finalizeRoutingAudit({ decision: record, attempts: [attempts[0], attempts[2], attempts[1]], reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog });
  assert.equal(outOfOrder.host_success_model, null);
  assert.deepEqual(Object.keys(final), ['schema_version','repo_id','repo','pr_number','head_sha','workflow_run_id','run_attempt','effective_mode','decision_status','egress_status','classification_status','risk_floor','selected_strategy','proposed_strategy','policy_version','feature_schema_version','decision_state_version','model_catalog_version','owner_approval_ref','proposed_review_model','selected_review_model','host_success_model','executed_review_model','attempted_review_models','review_validation_status','head_validation_status','audit_status','review_scope_gap','features_incomplete','review_quality_measured','decision_api_cost','latency_ms']);
  assert.equal(Object.keys(final).length, 32);
  assert.equal(Object.hasOwn(final, 'reviewable_file_count'), false);
});

  test('nested feature scope gap is preserved in final audit', () => {
  const final = finalizeRoutingAudit({ decision: decision(), attempts: [], reviewResult: { status: 'skipped' }, validation: { status: 'not_run' }, headCheck: { status: 'not_run' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, features: { review_scope_gap: true, features_incomplete: false } }, catalog });
  assert.equal(final.review_scope_gap, true);
});

test('final audit validates repo and owner approval ref bounds', () => {
  assert.throws(() => finalizeRoutingAudit({ decision: decision(), attempts: [], reviewResult: { status: 'skipped' }, validation: { status: 'not_run' }, headCheck: { status: 'not_run' }, runBinding: binding, policy: { repoId: 42, repo: 'a\n'.repeat(70), prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog }));
  assert.throws(() => finalizeRoutingAudit({ decision: decision(), attempts: [], reviewResult: { status: 'skipped' }, validation: { status: 'not_run' }, headCheck: { status: 'not_run' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, ownerApprovalRef: 'x'.repeat(129), review_scope_gap: false, features_incomplete: false }, catalog }));
  assert.throws(() => finalizeRoutingAudit({ decision: decision(), attempts: [], reviewResult: { status: 'skipped' }, validation: { status: 'not_run' }, headCheck: { status: 'not_run' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, ownerApprovalRef: 'bad ref!', review_scope_gap: false, features_incomplete: false }, catalog }));
});

test('final audit writer validates binding and seals final.json once with private modes', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
  try {
    const record = finalizeRoutingAudit({ decision: decision(), attempts: [], reviewResult: { status: 'skipped' }, validation: { status: 'not_run' }, headCheck: { status: 'not_run' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog });
    assert.doesNotThrow(() => validateRoutingAudit(record));
    writeRoutingAudit({ runTemp, record, expectedBinding: binding });
    const directory = join(runTemp, 'ocr-routing'); const path = join(directory, 'final.json');
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), record);
    assert.throws(() => writeRoutingAudit({ runTemp, record, expectedBinding: binding }));
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('final audit writer rejects a mismatched run binding', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
  try {
    const record = finalizeRoutingAudit({ decision: decision(), attempts: [], reviewResult: { status: 'skipped' }, validation: { status: 'not_run' }, headCheck: { status: 'not_run' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog });
    assert.throws(() => writeRoutingAudit({ runTemp, record, expectedBinding: { ...binding, runAttempt: 3 } }), { message: 'RUN_BINDING_MISMATCH' });
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});
