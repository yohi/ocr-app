import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluatePublishEligibility } from './evaluate-routing-publish.mjs';
import {
  createRoutingLogSummary,
  formatRoutingAuditDiagnostic,
  createRoutingDecisionRecord,
  writeRoutingDecision,
  createAttemptRecorder,
  finalizeRoutingAudit as finalizeRoutingAuditCore,
  writeRoutingAudit,
  validateRoutingDecisionRecord,
  validateRoutingAudit,
  validateRoutingAttempts,
} from './ocr-routing-audit.mjs';

const finalizeRoutingAudit = input => finalizeRoutingAuditCore({ resultSha256: 'a'.repeat(64), ...input });

const binding = { workflowRunId: '9007199254740993', runAttempt: 2, headSha: 'a'.repeat(40), mode: 'enforce' };
const features = { classification_status: 'unclassified_code', risk_floor: 'deep', reviewable_file_count: 2, review_scope_gap: false, features_incomplete: false };
const realCatalog = JSON.parse(readFileSync(new URL('../config/review-model-catalog.json', import.meta.url), 'utf8'));
const proCliModelInventory = [
  { model_id: 'gemini-3.8-flash-medium', capability_tier: 'fast', allowed_fallbacks: ['claude-opus-5-5-high', 'gemini-4-argon-high', 'claude-sonnet-5-5-high'] },
  { model_id: 'claude-opus-5-5-high', capability_tier: 'deep', allowed_fallbacks: ['gemini-4-argon-high', 'claude-sonnet-5-5-high'] },
  { model_id: 'claude-opus-5-5-medium', capability_tier: 'deep', allowed_fallbacks: [] },
  { model_id: 'claude-opus-5-5-low', capability_tier: 'deep', allowed_fallbacks: [] },
  { model_id: 'claude-sonnet-5-5-high', capability_tier: 'deep', allowed_fallbacks: [] },
  { model_id: 'claude-sonnet-5-5-medium', capability_tier: 'deep', allowed_fallbacks: [] },
  { model_id: 'claude-sonnet-5-5-low', capability_tier: 'deep', allowed_fallbacks: [] },
  { model_id: 'gemini-3.8-flash-high', capability_tier: 'fast', allowed_fallbacks: ['claude-opus-5-5-high', 'gemini-4-argon-high'] },
  { model_id: 'gemini-3.8-flash-low', capability_tier: 'fast', allowed_fallbacks: ['claude-opus-5-5-high', 'gemini-4-argon-high'] },
  { model_id: 'gemini-4-argon-high', capability_tier: 'deep', allowed_fallbacks: [] },
  { model_id: 'gemini-4-argon-medium', capability_tier: 'deep', allowed_fallbacks: [] },
  { model_id: 'gemini-4-argon-low', capability_tier: 'deep', allowed_fallbacks: [] },
  { model_id: 'gpt-oss-120b-medium', capability_tier: 'deep', allowed_fallbacks: [] },
  { model_id: 'gemini-4-hydrogen-high', capability_tier: 'deep', allowed_fallbacks: [] },
];
const deepModel = 'claude-opus-5-5-high';
const certificationReference = `sha256:${'a'.repeat(64)}`;
const catalogVersion = '1.0.1';
const certifiedRealCatalog = {
  schema_version: '1',
  catalog_version: catalogVersion,
  models: proCliModelInventory.map(model => ({ ...model, certification_status: 'certified', certification_reference: certificationReference, catalog_version: catalogVersion })),
  strategies: {
    fast: { preferred_model_id: 'gemini-3.8-flash-medium' },
    deep: { preferred_model_id: deepModel },
  },
  unknown_risk_strategy: 'deep',
};
const deepPublishRoute = { selected_model_id: deepModel, fallback_models: ['gemini-4-argon-high', 'claude-sonnet-5-5-high'], selected_strategy: 'deep', proposed_strategy: 'deep' };
const route = { proposedStrategy: 'deep', selectedStrategy: 'deep', routeSource: 'deterministic_fallback', decisionStatus: 'unavailable', proposedReviewModel: deepModel, selectedReviewModel: deepModel };
const versions = { policyVersion: '1.0.0', modelCatalogVersion: catalogVersion };
const decision = () => createRoutingDecisionRecord({ runBinding: binding, features, decision: { latencyMs: null, cost: null }, egressStatus: 'denied', route, policyVersions: versions });
const zeroReviewDecision = runBinding => createRoutingDecisionRecord({ runBinding, features: { ...features, reviewable_file_count: 0 }, decision: { latencyMs: null, cost: null }, egressStatus: 'denied', route: { ...route, selectedStrategy: null }, policyVersions: versions });
const summaryAudit = overrides => ({
  schema_version: '3', repo_id: 42, repo: 'owner/repo', pr_number: 7,
  head_sha: binding.headSha, workflow_run_id: binding.workflowRunId, run_attempt: binding.runAttempt,
  effective_mode: 'enforce', decision_llm_enabled: false, decision_status: 'not_requested', egress_status: 'denied',
  classification_status: 'unclassified_code', risk_floor: 'deep', selected_strategy: 'deep', proposed_strategy: 'deep',
  policy_version: versions.policyVersion, feature_schema_version: '3', decision_state_version: '1', model_catalog_version: versions.modelCatalogVersion,
  owner_approval_ref: null, proposed_review_model: 'gemini-3.8-flash-medium', selected_review_model: 'gemini-3.8-flash-medium',
  host_success_model: 'gemini-3.8-flash-medium', executed_review_model: 'gemini-3.8-flash-medium',
  attempted_review_models: ['gemini-3.8-flash-medium'], result_sha256: 'a'.repeat(64),
  review_validation_status: 'passed', head_validation_status: 'passed', audit_status: 'sealed',
  review_scope_gap: false, features_incomplete: false, review_quality_measured: true,
  decision_api_cost: null, latency_ms: null,
  ...overrides,
});
const catalog = { models: [{ model_id: deepModel, capability_tier: 'deep', certification_status: 'certified' }] };
const realBundle = { catalog: certifiedRealCatalog, evidence: {
  certification_refs: proCliModelInventory.map(model => ({ model_id: model.model_id,
    certification_reference: certificationReference, capability_tier: model.capability_tier,
    catalog_version: catalogVersion })),
  cli_available_models: proCliModelInventory.map(model => model.model_id),
} };
const event = (fields) => ({ schema_version: '1', run_attempt_id: 'a'.repeat(32), attempt_index: 1, event: 'attempt_started', model: deepModel, result: null, timestamp: '2026-10-20T12:00:00.000Z', duration_ms: null, host_status: null, ...fields });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('anchors the catalog and certified publish fixture to the Pro CLI inventory', () => {
  assert.equal(realCatalog.catalog_version, catalogVersion);
  assert.deepEqual(realCatalog.strategies, certifiedRealCatalog.strategies);
  assert.deepEqual(realCatalog.models.map(({ model_id, capability_tier, allowed_fallbacks }) => ({ model_id, capability_tier, allowed_fallbacks })), proCliModelInventory);
  assert.deepEqual(certifiedRealCatalog.models.map(({ model_id, certification_reference, capability_tier, catalog_version }) => ({ model_id, certification_reference, capability_tier, catalog_version })),
    proCliModelInventory.map(({ model_id, capability_tier }) => ({ model_id, certification_reference: certificationReference, capability_tier, catalog_version: catalogVersion })));
  assert.deepEqual(realBundle.evidence.cli_available_models, proCliModelInventory.map(({ model_id }) => model_id));
  assert.deepEqual(realBundle.evidence.certification_refs, proCliModelInventory.map(({ model_id, capability_tier }) => ({
    model_id, certification_reference: certificationReference, capability_tier, catalog_version: catalogVersion,
  })));
  assert.deepEqual(deepPublishRoute, {
    selected_model_id: 'claude-opus-5-5-high',
    fallback_models: ['gemini-4-argon-high', 'claude-sonnet-5-5-high'],
    selected_strategy: 'deep',
    proposed_strategy: 'deep',
  });
});

