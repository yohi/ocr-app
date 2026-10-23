import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluatePublishEligibility } from './evaluate-routing-publish.mjs';
import { validateRoutingAudit, validateRoutingDecisionRecord } from './ocr-routing-audit.mjs';

const binding = { workflowRunId: '9007199254740993', runAttempt: 2, headSha: 'a'.repeat(40), mode: 'enforce' };
const decisionRecord = {
  schema_version: '1', effective_mode: 'enforce', head_sha: binding.headSha, workflow_run_id: binding.workflowRunId, run_attempt: 2,
  classification_status: 'unclassified_code', risk_floor: 'deep', reviewable_file_count: 1, proposed_strategy: 'deep', selected_strategy: 'deep',
  route_source: 'deterministic_fallback', decision_status: 'unavailable', egress_status: 'denied', observer_status: 'not_started',
  decision_latency_ms: null, decision_api_cost: null, policy_version: '1.0.0', feature_schema_version: '3', decision_state_version: '1', model_catalog_version: '1.0.0',
};
const realCatalog = JSON.parse(readFileSync(new URL('../config/review-model-catalog.json', import.meta.url), 'utf8'));
const catalog = { ...realCatalog, models: realCatalog.models.map(model => ({ ...model, certification_status: 'certified', certification_reference: `sha256:${'b'.repeat(64)}` })) };
const certifiedBundle = { catalog, evidence: {
  verifiedCertificationRefs: catalog.models.map(model => ({ model_id: model.model_id,
    certification_reference: model.certification_reference, capability_tier: model.capability_tier,
    catalog_version: model.catalog_version })),
  cliAvailableModels: catalog.models.map(model => model.model_id),
  cli_available_models: catalog.models.map(model => model.model_id),
} };
const primaryModel = catalog.strategies.deep.preferred_model_id;
const fastModel = catalog.models.find(model => model.capability_tier === 'fast');
const deepFallbackModel = catalog.models.find(model => model.model_id === fastModel.allowed_fallbacks[0]);
const fastDecisionRecord = { ...decisionRecord, risk_floor: 'fast', selected_strategy: 'fast', proposed_strategy: 'fast' };
const finalAudit = {
  schema_version: '2', repo_id: 42, repo: 'owner/repo', pr_number: 7, head_sha: binding.headSha, workflow_run_id: binding.workflowRunId, run_attempt: 2, effective_mode: 'enforce',
  decision_status: 'unavailable', egress_status: 'denied', classification_status: 'unclassified_code', risk_floor: 'deep', selected_strategy: 'deep', proposed_strategy: 'deep',
  policy_version: '1.0.0', feature_schema_version: '3', decision_state_version: '1', model_catalog_version: '1.0.0', owner_approval_ref: null,
  proposed_review_model: primaryModel, selected_review_model: primaryModel, host_success_model: primaryModel, executed_review_model: primaryModel,
  attempted_review_models: [primaryModel], review_validation_status: 'passed', head_validation_status: 'passed', audit_status: 'sealed',
  review_scope_gap: false, features_incomplete: false, review_quality_measured: true, decision_api_cost: null, latency_ms: null,
};
const fastFinalAudit = {
  ...finalAudit,
  risk_floor: 'fast', selected_strategy: 'fast', proposed_strategy: 'fast',
  proposed_review_model: fastModel.model_id, selected_review_model: fastModel.model_id,
  executed_review_model: deepFallbackModel.model_id, host_success_model: deepFallbackModel.model_id,
  attempted_review_models: [fastModel.model_id, deepFallbackModel.model_id], review_quality_measured: true,
};
const selectedRoute = { selected_model_id: primaryModel, fallback_models: [], selected_strategy: 'deep', proposed_strategy: 'deep' };
const startupAuthorization = { authorized: true, reason: 'ROUTING_ACTIVATION_AUTHORIZED', approvalRefs: ['OWNER-APPROVED'] };
const event = (fields) => ({ schema_version: '1', run_attempt_id: 'a'.repeat(32), attempt_index: 1, event: 'attempt_started', model: primaryModel, result: null, timestamp: '2026-10-21T12:00:00.000Z', duration_ms: null, host_status: null, ...fields });
const attempts = [
  event({}), event({ event: 'attempt_completed', result: 'host_validated_success', duration_ms: 5 }),
  event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 5, host_status: 'success' }),
];
const delivery = { outcome: 'success', artifactId: 'artifact-1', runId: binding.workflowRunId, runAttempt: 2 };
const args = (overrides = {}) => ({ mode: 'enforce', expectedBinding: binding, decisionRecord, finalAudit, delivery, checkRunId: '123', startupAuthorization, headSha: binding.headSha, selectedRoute, attempts, certifiedBundle, ...overrides });

