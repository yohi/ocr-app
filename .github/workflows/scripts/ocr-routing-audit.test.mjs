import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRoutingDecisionRecord,
  writeRoutingDecision,
  createAttemptRecorder,
  finalizeRoutingAudit,
} from './ocr-routing-audit.mjs';

const binding = { workflowRunId: '9007199254740993', runAttempt: 2, headSha: 'a'.repeat(40), mode: 'enforce' };
const features = { classification_status: 'unclassified_code', risk_floor: 'deep', reviewable_file_count: 2, review_scope_gap: false, features_incomplete: false };
const route = { proposedStrategy: 'deep', selectedStrategy: 'deep', routeSource: 'deterministic_fallback', decisionStatus: 'unavailable', proposedReviewModel: 'claude-opus-4-6-thinking', selectedReviewModel: 'claude-opus-4-6-thinking' };
const versions = { policyVersion: '1.0.0', modelCatalogVersion: '1.0.0' };
const decision = () => createRoutingDecisionRecord({ runBinding: binding, features, decision: { latencyMs: null, cost: null }, egressStatus: 'denied', route, policyVersions: versions });
const catalog = { models: [{ model_id: 'claude-opus-4-6-thinking', capability_tier: 'deep', certification_status: 'certified' }] };
const event = (fields) => ({ schema_version: '1', run_attempt_id: 'attempt-id', attempt_index: 1, event: 'attempt_started', model: 'claude-opus-4-6-thinking', result: null, timestamp: '2026-10-20T12:00:00.000Z', duration_ms: null, host_status: null, ...fields });

 test('decision record is strict, bound, and frozen', () => {
  const record = decision();
  assert.equal(Object.isFrozen(record), true);
  assert.deepEqual(Object.keys(record), ['schema_version','effective_mode','head_sha','workflow_run_id','run_attempt','classification_status','risk_floor','reviewable_file_count','proposed_strategy','selected_strategy','route_source','decision_status','egress_status','observer_status','decision_latency_ms','decision_api_cost','policy_version','feature_schema_version','decision_state_version','model_catalog_version']);
  assert.equal(record.workflow_run_id, binding.workflowRunId);
  assert.equal(record.observer_status, 'not_started');
  assert.equal(record.decision_api_cost, null);
  assert.equal(Object.hasOwn(record, 'secret'), false);
});

test('decision record rejects an invalid enum and malformed binding', () => {
  assert.throws(() => createRoutingDecisionRecord({ runBinding: { ...binding, workflowRunId: 123 }, features, decision: {}, egressStatus: 'denied', route, policyVersions: versions }));
  assert.throws(() => createRoutingDecisionRecord({ runBinding: binding, features: { ...features, classification_status: 'private/path' }, decision: {}, egressStatus: 'denied', route, policyVersions: versions }));
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

test('attempt recorder validates events, ignores irrelevant events, and marks external models unavailable', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
  try {
    const recorder = createAttemptRecorder({ runTemp, mode: 'shadow', catalog });
    recorder.onAttemptEvent(event({ event: 'ignored' }));
    recorder.onAttemptEvent(event({ event: 'attempt_started', model: 'legacy-model' }));
    recorder.onAttemptEvent(event({ event: 'attempt_completed', result: 'host_validated_success', duration_ms: 12 }));
    assert.equal(recorder.health(), 'unavailable');
    recorder.seal();
    assert.equal(readFileSync(join(runTemp, 'ocr-routing', 'attempts.ndjson'), 'utf8').trim().split('\n').length, 2);
    recorder.onAttemptEvent(event({ event: 'attempt_started' }));
    assert.equal(readFileSync(join(runTemp, 'ocr-routing', 'attempts.ndjson'), 'utf8').trim().split('\n').length, 2);
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('attempt recorder marks malformed events unavailable and throws only in enforce', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
  try {
    const shadow = createAttemptRecorder({ runTemp, mode: 'shadow', catalog });
    shadow.onAttemptEvent(event({ timestamp: 'not-a-date' }));
    assert.equal(shadow.health(), 'unavailable');
    const enforce = createAttemptRecorder({ runTemp: join(runTemp, 'enforce'), mode: 'enforce', catalog });
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
  const final = finalizeRoutingAudit({ decision: record, attempts, reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, ownerApprovalRef: null }, catalog });
  assert.equal(Object.isFrozen(final), true);
  assert.equal(final.workflow_run_id, binding.workflowRunId);
  assert.equal(final.executed_review_model, 'claude-opus-4-6-thinking');
  assert.deepEqual(final.attempted_review_models, ['claude-opus-4-6-thinking']);
  const invalid = finalizeRoutingAudit({ decision: record, attempts: [], reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7 }, catalog });
  assert.equal(invalid.host_success_model, null);
  assert.equal(invalid.executed_review_model, null);
  const failedValidation = finalizeRoutingAudit({ decision: record, attempts, reviewResult: { status: 'success' }, validation: { status: 'failed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7 }, catalog });
  assert.equal(failedValidation.host_success_model, 'claude-opus-4-6-thinking');
  assert.equal(failedValidation.executed_review_model, null);
  const outOfOrder = finalizeRoutingAudit({ decision: record, attempts: [attempts[0], attempts[2], attempts[1]], reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7 }, catalog });
  assert.equal(outOfOrder.host_success_model, null);
});