async function loadResultEvidenceVerifier() {
  const audit = await import('./ocr-routing-audit.mjs');
  assert.equal(typeof audit.verifyValidatedResultEvidence, 'function');
  return audit.verifyValidatedResultEvidence;
}

test('preserves passed validation for matching result bytes', async () => {
  const verify = await loadResultEvidenceVerifier();
  const rawBytes = Buffer.from('{"status":"success"}\n');
  assert.deepEqual(verify({ rawBytes, validatedResultSha256: sha256(rawBytes), validationStatus: 'passed' }), {
    reviewValidationStatus: 'passed', resultSha256: sha256(rawBytes),
  });
});

test('fails passed validation for missing or mismatching validator digest', async () => {
  const verify = await loadResultEvidenceVerifier();
  const rawBytes = Buffer.from('{"status":"success"}\n');
  for (const validatedResultSha256 of [null, 'not-a-digest', '0'.repeat(64)]) {
    assert.deepEqual(verify({ rawBytes, validatedResultSha256, validationStatus: 'passed' }), {
      reviewValidationStatus: 'failed', resultSha256: sha256(rawBytes),
    });
  }
});

test('does not promote non-passed validation', async () => {
  const verify = await loadResultEvidenceVerifier();
  const rawBytes = Buffer.from('{"status":"failed"}\n');
  assert.deepEqual(verify({ rawBytes, validatedResultSha256: sha256(rawBytes), validationStatus: 'failed' }), {
    reviewValidationStatus: 'failed', resultSha256: sha256(rawBytes),
  });
  assert.deepEqual(verify({ rawBytes, validatedResultSha256: sha256(rawBytes), validationStatus: 'not_run' }), {
    reviewValidationStatus: 'not_run', resultSha256: sha256(rawBytes),
  });
});