test('publishing requires a fully matching sealed and delivered audit', () => {
  assert.deepEqual(evaluatePublishEligibility(args()), { authorized: true, reason: 'PUBLISH_AUTHORIZED' });
  assert.equal(evaluatePublishEligibility(args({ mode: 'shadow' })).reason, 'NOT_ENFORCE_MODE');
  assert.equal(evaluatePublishEligibility(args({ finalAudit: { ...finalAudit, audit_status: 'incomplete' } })).reason, 'AUDIT_INCOMPLETE');
  assert.equal(evaluatePublishEligibility(args({ expectedBinding: { ...binding, workflowRunId: 'bad' } })).reason, 'RUN_BINDING_INVALID');
  assert.equal(evaluatePublishEligibility(args({ headSha: 'b'.repeat(40) })).reason, 'HEAD_MISMATCH');
  assert.equal(evaluatePublishEligibility(args({ delivery: { ...delivery, runAttempt: '2' } })).authorized, false);
  assert.equal(evaluatePublishEligibility(args({ delivery: { ...delivery, outcome: 'failure' } })).reason, 'ARTIFACT_UPLOAD_FAILED');
  assert.equal(evaluatePublishEligibility(args({ delivery: { ...delivery, artifactId: null } })).reason, 'MISSING_ARTIFACT_ID');
  assert.equal(evaluatePublishEligibility(args({ checkRunId: '' })).reason, 'CHECK_RUN_MISSING');
});

test('scope gap blocks regardless of unrelated startup approval', () => {
  const blocked = evaluatePublishEligibility(args({ finalAudit: { ...finalAudit, review_scope_gap: true } }));
  assert.deepEqual(blocked, { authorized: false, reason: 'REVIEW_SCOPE_GAP_BLOCKED' });
  assert.deepEqual(evaluatePublishEligibility(args({ finalAudit: { ...finalAudit, review_scope_gap: true }, startupAuthorization })), { authorized: false, reason: 'REVIEW_SCOPE_GAP_BLOCKED' });
});

test('zero-review normal skip is eligible but scope-gap skip is not', () => {
  const zeroAudit = { ...finalAudit, executed_review_model: null, host_success_model: null, attempted_review_models: [], review_quality_measured: false };
  assert.equal(evaluatePublishEligibility(args({ decisionRecord: { ...decisionRecord, reviewable_file_count: 0 }, finalAudit: zeroAudit, selectedRoute: { selected_model_id: null, fallback_models: [], selected_strategy: null }, attempts: [], certifiedBundle: null })).authorized, true);
  for (const field of ['review_validation_status', 'head_validation_status']) {
    for (const status of ['not_run', 'failed']) {
      const result = evaluatePublishEligibility(args({ decisionRecord: { ...decisionRecord, reviewable_file_count: 0 },
        finalAudit: { ...zeroAudit, [field]: status }, selectedRoute: { selected_model_id: null, fallback_models: [], selected_strategy: null },
        attempts: [], certifiedBundle: null }));
      assert.equal(result.authorized, false, `${field}=${status} must deny skip publication`);
      assert.equal(result.reason, field === 'review_validation_status' ? 'REVIEW_VALIDATION_FAILED' : 'HEAD_VALIDATION_FAILED');
    }
  }
  assert.equal(evaluatePublishEligibility(args({ decisionRecord: { ...decisionRecord, reviewable_file_count: 0 }, finalAudit: { ...zeroAudit, review_scope_gap: true } })).reason, 'REVIEW_SCOPE_GAP_BLOCKED');
  assert.equal(evaluatePublishEligibility(args({ decisionRecord: { ...decisionRecord, reviewable_file_count: 0 }, finalAudit: { ...finalAudit, executed_review_model: primaryModel, host_success_model: primaryModel, attempted_review_models: [primaryModel], review_quality_measured: true } })).reason, 'AUDIT_INCOMPLETE');
});

