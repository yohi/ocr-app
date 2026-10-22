import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluatePublishEligibility } from './evaluate-routing-publish.mjs';
import {
  createRoutingDecisionRecord,
  writeRoutingDecision,
  createAttemptRecorder,
  finalizeRoutingAudit,
  writeRoutingAudit,
  validateRoutingDecisionRecord,
  validateRoutingAudit,
  validateRoutingAttempts,
} from './ocr-routing-audit.mjs';

const binding = { workflowRunId: '9007199254740993', runAttempt: 2, headSha: 'a'.repeat(40), mode: 'enforce' };
const features = { classification_status: 'unclassified_code', risk_floor: 'deep', reviewable_file_count: 2, review_scope_gap: false, features_incomplete: false };
const route = { proposedStrategy: 'deep', selectedStrategy: 'deep', routeSource: 'deterministic_fallback', decisionStatus: 'unavailable', proposedReviewModel: 'claude-opus-4-6-thinking', selectedReviewModel: 'claude-opus-4-6-thinking' };
const versions = { policyVersion: '1.0.0', modelCatalogVersion: '1.0.0' };
const decision = () => createRoutingDecisionRecord({ runBinding: binding, features, decision: { latencyMs: null, cost: null }, egressStatus: 'denied', route, policyVersions: versions });
const zeroReviewDecision = runBinding => createRoutingDecisionRecord({ runBinding, features: { ...features, reviewable_file_count: 0 }, decision: { latencyMs: null, cost: null }, egressStatus: 'denied', route: { ...route, selectedStrategy: null }, policyVersions: versions });
const catalog = { models: [{ model_id: 'claude-opus-4-6-thinking', capability_tier: 'deep', certification_status: 'certified' }] };
const realCatalog = JSON.parse(readFileSync(new URL('../config/review-model-catalog.json', import.meta.url), 'utf8'));
const certifiedRealCatalog = { ...realCatalog, models: realCatalog.models.map(model => ({ ...model, certification_status: 'certified', certification_reference: `sha256:${'a'.repeat(64)}` })) };
const realBundle = { catalog: certifiedRealCatalog, evidence: { certification_refs: certifiedRealCatalog.models.map(model => ({ model_id: model.model_id, certification_reference: model.certification_reference })), cli_available_models: certifiedRealCatalog.models.map(model => model.model_id) } };
const event = (fields) => ({ schema_version: '1', run_attempt_id: 'a'.repeat(32), run_attempt: binding.runAttempt, attempt_index: 1, event: 'attempt_started', model: 'claude-opus-4-6-thinking', result: null, timestamp: '2026-10-20T12:00:00.000Z', duration_ms: null, host_status: null, ...fields });

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
    const recorder = createAttemptRecorder({ runTemp, mode: 'shadow', catalog, runAttemptId: 'a'.repeat(32), runAttempt: binding.runAttempt });
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
    const recorder = createAttemptRecorder({ runTemp, mode: 'enforce', catalog, runAttempt: binding.runAttempt });
    assert.match(recorder.runAttemptId, /^[a-f0-9]{32}$/);
    recorder.onAttemptEvent(event({ run_attempt_id: recorder.runAttemptId }));
    recorder.onAttemptEvent(event({ run_attempt_id: recorder.runAttemptId, event: 'attempt_completed', result: 'host_validated_success', duration_ms: 12 }));
    recorder.seal();
    const attemptsPath = join(runTemp, 'ocr-routing', 'attempts.ndjson');
    assert.equal(statSync(attemptsPath).mode & 0o777, 0o600);
    assert.equal(readFileSync(attemptsPath, 'utf8').trim().split('\n').length, 2);
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('attempt recorder persists explicit startup and publication events with the bound attempt', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
  try {
    const recorder = createAttemptRecorder({ runTemp, mode: 'enforce', catalog, runAttemptId: 'a'.repeat(32), runAttempt: binding.runAttempt });
    recorder.recordStartup(binding);
    recorder.recordPublicationAttempt(binding.runAttempt);
    recorder.seal();
    const chain = readFileSync(join(runTemp, 'ocr-routing', 'attempts.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(chain, [
      { event: 'startup', run_attempt: binding.runAttempt, mode: binding.mode, binding },
      { event: 'publication', run_attempt: binding.runAttempt },
    ]);
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('attempt recorder rejects invalid run-attempt bindings and startup input', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
  try {
    assert.throws(() => createAttemptRecorder({ runTemp, mode: 'enforce', catalog, runAttempt: 0 }), { message: 'AUDIT_EVENT_INVALID: runAttempt must be a positive safe integer' });
    assert.throws(() => createAttemptRecorder({ runTemp, mode: 'enforce', catalog }), { message: 'AUDIT_EVENT_INVALID: runAttempt must be a positive safe integer' });
    const recorder = createAttemptRecorder({ runTemp, mode: 'enforce', catalog, runAttempt: binding.runAttempt });
    assert.throws(() => recorder.recordStartup(null), { message: 'AUDIT_EVENT_INVALID' });
    assert.throws(() => recorder.recordStartup({ ...binding, mode: 'shadow' }), { message: 'AUDIT_EVENT_INVALID' });
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('attempt recorder marks malformed events unavailable and throws only in enforce', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
  try {
    const shadow = createAttemptRecorder({ runTemp, mode: 'shadow', catalog, runAttemptId: 'a'.repeat(32), runAttempt: binding.runAttempt });
    shadow.onAttemptEvent(event({ timestamp: 'not-a-date' }));
    assert.equal(shadow.health(), 'unavailable');
    assert.equal(existsSync(join(runTemp, 'ocr-routing', 'attempts.ndjson')), false);
    const enforce = createAttemptRecorder({ runTemp: join(runTemp, 'enforce'), mode: 'enforce', catalog, runAttemptId: 'a'.repeat(32), runAttempt: binding.runAttempt });
    assert.throws(() => enforce.onAttemptEvent(event({ event: 'unknown' })), { message: 'AUDIT_EVENT_INVALID' });
    assert.throws(() => enforce.onAttemptEvent(event({ duration_ms: -1 })), { message: 'AUDIT_EVENT_INVALID' });
    assert.equal(enforce.health(), 'unavailable');
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('final audit only identifies a validated single host success', () => {
  const record = decision();
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
  try {
  const recorder = createAttemptRecorder({ runTemp, mode: binding.mode, catalog, runAttemptId: 'a'.repeat(32), runAttempt: binding.runAttempt });
  recorder.recordStartup(binding);
  recorder.onAttemptEvent(event({ event: 'attempt_started', run_attempt_id: recorder.runAttemptId }));
  recorder.onAttemptEvent(event({ event: 'attempt_completed', run_attempt_id: recorder.runAttemptId, result: 'host_validated_success', duration_ms: 10 }));
  recorder.onAttemptEvent(event({ event: 'host_completed', run_attempt_id: recorder.runAttemptId, attempt_index: null, model: null, result: null, duration_ms: 10, host_status: 'success' }));
  recorder.recordPublicationAttempt(binding.runAttempt);
  recorder.seal();
  const attempts = readFileSync(join(runTemp, 'ocr-routing', 'attempts.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
  const selectedRoute = { selected_model_id: 'claude-opus-4-6-thinking', fallback_models: [], selected_strategy: 'deep', proposed_strategy: 'deep' };
  const certifiedBundle = { catalog, evidence: { certification_refs: [], cli_available_models: ['claude-opus-4-6-thinking'] } };
  const finalize = options => finalizeRoutingAudit({ decision: record, attempts, reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, ownerApprovalRef: null, proposedReviewModel: 'claude-opus-4-6-thinking', selectedReviewModel: 'claude-opus-4-6-thinking', review_scope_gap: false, features_incomplete: false }, catalog, selectedRoute, certifiedBundle, runTemp, ...options });
  const final = finalize({});
  assert.equal(Object.isFrozen(final), true);
  assert.equal(final.workflow_run_id, binding.workflowRunId);
  assert.equal(final.executed_review_model, 'claude-opus-4-6-thinking');
  assert.deepEqual(final.attempted_review_models, ['claude-opus-4-6-thinking']);
  const publish = evaluatePublishEligibility({ mode: 'enforce', expectedBinding: binding, decisionRecord: record, finalAudit: final, delivery: { outcome: 'success', artifactId: 'artifact-1', runId: binding.workflowRunId, runAttempt: binding.runAttempt }, checkRunId: '123', startupAuthorization: { authorized: true, approvalRefs: ['OWNER-APPROVED'] }, headSha: binding.headSha, selectedRoute: { selected_model_id: 'claude-opus-4-6-thinking', fallback_models: [], selected_strategy: 'deep' }, attempts, certifiedBundle: realBundle });
  assert.equal(publish.authorized, true);
  assert.equal(publish.reason, 'PUBLISH_AUTHORIZED');
  assert.throws(() => finalizeRoutingAudit({ decision: record, attempts: [], reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog }), { message: 'AUDIT_EVENT_INVALID' });
  const failedValidation = finalize({ validation: { status: 'failed' } });
  assert.equal(failedValidation.host_success_model, 'claude-opus-4-6-thinking');
  assert.equal(failedValidation.executed_review_model, null);
  assert.throws(() => finalizeRoutingAudit({ decision: record, attempts: [attempts[0], attempts[2], attempts[1]], reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog, selectedRoute, certifiedBundle, runTemp }), { message: 'AUDIT_EVENT_INVALID' });
  assert.deepEqual(Object.keys(final), ['schema_version','repo_id','repo','pr_number','head_sha','workflow_run_id','run_attempt','effective_mode','decision_status','egress_status','classification_status','risk_floor','selected_strategy','proposed_strategy','policy_version','feature_schema_version','decision_state_version','model_catalog_version','owner_approval_ref','proposed_review_model','selected_review_model','host_success_model','executed_review_model','attempted_review_models','review_validation_status','head_validation_status','audit_status','review_scope_gap','features_incomplete','review_quality_measured','decision_api_cost','latency_ms']);
  assert.equal(Object.keys(final).length, 32);
  assert.equal(Object.hasOwn(final, 'reviewable_file_count'), false);
  assert.throws(() => finalizeRoutingAudit({ decision: record, attempts: attempts.map(item => item.event === 'publication' ? { ...item, run_attempt: 999 } : item), reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog, selectedRoute, certifiedBundle, runTemp }), { message: 'AUDIT_EVENT_INVALID' });
  assert.throws(() => finalizeRoutingAudit({ decision: record, attempts, reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog, selectedRoute, certifiedBundle, runTemp, ignored: true }), { message: 'AUDIT_EVENT_INVALID' });
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('final audit requires the context-bound startup and terminal publication chain', () => {
  const start = { event: 'startup', run_attempt: binding.runAttempt, mode: 'enforce', binding };
  const publication = { event: 'publication', run_attempt: binding.runAttempt };
  const started = event({ event: 'attempt_started', run_attempt: binding.runAttempt });
  const completed = event({ event: 'attempt_completed', run_attempt: binding.runAttempt, result: 'host_validated_success', duration_ms: 10 });
  const hostCompleted = event({ event: 'host_completed', run_attempt: binding.runAttempt, attempt_index: null, model: null, result: null, duration_ms: 10, host_status: 'success' });
  const finalize = attempts => {
    const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
    try {
      mkdirSync(join(runTemp, 'ocr-routing'));
      writeFileSync(join(runTemp, 'ocr-routing', 'attempts.ndjson'), `${attempts.map(item => JSON.stringify(item)).join('\n')}\n`);
      return finalizeRoutingAudit({ decision: decision(), attempts, reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog, selectedRoute: { selected_model_id: 'claude-opus-4-6-thinking', fallback_models: [], selected_strategy: 'deep' }, certifiedBundle: { catalog, evidence: { certification_refs: [], cli_available_models: ['claude-opus-4-6-thinking'] } }, runTemp });
    } finally { rmSync(runTemp, { recursive: true, force: true }); }
  };

  const record = finalize([start, started, completed, hostCompleted, publication]);
  assert.equal(record.executed_review_model, 'claude-opus-4-6-thinking');
  for (const invalid of [
    [{ ...start, binding: { ...binding, runAttempt: binding.runAttempt + 1 } }, started, completed, hostCompleted, publication],
    [started, completed, hostCompleted, publication],
    [start, event({ event: 'host_completed', run_attempt: binding.runAttempt, attempt_index: null, model: null, result: null, duration_ms: 10, host_status: 'success' }), publication],
    [start, started, completed, hostCompleted, publication, publication],
    [start, started, completed, publication, hostCompleted],
    [start, { ...started, run_attempt: binding.runAttempt + 1 }, completed, hostCompleted, publication],
    [start, started, completed, completed, hostCompleted, publication],
    [start, started, completed, hostCompleted, event({ event: 'attempt_started', attempt_index: 2 }), publication],
    [start, started, event({ event: 'attempt_completed', result: 'model_reported_failure', duration_ms: 10 }), event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 10, host_status: 'failed' }), event({ event: 'attempt_started', attempt_index: 2 }), event({ event: 'attempt_completed', attempt_index: 2, result: 'model_reported_failure', duration_ms: 10 }), publication],
    [start, started, completed, hostCompleted, event({ event: 'attempt_started', attempt_index: 2 }), event({ event: 'attempt_completed', attempt_index: 2, result: 'model_reported_failure', duration_ms: 10 }), publication],
    [start, event({ event: 'attempt_started', run_attempt_id: 'b'.repeat(32) }), completed, hostCompleted, publication],
    [start, started, completed, event({ event: 'attempt_completed', result: 'host_validated_success', duration_ms: 10 }), hostCompleted, publication],
  ]) assert.throws(() => finalize(invalid), { message: 'AUDIT_EVENT_INVALID' });
  assert.throws(() => finalize([]), { message: 'AUDIT_EVENT_INVALID' });
});

test('fallback success is sealed without impersonating the primary model', () => {
  const started = (index, model) => event({ event: 'attempt_started', attempt_index: index, model });
  const completed = (index, model, result) => event({ event: 'attempt_completed', attempt_index: index, model, result, duration_ms: 10 });
  const primary = certifiedRealCatalog.models.find(model => model.capability_tier === 'fast').model_id;
  const fallback = certifiedRealCatalog.models.find(model => model.model_id === primary).allowed_fallbacks[0];
  const bundle = realBundle;
  const chain = [
    { event: 'startup', run_attempt: binding.runAttempt, mode: binding.mode, binding },
    started(1, primary), completed(1, primary, 'model_reported_failure'),
    started(2, fallback), completed(2, fallback, 'host_validated_success'),
    event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 20, host_status: 'success' }),
    { event: 'publication', run_attempt: binding.runAttempt },
  ];
  const selectedRoute = { selected_model_id: primary, fallback_models: [fallback], selected_strategy: 'fast', proposed_strategy: 'fast' };
  assert.deepEqual(validateRoutingAttempts({ attempts: chain, selectedRoute, certifiedBundle: bundle }), {
    attemptedModels: [primary, fallback], successModel: fallback,
  });
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
  try {
    mkdirSync(join(runTemp, 'ocr-routing'));
    writeFileSync(join(runTemp, 'ocr-routing', 'attempts.ndjson'), `${chain.map(item => JSON.stringify(item)).join('\n')}\n`);
    const fastDecision = createRoutingDecisionRecord({ runBinding: binding, features: { ...features, risk_floor: 'fast' }, decision: { latencyMs: null, cost: null }, egressStatus: 'denied', route: { ...route, proposedStrategy: 'fast', selectedStrategy: 'fast', proposedReviewModel: primary, selectedReviewModel: primary }, policyVersions: versions });
    const final = finalizeRoutingAudit({ decision: fastDecision, attempts: chain, reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, proposedReviewModel: primary, selectedReviewModel: primary, review_scope_gap: false, features_incomplete: false }, catalog: bundle.catalog, selectedRoute, certifiedBundle: bundle, runTemp });
    assert.equal(final.risk_floor, 'fast');
    assert.equal(final.selected_strategy, 'fast');
    assert.equal(final.proposed_strategy, 'fast');
    assert.equal(final.selected_review_model, primary);
    assert.equal(final.host_success_model, fallback);
    assert.equal(final.executed_review_model, fallback);
    assert.deepEqual(final.attempted_review_models, [primary, fallback]);
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('route validation rejects out-of-chain models and unavailable bundle models', () => {
  const chain = [
    { event: 'startup', run_attempt: binding.runAttempt, mode: binding.mode, binding },
    event({ event: 'attempt_started' }),
    event({ event: 'attempt_completed', result: 'host_validated_success', duration_ms: 10 }),
    event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 10, host_status: 'success' }),
    { event: 'publication', run_attempt: binding.runAttempt },
  ];
  const bundle = { catalog, evidence: { certification_refs: [], cli_available_models: ['claude-opus-4-6-thinking'] } };
  assert.throws(() => validateRoutingAttempts({ attempts: chain, selectedRoute: { selected_model_id: 'other-model', fallback_models: [], selected_strategy: 'deep' }, certifiedBundle: bundle }), { message: 'AUDIT_EVENT_INVALID' });
  assert.throws(() => validateRoutingAttempts({ attempts: chain, selectedRoute: { selected_model_id: 'claude-opus-4-6-thinking', fallback_models: [], selected_strategy: 'deep' }, certifiedBundle: { ...bundle, evidence: { ...bundle.evidence, cli_available_models: [] } } }), { message: 'AUDIT_EVENT_INVALID' });
  assert.throws(() => validateRoutingAttempts({ attempts: chain, selectedRoute: { selected_model_id: 'claude-opus-4-6-thinking', fallback_models: [], selected_strategy: 'deep' }, certifiedBundle: { ...bundle, catalog: { models: [{ model_id: 'claude-opus-4-6-thinking', capability_tier: 'fast' }] } } }), { message: 'AUDIT_EVENT_INVALID' });
});

test('route validation rejects completed attempts that regress from fallback to primary', () => {
  const primary = 'claude-opus-4-6-thinking';
  const fallback = 'claude-sonnet-4-6';
  const route = { selected_model_id: primary, fallback_models: [fallback], selected_strategy: 'deep' };
  const bundle = { catalog: { models: [...catalog.models, { model_id: fallback, capability_tier: 'deep', certification_status: 'certified' }] }, evidence: { certification_refs: [], cli_available_models: [primary, fallback] } };
  const chain = [
    { event: 'startup', run_attempt: binding.runAttempt, mode: binding.mode, binding },
    event({ event: 'attempt_started', attempt_index: 1, model: fallback }),
    event({ event: 'attempt_completed', attempt_index: 1, model: fallback, result: 'model_reported_failure', duration_ms: 5 }),
    event({ event: 'attempt_started', attempt_index: 2, model: primary }),
    event({ event: 'attempt_completed', attempt_index: 2, model: primary, result: 'host_validated_success', duration_ms: 5 }),
    event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 10, host_status: 'success' }),
    { event: 'publication', run_attempt: binding.runAttempt },
  ];
  assert.throws(() => validateRoutingAttempts({ attempts: chain, selectedRoute: route, certifiedBundle: bundle }), { message: 'AUDIT_EVENT_INVALID' });
});

test('skipped Host completion leaves the success model null', () => {
  const skippedChain = [
    { event: 'startup', run_attempt: binding.runAttempt, mode: binding.mode, binding },
    event({ event: 'attempt_started' }),
    event({ event: 'attempt_completed', result: 'host_skipped', duration_ms: 1 }),
    event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 1, host_status: 'skipped' }),
    { event: 'publication', run_attempt: binding.runAttempt },
  ];
  assert.equal(validateRoutingAttempts({ attempts: skippedChain, selectedRoute: { selected_model_id: 'claude-opus-4-6-thinking', fallback_models: [], selected_strategy: 'deep' }, certifiedBundle: { catalog, evidence: { certification_refs: [], cli_available_models: ['claude-opus-4-6-thinking'] } } }).successModel, null);
});

test('same-model retries remain distinct chain attempts while output model list is unique', () => {
  const first = event({ event: 'attempt_started', attempt_index: 1 });
  const second = event({ event: 'attempt_started', attempt_index: 2 });
  const chain = [
    { event: 'startup', run_attempt: binding.runAttempt, mode: binding.mode, binding },
    first, event({ event: 'attempt_completed', attempt_index: 1, result: 'timeout', duration_ms: 10 }),
    second, event({ event: 'attempt_completed', attempt_index: 2, result: 'host_validated_success', duration_ms: 10 }),
    event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 20, host_status: 'success' }),
    { event: 'publication', run_attempt: binding.runAttempt },
  ];
  const validation = validateRoutingAttempts({ attempts: chain, selectedRoute: { selected_model_id: 'claude-opus-4-6-thinking', fallback_models: [], selected_strategy: 'deep' }, certifiedBundle: { catalog, evidence: { certification_refs: [], cli_available_models: ['claude-opus-4-6-thinking'] } } });
  assert.deepEqual(validation.attemptedModels, ['claude-opus-4-6-thinking', 'claude-opus-4-6-thinking']);
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
  try {
    mkdirSync(join(runTemp, 'ocr-routing'));
    writeFileSync(join(runTemp, 'ocr-routing', 'attempts.ndjson'), `${chain.map(item => JSON.stringify(item)).join('\n')}\n`);
    const final = finalizeRoutingAudit({ decision: decision(), attempts: chain, reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog, selectedRoute: { selected_model_id: 'claude-opus-4-6-thinking', fallback_models: [], selected_strategy: 'deep' }, certifiedBundle: { catalog, evidence: { certification_refs: [], cli_available_models: ['claude-opus-4-6-thinking'] } }, runTemp });
    assert.deepEqual(final.attempted_review_models, ['claude-opus-4-6-thinking']);
    assert.equal(final.host_success_model, 'claude-opus-4-6-thinking');
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('zero-review skip permits an empty event chain', () => {
  const emptyDecision = createRoutingDecisionRecord({ runBinding: binding, features: { ...features, reviewable_file_count: 0 }, decision: { latencyMs: null, cost: null }, egressStatus: 'denied', route, policyVersions: versions });
  const result = finalizeRoutingAudit({ decision: emptyDecision, attempts: [], reviewResult: { status: 'skipped' }, validation: { status: 'not_run' }, headCheck: { status: 'not_run' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog });
  assert.equal(result.executed_review_model, null);
  assert.throws(() => finalizeRoutingAudit({ decision: emptyDecision, attempts: [], reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog }), { message: 'AUDIT_EVENT_INVALID' });
});

test('shadow successful review records completed, success, and executed models without enforce events', () => {
  const shadowBinding = { ...binding, mode: 'shadow' };
  const shadowDecision = createRoutingDecisionRecord({ runBinding: shadowBinding, features, decision: { latencyMs: null, cost: null }, egressStatus: 'denied', route: { ...route, selectedStrategy: null }, policyVersions: versions });
  const shadowAttempts = [
    event({ event: 'attempt_started', run_attempt: shadowBinding.runAttempt }),
    event({ event: 'attempt_completed', run_attempt: shadowBinding.runAttempt, result: 'host_validated_success', duration_ms: 10 }),
    event({ event: 'host_completed', run_attempt: shadowBinding.runAttempt, attempt_index: null, model: null, result: null, duration_ms: 10, host_status: 'success' }),
  ];
  const audit = finalizeRoutingAudit({ decision: shadowDecision, attempts: shadowAttempts, reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: shadowBinding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog });
  assert.deepEqual(audit.attempted_review_models, ['claude-opus-4-6-thinking']);
  assert.equal(audit.host_success_model, 'claude-opus-4-6-thinking');
  assert.equal(audit.executed_review_model, 'claude-opus-4-6-thinking');
});

test('two successful Host completion events are rejected and cannot execute a model', () => {
  const twoSuccesses = [
    { event: 'startup', run_attempt: binding.runAttempt, mode: binding.mode, binding },
    event({ event: 'attempt_started', attempt_index: 1 }),
    event({ event: 'attempt_completed', attempt_index: 1, result: 'host_validated_success', duration_ms: 10 }),
    event({ event: 'attempt_started', attempt_index: 2 }),
    event({ event: 'attempt_completed', attempt_index: 2, result: 'host_validated_success', duration_ms: 10 }),
    event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 20, host_status: 'success' }),
    event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 20, host_status: 'success' }),
    { event: 'publication', run_attempt: binding.runAttempt },
  ];
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
  try {
    mkdirSync(join(runTemp, 'ocr-routing'));
    writeFileSync(join(runTemp, 'ocr-routing', 'attempts.ndjson'), `${twoSuccesses.map(item => JSON.stringify(item)).join('\n')}\n`);
    let finalRecord = null;
    assert.throws(() => {
  finalRecord = finalizeRoutingAudit({ decision: decision(), attempts: twoSuccesses, reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog, selectedRoute: { selected_model_id: 'claude-opus-4-6-thinking', fallback_models: [], selected_strategy: 'deep' }, certifiedBundle: { catalog, evidence: { certification_refs: [], cli_available_models: ['claude-opus-4-6-thinking'] } }, runTemp });
    }, { message: 'AUDIT_EVENT_INVALID' });
    assert.equal(finalRecord?.executed_review_model ?? null, null);
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('nested feature scope gap is preserved in final audit', () => {
  const final = finalizeRoutingAudit({ decision: zeroReviewDecision(binding), attempts: [], reviewResult: { status: 'skipped' }, validation: { status: 'not_run' }, headCheck: { status: 'not_run' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, features: { review_scope_gap: true, features_incomplete: false } }, catalog });
  assert.equal(final.review_scope_gap, true);
});

test('final audit validates repo and owner approval ref bounds', () => {
  assert.throws(() => finalizeRoutingAudit({ decision: zeroReviewDecision(binding), attempts: [], reviewResult: { status: 'skipped' }, validation: { status: 'not_run' }, headCheck: { status: 'not_run' }, runBinding: binding, policy: { repoId: 42, repo: 'a\n'.repeat(70), prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog }));
  assert.throws(() => finalizeRoutingAudit({ decision: zeroReviewDecision(binding), attempts: [], reviewResult: { status: 'skipped' }, validation: { status: 'not_run' }, headCheck: { status: 'not_run' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, ownerApprovalRef: 'x'.repeat(129), review_scope_gap: false, features_incomplete: false }, catalog }));
  assert.throws(() => finalizeRoutingAudit({ decision: zeroReviewDecision(binding), attempts: [], reviewResult: { status: 'skipped' }, validation: { status: 'not_run' }, headCheck: { status: 'not_run' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, ownerApprovalRef: 'bad ref!', review_scope_gap: false, features_incomplete: false }, catalog }));
});

test('final audit writer validates binding and seals final.json once with private modes', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
  try {
    const record = finalizeRoutingAudit({ decision: zeroReviewDecision(binding), attempts: [], reviewResult: { status: 'skipped' }, validation: { status: 'not_run' }, headCheck: { status: 'not_run' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog });
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
    const record = finalizeRoutingAudit({ decision: zeroReviewDecision(binding), attempts: [], reviewResult: { status: 'skipped' }, validation: { status: 'not_run' }, headCheck: { status: 'not_run' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog });
    assert.throws(() => writeRoutingAudit({ runTemp, record, expectedBinding: { ...binding, runAttempt: 3 } }), { message: 'RUN_BINDING_MISMATCH' });
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});