test('records null digest when result bytes are unavailable', async () => {
  const verify = await loadResultEvidenceVerifier();
  assert.deepEqual(verify({ rawBytes: null, validatedResultSha256: null, validationStatus: 'passed' }), {
    reviewValidationStatus: 'failed', resultSha256: null,
  });
});

 test('decision record is strict, bound, and frozen', () => {
  const record = decision();
  assert.equal(Object.isFrozen(record), true);
  assert.deepEqual(Object.keys(record), ['schema_version','effective_mode','decision_llm_enabled','head_sha','workflow_run_id','run_attempt','classification_status','risk_floor','reviewable_file_count','proposed_strategy','selected_strategy','route_source','decision_status','egress_status','observer_status','decision_latency_ms','decision_api_cost','policy_version','feature_schema_version','decision_state_version','model_catalog_version']);
  assert.equal(Object.keys(record).length, 21);
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

test('off-mode decision LLM opt-in records enforced certified-model attempts', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-off-opt-in-'));
  try {
    const recorder = createAttemptRecorder({ runTemp, mode: 'off', decisionLlmEnabled: true, catalog,
      runAttemptId: 'a'.repeat(32), runAttempt: binding.runAttempt });
    recorder.onAttemptEvent(event({ run_attempt_id: recorder.runAttemptId }));
    recorder.onAttemptEvent(event({ run_attempt_id: recorder.runAttemptId, event: 'attempt_completed',
      result: 'host_validated_success', duration_ms: 12 }));
    recorder.seal();
    assert.equal(recorder.health(), 'available');
    assert.equal(readFileSync(join(runTemp, 'ocr-routing', 'attempts.ndjson'), 'utf8').trim().split('\n').length, 2);
    assert.throws(() => createAttemptRecorder({ runTemp: join(runTemp, 'disabled'), mode: 'off',
      decisionLlmEnabled: false, catalog, runAttempt: binding.runAttempt }), /AUDIT_MODE_INVALID/);
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('attempt recorder rejects startup and publication as non-Host events', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
  try {
    const recorder = createAttemptRecorder({ runTemp, mode: 'enforce', catalog, runAttemptId: 'a'.repeat(32), runAttempt: binding.runAttempt });
    assert.throws(() => recorder.onAttemptEvent({ event: 'startup', binding }), /AUDIT_EVENT_INVALID/);
    assert.throws(() => recorder.onAttemptEvent({ event: 'publication' }), /AUDIT_EVENT_INVALID/);
    assert.equal(existsSync(join(runTemp, 'ocr-routing', 'attempts.ndjson')), false);
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('attempt recorder rejects invalid run-attempt bindings and extra event keys', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
  try {
    assert.throws(() => createAttemptRecorder({ runTemp, mode: 'enforce', catalog, runAttempt: 0 }), { message: 'AUDIT_EVENT_INVALID: runAttempt must be a positive safe integer' });
    assert.throws(() => createAttemptRecorder({ runTemp, mode: 'enforce', catalog }), { message: 'AUDIT_EVENT_INVALID: runAttempt must be a positive safe integer' });
    const recorder = createAttemptRecorder({ runTemp, mode: 'enforce', catalog, runAttempt: binding.runAttempt });
    assert.throws(() => recorder.onAttemptEvent(event({ run_attempt_id: recorder.runAttemptId, run_attempt: 2 })), { message: 'AUDIT_EVENT_INVALID' });
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
  recorder.onAttemptEvent(event({ event: 'attempt_started', run_attempt_id: recorder.runAttemptId }));
  recorder.onAttemptEvent(event({ event: 'attempt_completed', run_attempt_id: recorder.runAttemptId, result: 'host_validated_success', duration_ms: 10 }));
  recorder.onAttemptEvent(event({ event: 'host_completed', run_attempt_id: recorder.runAttemptId, attempt_index: null, model: null, result: null, duration_ms: 10, host_status: 'success' }));
  recorder.seal();
  const attempts = readFileSync(join(runTemp, 'ocr-routing', 'attempts.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
  const selectedRoute = { selected_model_id: deepModel, fallback_models: [], selected_strategy: 'deep', proposed_strategy: 'deep' };
  const certifiedBundle = { catalog, evidence: { certification_refs: [], cli_available_models: [deepModel] } };
  const finalize = options => finalizeRoutingAudit({ decision: record, attempts, reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, ownerApprovalRef: null, proposedReviewModel: deepModel, selectedReviewModel: deepModel, review_scope_gap: false, features_incomplete: false }, catalog, selectedRoute, certifiedBundle, runTemp, ...options });
  const final = finalize({});
  const auditV3 = { ...final, schema_version: '3', result_sha256: 'a'.repeat(64) };
  assert.equal(validateRoutingAudit(auditV3), auditV3);
  const inconsistentAudit = { ...auditV3, executed_review_model: 'other-model' };
  assert.throws(() => validateRoutingAudit(inconsistentAudit), { message: 'AUDIT_SCHEMA_INVALID' });
  assert.throws(() => createRoutingLogSummary(inconsistentAudit), { message: 'AUDIT_SCHEMA_INVALID' });
  assert.throws(() => validateRoutingAudit({ ...auditV3, result_sha256: 'invalid' }), { message: 'AUDIT_SCHEMA_INVALID' });
  assert.throws(() => validateRoutingAudit({ ...auditV3, result_sha256: null }), { message: 'AUDIT_SCHEMA_INVALID' });
  assert.equal(validateRoutingAudit({ ...auditV3, result_sha256: null, review_validation_status: 'failed' }).result_sha256, null);
  assert.equal(Object.isFrozen(final), true);
  assert.equal(final.workflow_run_id, binding.workflowRunId);
  assert.equal(final.executed_review_model, deepModel);
  assert.deepEqual(final.attempted_review_models, [deepModel]);
  const publish = evaluatePublishEligibility({ mode: 'enforce', expectedBinding: binding, decisionRecord: record, finalAudit: final, delivery: { outcome: 'success', artifactId: 'artifact-1', runId: binding.workflowRunId, runAttempt: binding.runAttempt }, checkRunId: '123', startupAuthorization: { authorized: true, approvalRefs: ['OWNER-APPROVED'] }, headSha: binding.headSha, selectedRoute: deepPublishRoute, attempts, certifiedBundle: realBundle });
  assert.equal(publish.authorized, true);
  assert.equal(publish.reason, 'PUBLISH_AUTHORIZED');
  assert.throws(() => finalizeRoutingAudit({ decision: record, attempts: [], reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog }), { message: 'AUDIT_EVENT_INVALID' });
  const failedValidation = finalize({ validation: { status: 'failed' } });
  assert.equal(failedValidation.host_success_model, deepModel);
  assert.equal(failedValidation.executed_review_model, null);
  assert.throws(() => finalizeRoutingAudit({ decision: record, attempts: [attempts[0], attempts[2], attempts[1]], reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog, selectedRoute, certifiedBundle, runTemp }), { message: 'AUDIT_EVENT_INVALID' });
  assert.deepEqual(Object.keys(final), ['schema_version','repo_id','repo','pr_number','head_sha','workflow_run_id','run_attempt','effective_mode','decision_llm_enabled','decision_status','egress_status','classification_status','risk_floor','selected_strategy','proposed_strategy','policy_version','feature_schema_version','decision_state_version','model_catalog_version','owner_approval_ref','proposed_review_model','selected_review_model','host_success_model','executed_review_model','attempted_review_models','result_sha256','review_validation_status','head_validation_status','audit_status','review_scope_gap','features_incomplete','review_quality_measured','decision_api_cost','latency_ms']);
  assert.equal(Object.keys(final).length, 34);
  assert.equal(Object.hasOwn(final, 'reviewable_file_count'), false);
  assert.throws(() => finalize({ runBinding: { ...binding, runAttempt: 999 } }), { message: 'RUN_BINDING_MISMATCH' });
  assert.throws(() => finalizeRoutingAudit({ decision: record, attempts, reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog, selectedRoute, certifiedBundle, runTemp, ignored: true }), { message: 'AUDIT_EVENT_INVALID' });
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('final audit requires a complete Host chain without pre-publication fiction', () => {
  const start = { event: 'startup', run_attempt: binding.runAttempt, mode: 'enforce', binding };
  const publication = { event: 'publication', run_attempt: binding.runAttempt };
  const started = event({ event: 'attempt_started' });
  const completed = event({ event: 'attempt_completed', result: 'host_validated_success', duration_ms: 10 });
  const hostCompleted = event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 10, host_status: 'success' });
  const finalize = attempts => {
    const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
    try {
      mkdirSync(join(runTemp, 'ocr-routing'));
      writeFileSync(join(runTemp, 'ocr-routing', 'attempts.ndjson'), `${attempts.map(item => JSON.stringify(item)).join('\n')}\n`);
      return finalizeRoutingAudit({ decision: decision(), attempts, reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog, selectedRoute: { selected_model_id: deepModel, fallback_models: [], selected_strategy: 'deep' }, certifiedBundle: { catalog, evidence: { certification_refs: [], cli_available_models: [deepModel] } }, runTemp });
    } finally { rmSync(runTemp, { recursive: true, force: true }); }
  };

  const record = finalize([started, completed, hostCompleted]);
  assert.equal(record.executed_review_model, deepModel);
  for (const invalid of [
    [{ ...start, binding: { ...binding, runAttempt: binding.runAttempt + 1 } }, started, completed, hostCompleted, publication],
    [started, completed],
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
  assert.throws(() => finalize([start, started, completed, publication, hostCompleted]), error =>
    error.message === 'AUDIT_EVENT_INVALID' && error.reason === 'attempt_chain_invalid');
});

test('fallback success is sealed without impersonating the primary model', () => {
  const started = (index, model) => event({ event: 'attempt_started', attempt_index: index, model });
  const completed = (index, model, result) => event({ event: 'attempt_completed', attempt_index: index, model, result, duration_ms: 10 });
  const primary = certifiedRealCatalog.models.find(model => model.capability_tier === 'fast').model_id;
  const fallback = certifiedRealCatalog.models.find(model => model.model_id === primary).allowed_fallbacks[0];
  const bundle = realBundle;
  const chain = [
    started(1, primary), completed(1, primary, 'model_reported_failure'),
    started(2, fallback), completed(2, fallback, 'host_validated_success'),
    event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 20, host_status: 'success' }),
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
    event({ event: 'attempt_started' }),
    event({ event: 'attempt_completed', result: 'host_validated_success', duration_ms: 10 }),
    event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 10, host_status: 'success' }),
  ];
  const bundle = { catalog, evidence: { certification_refs: [], cli_available_models: [deepModel] } };
  assert.throws(() => validateRoutingAttempts({ attempts: chain, selectedRoute: { selected_model_id: 'other-model', fallback_models: [], selected_strategy: 'deep' }, certifiedBundle: bundle }), { message: 'AUDIT_EVENT_INVALID' });
  assert.throws(() => validateRoutingAttempts({ attempts: chain, selectedRoute: { selected_model_id: deepModel, fallback_models: [], selected_strategy: 'deep' }, certifiedBundle: { ...bundle, evidence: { ...bundle.evidence, cli_available_models: [] } } }), { message: 'AUDIT_EVENT_INVALID' });
  assert.throws(() => validateRoutingAttempts({ attempts: chain, selectedRoute: { selected_model_id: deepModel, fallback_models: [], selected_strategy: 'deep' }, certifiedBundle: { ...bundle, catalog: { models: [{ model_id: deepModel, capability_tier: 'fast' }] } } }), { message: 'AUDIT_EVENT_INVALID' });
});

test('route validation accepts failed Host completion without completed attempts', () => {
  const failedChain = [event({ event: 'host_completed', attempt_index: null, model: null, result: null, host_status: 'failed' })];
  const bundle = { catalog, evidence: { certification_refs: [], cli_available_models: [] } };

  assert.deepEqual(validateRoutingAttempts({
    attempts: failedChain,
    selectedRoute: { selected_model_id: deepModel, fallback_models: [], selected_strategy: 'deep' },
    certifiedBundle: bundle,
  }), { attemptedModels: [], successModel: null });
});

test('route validation rejects completed attempts that regress from fallback to primary', () => {
  const primary = deepModel;
  const fallback = 'claude-sonnet-4-6';
  const route = { selected_model_id: primary, fallback_models: [fallback], selected_strategy: 'deep' };
  const bundle = { catalog: { models: [...catalog.models, { model_id: fallback, capability_tier: 'deep', certification_status: 'certified' }] }, evidence: { certification_refs: [], cli_available_models: [primary, fallback] } };
  const chain = [
    event({ event: 'attempt_started', attempt_index: 1, model: fallback }),
    event({ event: 'attempt_completed', attempt_index: 1, model: fallback, result: 'model_reported_failure', duration_ms: 5 }),
    event({ event: 'attempt_started', attempt_index: 2, model: primary }),
    event({ event: 'attempt_completed', attempt_index: 2, model: primary, result: 'host_validated_success', duration_ms: 5 }),
    event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 10, host_status: 'success' }),
  ];
  assert.throws(() => validateRoutingAttempts({ attempts: chain, selectedRoute: route, certifiedBundle: bundle }), { message: 'AUDIT_EVENT_INVALID' });
});

test('skipped Host completion leaves the success model null', () => {
  const skippedChain = [
    event({ event: 'attempt_started' }),
    event({ event: 'attempt_completed', result: 'host_skipped', duration_ms: 1 }),
    event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 1, host_status: 'skipped' }),
  ];
  assert.equal(validateRoutingAttempts({ attempts: skippedChain, selectedRoute: { selected_model_id: deepModel, fallback_models: [], selected_strategy: 'deep' }, certifiedBundle: { catalog, evidence: { certification_refs: [], cli_available_models: [deepModel] } } }).successModel, null);
});

test('same-model retries remain distinct chain attempts while output model list is unique', () => {
  const first = event({ event: 'attempt_started', attempt_index: 1 });
  const second = event({ event: 'attempt_started', attempt_index: 2 });
  const chain = [
    first, event({ event: 'attempt_completed', attempt_index: 1, result: 'timeout', duration_ms: 10 }),
    second, event({ event: 'attempt_completed', attempt_index: 2, result: 'host_validated_success', duration_ms: 10 }),
    event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 20, host_status: 'success' }),
  ];
  const validation = validateRoutingAttempts({ attempts: chain, selectedRoute: { selected_model_id: deepModel, fallback_models: [], selected_strategy: 'deep' }, certifiedBundle: { catalog, evidence: { certification_refs: [], cli_available_models: [deepModel] } } });
  assert.deepEqual(validation.attemptedModels, [deepModel, deepModel]);
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
  try {
    mkdirSync(join(runTemp, 'ocr-routing'));
    writeFileSync(join(runTemp, 'ocr-routing', 'attempts.ndjson'), `${chain.map(item => JSON.stringify(item)).join('\n')}\n`);
    const final = finalizeRoutingAudit({ decision: decision(), attempts: chain, reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog, selectedRoute: { selected_model_id: deepModel, fallback_models: [], selected_strategy: 'deep' }, certifiedBundle: { catalog, evidence: { certification_refs: [], cli_available_models: [deepModel] } }, runTemp });
    assert.deepEqual(final.attempted_review_models, [deepModel]);
    assert.equal(final.host_success_model, deepModel);
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
    event({ event: 'attempt_started' }),
    event({ event: 'attempt_completed', result: 'host_validated_success', duration_ms: 10 }),
    event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 10, host_status: 'success' }),
  ];
  const audit = finalizeRoutingAudit({ decision: shadowDecision, attempts: shadowAttempts, reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: shadowBinding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog });
  assert.deepEqual(audit.attempted_review_models, [deepModel]);
  assert.equal(audit.host_success_model, deepModel);
  assert.equal(audit.executed_review_model, deepModel);
});