test('reviewable files require route validation even when no model is selected', () => {
  assert.equal(evaluatePublishEligibility(args({
    selectedRoute: { selected_model_id: null, fallback_models: [], selected_strategy: null },
  })).reason, 'ROUTING_ACTIVATION_DENIED');
});

test('publish gate rejects incomplete schemas and mismatched decision/audit fields', () => {
  assert.equal(evaluatePublishEligibility(args({ finalAudit: { ...finalAudit, injected: true } })).reason, 'AUDIT_INCOMPLETE');
  assert.equal(evaluatePublishEligibility(args({ decisionRecord: { ...decisionRecord, policy_version: undefined } })).reason, 'AUDIT_INCOMPLETE');
  assert.equal(evaluatePublishEligibility(args({ finalAudit: { ...finalAudit, policy_version: '2.0.0' } })).reason, 'AUDIT_INCOMPLETE');
  assert.equal(evaluatePublishEligibility(args({ finalAudit: { ...finalAudit, head_sha: 'b'.repeat(40) } })).reason, 'AUDIT_INCOMPLETE');
  assert.doesNotThrow(() => validateRoutingDecisionRecord(decisionRecord));
  assert.doesNotThrow(() => validateRoutingAudit(finalAudit));
});

test('publish gate requires a certified catalog model equal to the selected audit model', () => {
  assert.equal(evaluatePublishEligibility(args({ certifiedBundle: { catalog: { models: [{ model_id: 'pending-model', certification_status: 'pending' }] }, evidence: { certification_refs: [], cli_available_models: [] } } })).reason, 'ROUTE_ATTEMPT_MISMATCH');
  assert.equal(evaluatePublishEligibility(args({ certifiedBundle: { catalog: { models: [] }, evidence: { certification_refs: [], cli_available_models: [primaryModel] } } })).reason, 'MODEL_NOT_CERTIFIED');
  assert.equal(evaluatePublishEligibility(args({ certifiedBundle: undefined })).reason, 'MODEL_NOT_CERTIFIED');
  assert.equal(evaluatePublishEligibility(args({ finalAudit: { ...finalAudit, executed_review_model: 'uncertified-model', host_success_model: 'uncertified-model', attempted_review_models: ['uncertified-model'] } })).reason, 'MODEL_NOT_CERTIFIED');
  assert.equal(evaluatePublishEligibility(args({ finalAudit: { ...finalAudit, executed_review_model: primaryModel, host_success_model: null } })).reason, 'AUDIT_INCOMPLETE');
  assert.equal(evaluatePublishEligibility(args({ finalAudit: { ...finalAudit, attempted_review_models: [], executed_review_model: primaryModel } })).reason, 'AUDIT_INCOMPLETE');
});