test('two successful Host completion events are rejected and cannot execute a model', () => {
  const twoSuccesses = [
    event({ event: 'attempt_started', attempt_index: 1 }),
    event({ event: 'attempt_completed', attempt_index: 1, result: 'host_validated_success', duration_ms: 10 }),
    event({ event: 'attempt_started', attempt_index: 2 }),
    event({ event: 'attempt_completed', attempt_index: 2, result: 'host_validated_success', duration_ms: 10 }),
    event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 20, host_status: 'success' }),
    event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 20, host_status: 'success' }),
  ];
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
  try {
    mkdirSync(join(runTemp, 'ocr-routing'));
    writeFileSync(join(runTemp, 'ocr-routing', 'attempts.ndjson'), `${twoSuccesses.map(item => JSON.stringify(item)).join('\n')}\n`);
    let finalRecord = null;
    assert.throws(() => {
  finalRecord = finalizeRoutingAudit({ decision: decision(), attempts: twoSuccesses, reviewResult: { status: 'success' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog, selectedRoute: { selected_model_id: deepModel, fallback_models: [], selected_strategy: 'deep' }, certifiedBundle: { catalog, evidence: { certification_refs: [], cli_available_models: [deepModel] } }, runTemp });
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

test('decision record v1 accepts allowlisted_low_risk_code and preserves schema versions', () => {
  const codeFeatures = { classification_status: 'allowlisted_low_risk_code', risk_floor: 'fast', reviewable_file_count: 1, review_scope_gap: false, features_incomplete: false };
  const codeRoute = { proposedStrategy: 'fast', selectedStrategy: 'fast', routeSource: 'model_decision', decisionStatus: 'succeeded', proposedReviewModel: 'google/gemini-2.5-pro-preview', selectedReviewModel: 'google/gemini-2.5-pro-preview' };
  const record = createRoutingDecisionRecord({ runBinding: binding, features: codeFeatures, decision: { latencyMs: null, cost: null }, egressStatus: 'allowed', route: codeRoute, policyVersions: versions });
  assert.equal(record.schema_version, '1');
  assert.equal(record.feature_schema_version, '3');
  assert.equal(record.decision_state_version, '1');
  assert.equal(record.classification_status, 'allowlisted_low_risk_code');
  assert.equal(record.risk_floor, 'fast');
  assert.equal(validateRoutingDecisionRecord(record), record);
  assert.throws(() => validateRoutingDecisionRecord({ ...record, classification_status: 'allowlisted_unknown_code' }), { message: 'AUDIT_SCHEMA_INVALID' });
});

test('off-mode decision records and audit are valid only with the decision LLM flag enabled', () => {
  const runBinding = { ...binding, mode: 'off', decisionLlmEnabled: true };
  const record = createRoutingDecisionRecord({ runBinding, features, decision: { latencyMs: 12, cost: null },
    egressStatus: 'allowed', route, policyVersions: versions });
  assert.equal(record.effective_mode, 'off');
  assert.equal(record.decision_llm_enabled, true);
  assert.equal(validateRoutingDecisionRecord(record), record);

  const audit = summaryAudit({ effective_mode: 'off', decision_llm_enabled: true, review_quality_measured: true });
  assert.equal(validateRoutingAudit(audit), audit);
  assert.throws(() => validateRoutingAudit({ ...audit, decision_llm_enabled: false }), { message: 'AUDIT_SCHEMA_INVALID' });
});

test('final audit v3 accepts allowlisted_low_risk_code and preserves schema versions', () => {
  const codeFeatures = { classification_status: 'allowlisted_low_risk_code', risk_floor: 'fast', reviewable_file_count: 0, review_scope_gap: false, features_incomplete: false };
  const record = createRoutingDecisionRecord({ runBinding: binding, features: codeFeatures, decision: { latencyMs: null, cost: null }, egressStatus: 'allowed', route: { proposedStrategy: null, selectedStrategy: null, routeSource: 'not_requested', decisionStatus: 'not_requested' }, policyVersions: versions });
  const final = finalizeRoutingAudit({ decision: record, attempts: [], reviewResult: { status: 'skipped' }, validation: { status: 'not_run' }, headCheck: { status: 'not_run' }, runBinding: binding, policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false }, catalog });
  assert.equal(final.schema_version, '3');
  assert.equal(final.feature_schema_version, '3');
  assert.equal(final.decision_state_version, '1');
  assert.equal(final.classification_status, 'allowlisted_low_risk_code');
  assert.equal(final.risk_floor, 'fast');
  assert.equal(validateRoutingAudit(final), final);
});

test('routing log summary reports a skipped selector and the executed review model', async () => {
  const { createRoutingLogSummary } = await import('./ocr-routing-audit.mjs');
  assert.equal(typeof createRoutingLogSummary, 'function');
  const summary = createRoutingLogSummary(summaryAudit({
    decision_status: 'not_requested',
    egress_status: 'denied',
    selected_review_model: 'gemini-3.8-flash-medium',
    executed_review_model: 'gemini-3.8-flash-medium',
    attempted_review_models: ['gemini-3.8-flash-medium'],
  }));
  assert.deepEqual(summary, {
    effective_mode: 'enforce',
    selection_llm_attempted: false,
    selection_llm_succeeded: false,
    selection_llm_status: 'not_requested',
    selection_llm_egress_status: 'denied',
    selected_review_model: 'gemini-3.8-flash-medium',
    executed_review_model: 'gemini-3.8-flash-medium',
    review_quality_measured: true,
    attempted_review_models: ['gemini-3.8-flash-medium'],
    audit_status: 'sealed',
  });
});

test('selection LLM attempt requires allowed egress and an actual provider request', async () => {
  const { createRoutingLogSummary } = await import('./ocr-routing-audit.mjs');
  const cases = [
    [{ decision_status: 'unavailable', egress_status: 'denied', latency_ms: 5 }, false],
    [{ decision_status: 'unavailable', egress_status: 'allowed', latency_ms: null }, false],
    [{ decision_status: 'unavailable', egress_status: 'allowed', latency_ms: 0 }, true],
    [{ decision_status: 'succeeded', egress_status: 'allowed', latency_ms: 25 }, true],
  ];
  for (const [overrides, expected] of cases) {
    assert.equal(createRoutingLogSummary(summaryAudit(overrides)).selection_llm_attempted, expected);
  }
});

test('routing log summary distinguishes attempted selection from actual review execution', async () => {
  const { createRoutingLogSummary } = await import('./ocr-routing-audit.mjs');
  assert.equal(typeof createRoutingLogSummary, 'function');
  const summary = createRoutingLogSummary(summaryAudit({
    decision_status: 'succeeded',
    egress_status: 'allowed',
    selected_review_model: 'gemini-3.8-flash-medium',
    host_success_model: 'claude-opus-5-5-high',
    executed_review_model: 'claude-opus-5-5-high',
    attempted_review_models: ['gemini-3.8-flash-medium', 'claude-opus-5-5-high'],
    latency_ms: 25,
  }));
  assert.equal(summary.selection_llm_attempted, true);
  assert.equal(summary.selection_llm_succeeded, true);
  assert.equal(summary.selected_review_model, 'gemini-3.8-flash-medium');
  assert.equal(summary.executed_review_model, 'claude-opus-5-5-high');
  assert.deepEqual(summary.attempted_review_models, ['gemini-3.8-flash-medium', 'claude-opus-5-5-high']);
});

test('audit diagnostic formatter includes only allowlisted context mismatch reasons', () => {
  const allowedReasons = [
    'CONTEXT_READ_INVALID', 'CONTEXT_SCHEMA_INVALID', 'RUN_BINDING_MISMATCH',
    'REPO_IDENTITY_MISMATCH', 'POLICY_DIGEST_MISMATCH', 'CATALOG_DIGEST_MISMATCH',
    'SOURCE_MANIFEST_MISMATCH', 'CLI_IDENTITY_MISSING', 'CLI_DIGEST_MISMATCH',
    'OPT_IN_APPROVAL_REFS_INVALID', 'STARTUP_APPROVAL_MISMATCH',
    'CERTIFICATION_IDENTITY_MISSING', 'CERTIFICATION_VALIDATION_FAILED',
    'CLI_INVENTORY_DIGEST_MISMATCH', 'CERTIFICATION_REFERENCE_MISMATCH',
    'UNEXPECTED_MODEL_EVIDENCE',
  ];
  for (const reason of allowedReasons) {
    const error = Object.assign(new Error('sensitive private details'), {
      code: 'ROUTING_EXECUTION_CONTEXT_INVALID', reason,
    });
    const output = formatRoutingAuditDiagnostic({ stage: 'REVALIDATE_CONTEXT', error });
    assert.equal(output,
      'ROUTING_AUDIT_DIAGNOSTIC code=ROUTING_EXECUTION_CONTEXT_INVALID stage=REVALIDATE_CONTEXT reason=' + reason);
    assert.doesNotMatch(output, /sensitive|private/i);
  }
  const malicious = Object.assign(new Error('secret'), {
    code: 'ROUTING_EXECUTION_CONTEXT_INVALID', reason: 'sensitive token path',
  });
  assert.equal(formatRoutingAuditDiagnostic({ stage: 'REVALIDATE_CONTEXT', error: malicious }),
    'ROUTING_AUDIT_DIAGNOSTIC code=ROUTING_EXECUTION_CONTEXT_INVALID stage=REVALIDATE_CONTEXT reason=OTHER');
});

test('audit diagnostics expose only fixed failure codes, stages, and reasons', () => {
  const known = Object.assign(new Error('AUDIT_EVENT_INVALID'), { reason: 'attempt_chain_unavailable' });
  assert.equal(
    formatRoutingAuditDiagnostic({ stage: 'FINALIZE_RECORD', error: known }),
    'ROUTING_AUDIT_DIAGNOSTIC code=AUDIT_EVENT_INVALID stage=FINALIZE_RECORD reason=attempt_chain_unavailable',
  );
  assert.equal(
    formatRoutingAuditDiagnostic({ stage: 'REVALIDATE_CONTEXT', error: Object.assign(new Error('secret'), { code: 'ROUTING_ACTIVATION_DENIED' }) }),
    'ROUTING_AUDIT_DIAGNOSTIC code=ROUTING_ACTIVATION_DENIED stage=REVALIDATE_CONTEXT reason=OTHER',
  );
  assert.equal(
    formatRoutingAuditDiagnostic({ stage: 'WRITE_AUDIT', error: Object.assign(new Error('path'), { code: 'ENOENT' }) }),
    'ROUTING_AUDIT_DIAGNOSTIC code=ENOENT stage=WRITE_AUDIT reason=OTHER',
  );
  const unknown = formatRoutingAuditDiagnostic({
    stage: 'SECRET_STAGE:/secrets/token', error: Object.assign(new Error('Bearer secret-token'), {
      code: 'TOKEN_SECRET', reason: 'private/path',
    }),
  });
  assert.equal(unknown, 'ROUTING_AUDIT_DIAGNOSTIC code=UNKNOWN stage=OTHER reason=OTHER');
  assert.doesNotMatch(unknown, /secret|Bearer|private|TOKEN_SECRET/i);
  assert.equal(
    formatRoutingAuditDiagnostic({}),
    'ROUTING_AUDIT_DIAGNOSTIC code=UNKNOWN stage=OTHER reason=OTHER',
  );
});

test('off+Decision terminal default is auditable but does not claim deep-tier quality', () => {
  const cloned = structuredClone(certifiedRealCatalog);
  cloned.models = cloned.models.map((model, index) => ({
    ...model, certification_reference: `sha256:${String(index + 1).padStart(64, '0')}`,
  }));
  const index = { cli_inventory: { approval_ref: 'OWNER-CLI' },
    certifications: cloned.models.map(item => ({
      sha256: item.certification_reference.slice(7), approval_ref: `OWNER-${item.model_id}`,
    })) };
  const bundle = { catalog: cloned, evidence: {
    cli_available_models: cloned.models.map(item => item.model_id), index, revokedRefs: [],
  } };
  const defaultModel = cloned.strategies.fast.preferred_model_id;
  const planned = [deepModel, ...deepPublishRoute.fallback_models, defaultModel];
  const started = (idx, model) => event({ event: 'attempt_started', attempt_index: idx, model });
  const completed = (idx, model, status) => event({ event: 'attempt_completed', attempt_index: idx,
    model, result: status, duration_ms: 10 });
  const chain = planned.flatMap((model, i) => [
    started(i + 1, model),
    completed(i + 1, model, i === planned.length - 1 ? 'host_validated_success' : 'model_reported_failure'),
  ]);
  chain.push(event({ event: 'host_completed', attempt_index: null, model: null,
    result: null, duration_ms: null, host_status: 'success' }));
  const selected = { ...deepPublishRoute, effective_mode: 'off', decision_llm_enabled: true,
    terminal_model_id: defaultModel };
  assert.deepEqual(validateRoutingAttempts({ attempts: chain, selectedRoute: selected, certifiedBundle: bundle }), {
    attemptedModels: planned, successModel: defaultModel,
  });
  const dir = mkdtempSync(join(tmpdir(), 'ocr-terminal-audit-'));
  try {
    mkdirSync(join(dir, 'ocr-routing'));
    writeFileSync(join(dir, 'ocr-routing', 'attempts.ndjson'), chain.map(JSON.stringify).join('\n') + '\n');
    const run = { ...binding, mode: 'off', decisionLlmEnabled: true };
    const record = createRoutingDecisionRecord({ runBinding: run, features, decision: { latencyMs: null, cost: null },
      egressStatus: 'denied', route, policyVersions: versions });
    const audited = finalizeRoutingAudit({ decision: record, attempts: chain,
      reviewResult: { status: 'success' }, validation: { status: 'passed' },
      headCheck: { status: 'passed' }, runBinding: run,
      policy: { repoId: 42, repo: 'owner/repo', prNumber: 7, review_scope_gap: false, features_incomplete: false },
      catalog: cloned, selectedRoute: selected, certifiedBundle: bundle,
      resultSha256: 'a'.repeat(64), runTemp: dir });
    assert.equal(audited.host_success_model, defaultModel);
    assert.equal(audited.executed_review_model, null);
    assert.equal(audited.review_quality_measured, false);
    assert.deepEqual(audited.attempted_review_models, planned);
  } finally { rmSync(dir, { recursive: true, force: true }); }

  // An enforce run can never use this lower-tier terminal exception.
  assert.throws(() => validateRoutingAttempts({
    attempts: chain, selectedRoute: { ...selected, effective_mode: 'enforce', decision_llm_enabled: false },
    certifiedBundle: bundle,
  }), { message: 'AUDIT_EVENT_INVALID' });

  // Missing intermediate fallback is not an eligible terminal sequence.
  const tampered = chain.filter(entry => !['gemini-4-argon-high'].includes(entry.model));
  const reordered = tampered.map((entry, i) => entry.event === 'host_completed'
    ? entry : { ...entry, attempt_index: Math.ceil((i + 1) / 2) });
  assert.throws(() => validateRoutingAttempts({
    attempts: reordered, selectedRoute: selected, certifiedBundle: bundle,
  }), { message: 'AUDIT_EVENT_INVALID' });

  const revoked = { ...bundle, evidence: { ...bundle.evidence,
    revokedRefs: [`OWNER-${defaultModel}`] } };
  assert.throws(() => validateRoutingAttempts({
    attempts: chain, selectedRoute: selected, certifiedBundle: revoked,
  }), { message: 'AUDIT_EVENT_INVALID' });
});


test('off+Decision audits a configured deep Hydrogen terminal after all three routed failures', () => {
  const terminal = 'gemini-4-hydrogen-high';
  const cloned = structuredClone(certifiedRealCatalog);
  cloned.models = cloned.models.map((model, i) => ({
    ...model, certification_reference: `sha256:${String(i + 1).padStart(64, '0')}`,
  }));
  assert.notEqual(terminal, cloned.strategies.fast.preferred_model_id);
  const index = { cli_inventory: { approval_ref: 'OWNER-CLI' },
    certifications: cloned.models.map(model => ({
      sha256: model.certification_reference.slice(7), approval_ref: `OWNER-${model.model_id}`,
    })) };
  const bundle = { catalog: cloned, evidence: {
    cli_available_models: cloned.models.map(model => model.model_id), index, revokedRefs: [],
  } };
  const allowed = [deepModel, ...deepPublishRoute.fallback_models];
  const planned = [...allowed, terminal];
  const started = (idx, model) => event({ event: 'attempt_started', attempt_index: idx, model });
  const completed = (idx, model, result) => event({ event: 'attempt_completed', attempt_index: idx,
    model, result, duration_ms: 10 });
  const chain = planned.flatMap((model, i) => [
    started(i + 1, model),
    completed(i + 1, model, i === planned.length - 1 ? 'host_validated_success' : 'model_reported_failure'),
  ]);
  chain.push(event({ event: 'host_completed', attempt_index: null, model: null,
    result: null, duration_ms: null, host_status: 'success' }));
  const selected = { ...deepPublishRoute, effective_mode: 'off',
    decision_llm_enabled: true, terminal_model_id: terminal };
  assert.deepEqual(validateRoutingAttempts({ attempts: chain, selectedRoute: selected,
    certifiedBundle: bundle }), { attemptedModels: planned, successModel: terminal });

  const dir = mkdtempSync(join(tmpdir(), 'ocr-high-terminal-audit-'));
  try {
    mkdirSync(join(dir, 'ocr-routing'));
    writeFileSync(join(dir, 'ocr-routing', 'attempts.ndjson'), chain.map(JSON.stringify).join('\n') + '\n');
    const run = { ...binding, mode: 'off', decisionLlmEnabled: true };
    const record = createRoutingDecisionRecord({ runBinding: run, features,
      decision: { latencyMs: null, cost: null }, egressStatus: 'denied', route, policyVersions: versions });
    const audited = finalizeRoutingAudit({ decision: record, attempts: chain,
      reviewResult: { status: 'success' }, validation: { status: 'passed' },
      headCheck: { status: 'passed' }, runBinding: run,
      policy: { repoId: 42, repo: 'owner/repo', prNumber: 7,
        review_scope_gap: false, features_incomplete: false },
      catalog: cloned, selectedRoute: selected, certifiedBundle: bundle,
      runTemp: dir });
    assert.equal(audited.host_success_model, terminal);
    assert.equal(audited.executed_review_model, terminal);
    assert.equal(audited.review_quality_measured, true);
    assert.deepEqual(audited.attempted_review_models, planned);
  } finally { rmSync(dir, { recursive: true, force: true }); }

  for (const changedRoute of [
    { ...selected, terminal_model_id: cloned.strategies.fast.preferred_model_id },
    { ...selected, terminal_model_id: null },
    { ...selected, terminal_model_id: 'not-in-catalog' },
    { ...selected, effective_mode: 'enforce', decision_llm_enabled: false },
  ]) assert.throws(() => validateRoutingAttempts({
    attempts: chain, selectedRoute: changedRoute, certifiedBundle: bundle,
  }), { message: 'AUDIT_EVENT_INVALID' });

  const revoked = { ...bundle, evidence: { ...bundle.evidence, revokedRefs: [`OWNER-${terminal}`] } };
  assert.throws(() => validateRoutingAttempts({
    attempts: chain, selectedRoute: selected, certifiedBundle: revoked,
  }), { message: 'AUDIT_EVENT_INVALID' });
  const skippedCandidate = chain.filter(item => item.model !== deepPublishRoute.fallback_models[1]);
  const badOrder = skippedCandidate.map((item, i) => item.event === 'host_completed'
    ? item : { ...item, attempt_index: Math.ceil((i + 1) / 2) });
  assert.throws(() => validateRoutingAttempts({
    attempts: badOrder, selectedRoute: selected, certifiedBundle: bundle,
  }), { message: 'AUDIT_EVENT_INVALID' });
});