test('publish gate requires owner approval only for allowed egress', () => {
  const allowed = { ...decisionRecord, egress_status: 'allowed' };
  assert.equal(evaluatePublishEligibility(args({ decisionRecord: allowed, finalAudit: { ...finalAudit, egress_status: 'allowed' } })).reason, 'EGRESS_NOT_APPROVED');
  assert.equal(evaluatePublishEligibility(args({ decisionRecord: allowed, finalAudit: { ...finalAudit, egress_status: 'allowed', owner_approval_ref: 'owner/approval-7' } })).authorized, true);
  assert.equal(evaluatePublishEligibility(args({ decisionRecord: allowed, finalAudit: { ...finalAudit, egress_status: 'allowed', owner_approval_ref: 'bad ref' } })).reason, 'AUDIT_INCOMPLETE');
});

test('publish gate rejects skipped delivery and exact run binding mismatches', () => {
  assert.equal(evaluatePublishEligibility(args({ delivery: { ...delivery, outcome: 'skipped' } })).reason, 'ARTIFACT_UPLOAD_FAILED');
  assert.equal(evaluatePublishEligibility(args({ delivery: { ...delivery, runId: '123' } })).reason, 'RUN_BINDING_MISMATCH');
  assert.equal(evaluatePublishEligibility(args({ delivery: { ...delivery, runAttempt: 3 } })).reason, 'RUN_BINDING_MISMATCH');
});

test('startup authorization is required for normal publication and skips', () => {
  assert.equal(evaluatePublishEligibility(args({ startupAuthorization: null })).reason, 'ROUTING_ACTIVATION_DENIED');
  const zeroAudit = { ...finalAudit, executed_review_model: null, host_success_model: null, attempted_review_models: [], review_quality_measured: false };
  const unapprovedSkipInput = args({ startupAuthorization: undefined, decisionRecord: { ...decisionRecord, reviewable_file_count: 0 }, finalAudit: zeroAudit, selectedRoute: { selected_model_id: null, fallback_models: [], selected_strategy: null }, attempts: [], certifiedBundle: null });
  assert.equal(evaluatePublishEligibility(unapprovedSkipInput).reason, 'ROUTING_ACTIVATION_DENIED');
  const approvedSkipWithoutModelsInput = { ...unapprovedSkipInput, startupAuthorization };
  assert.equal(evaluatePublishEligibility(approvedSkipWithoutModelsInput).authorized, true);
});

test('route validation rejects mismatches, invalid chains, and missing Host success', () => {
  assert.equal(evaluatePublishEligibility(args({ selectedRoute: { ...selectedRoute, selected_model_id: 'other-model', fallback_models: [] } })).reason, 'ROUTE_ATTEMPT_MISMATCH');
  assert.equal(evaluatePublishEligibility(args({ attempts: [] })).reason, 'ROUTE_ATTEMPT_MISMATCH');
  assert.equal(evaluatePublishEligibility(args({ attempts: [ { ...attempts[0], run_attempt_id: 'b'.repeat(32) }, ...attempts.slice(1) ] })).reason, 'ROUTE_ATTEMPT_MISMATCH');
  const noSuccess = attempts.map(item => item.event === 'host_completed' ? { ...item, host_status: 'failed' } : item);
  assert.equal(evaluatePublishEligibility(args({ attempts: noSuccess })).reason, 'ROUTE_ATTEMPT_MISMATCH');
});

test('route strategy below risk floor or inconsistent with the decision is denied', () => {
  assert.equal(evaluatePublishEligibility(args({ selectedRoute: { ...selectedRoute, selected_strategy: 'fast' } })).reason, 'ROUTING_ACTIVATION_DENIED');
  const fastDecision = { ...decisionRecord, selected_strategy: 'fast', proposed_strategy: 'fast' };
  const matchingFastAudit = { ...finalAudit, selected_strategy: 'fast', proposed_strategy: 'fast' };
  assert.equal(evaluatePublishEligibility(args({ decisionRecord: fastDecision, finalAudit: matchingFastAudit } )).reason, 'ROUTING_ACTIVATION_DENIED');
});

test('fallback order cannot regress from fallback to primary', () => {
  const primary = fastModel.model_id;
  const fallback = deepFallbackModel.model_id;
  const route = { ...selectedRoute, selected_model_id: primary, fallback_models: [fallback], selected_strategy: 'fast' };
  const chain = [
    event({ model: fallback }), event({ event: 'attempt_completed', model: fallback, result: 'model_reported_failure', duration_ms: 5 }),
    event({ event: 'attempt_started', attempt_index: 2, model: primary }), event({ event: 'attempt_completed', attempt_index: 2, model: primary, result: 'host_validated_success', duration_ms: 5 }),
    event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 10, host_status: 'success' }),
  ];
  assert.equal(evaluatePublishEligibility(args({ decisionRecord: fastDecisionRecord, finalAudit: fastFinalAudit, selectedRoute: route, attempts: chain })).reason, 'ROUTE_ATTEMPT_MISMATCH');
});

test('delivery, check run, and route constraints remain publication requirements', () => {
  assert.equal(evaluatePublishEligibility(args({ delivery: null })).reason, 'ARTIFACT_UPLOAD_FAILED');
  assert.equal(evaluatePublishEligibility(args({ delivery: { ...delivery, outcome: 'failure' } })).reason, 'ARTIFACT_UPLOAD_FAILED');
  assert.equal(evaluatePublishEligibility(args({ checkRunId: '' })).reason, 'CHECK_RUN_MISSING');
  const tooLowBundle = { catalog: { models: catalog.models.map(model => ({ ...model, capability_tier: 'fast' })) }, evidence: certifiedBundle.evidence };
  assert.equal(evaluatePublishEligibility(args({ certifiedBundle: tooLowBundle })).reason, 'ROUTE_ATTEMPT_MISMATCH');
});

test('fast primary failure followed by allowed deep fallback is publishable', () => {
  const route = { ...selectedRoute, selected_model_id: fastModel.model_id, fallback_models: fastModel.allowed_fallbacks, selected_strategy: 'fast', proposed_strategy: 'fast' };
  const chain = [
    event({ model: fastModel.model_id }),
    event({ event: 'attempt_completed', model: fastModel.model_id, result: 'model_reported_failure', duration_ms: 5 }),
    event({ event: 'attempt_started', attempt_index: 2, model: deepFallbackModel.model_id }),
    event({ event: 'attempt_completed', attempt_index: 2, model: deepFallbackModel.model_id, result: 'host_validated_success', duration_ms: 5 }),
    event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 10, host_status: 'success' }),
  ];
  assert.deepEqual(evaluatePublishEligibility(args({ decisionRecord: fastDecisionRecord, finalAudit: fastFinalAudit, selectedRoute: route, attempts: chain })), { authorized: true, reason: 'PUBLISH_AUTHORIZED' });
});

test('publish gate rejects a saved fallback outside the current certified route', () => {
  const extraDeepModel = { ...catalog.models.find(model => model.capability_tier === 'deep'),
    model_id: 'extra-deep-model', certification_reference: `sha256:${'c'.repeat(64)}`, allowed_fallbacks: [] };
  const routeCatalog = { ...catalog, models: [...catalog.models, extraDeepModel] };
  const routeBundle = { catalog: routeCatalog, evidence: {
    verifiedCertificationRefs: [...certifiedBundle.evidence.verifiedCertificationRefs,
      { model_id: extraDeepModel.model_id, certification_reference: extraDeepModel.certification_reference,
        capability_tier: extraDeepModel.capability_tier, catalog_version: extraDeepModel.catalog_version }],
    cliAvailableModels: [...certifiedBundle.evidence.cliAvailableModels, extraDeepModel.model_id],
    cli_available_models: [...certifiedBundle.evidence.cli_available_models, extraDeepModel.model_id],
  } };
  const route = { ...selectedRoute, fallback_models: [extraDeepModel.model_id] };

  const result = evaluatePublishEligibility(args({ selectedRoute: route, certifiedBundle: routeBundle }));
  assert.equal(result.authorized, false, result.reason);
});
