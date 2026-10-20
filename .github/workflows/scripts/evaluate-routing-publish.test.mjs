import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePublishEligibility } from './evaluate-routing-publish.mjs';
import { validateRoutingAudit, validateRoutingDecisionRecord } from './ocr-routing-audit.mjs';

const binding = { workflowRunId: '9007199254740993', runAttempt: 2, headSha: 'a'.repeat(40), mode: 'enforce' };
const decisionRecord = {
  schema_version: '1', effective_mode: 'enforce', head_sha: binding.headSha, workflow_run_id: binding.workflowRunId, run_attempt: 2,
  classification_status: 'unclassified_code', risk_floor: 'deep', reviewable_file_count: 1, proposed_strategy: 'deep', selected_strategy: 'deep',
  route_source: 'deterministic_fallback', decision_status: 'unavailable', egress_status: 'denied', observer_status: 'not_started',
  decision_latency_ms: null, decision_api_cost: null, policy_version: '1.0.0', feature_schema_version: '3', decision_state_version: '1', model_catalog_version: '1.0.0',
};
const finalAudit = {
  schema_version: '2', repo_id: 42, repo: 'owner/repo', pr_number: 7, head_sha: binding.headSha, workflow_run_id: binding.workflowRunId, run_attempt: 2, effective_mode: 'enforce',
  decision_status: 'unavailable', egress_status: 'denied', classification_status: 'unclassified_code', risk_floor: 'deep', selected_strategy: 'deep', proposed_strategy: 'deep',
  policy_version: '1.0.0', feature_schema_version: '3', decision_state_version: '1', model_catalog_version: '1.0.0', owner_approval_ref: null,
  proposed_review_model: 'certified-model', selected_review_model: 'certified-model', host_success_model: 'certified-model', executed_review_model: 'certified-model',
  attempted_review_models: ['certified-model'], review_validation_status: 'passed', head_validation_status: 'passed', audit_status: 'sealed',
  review_scope_gap: false, features_incomplete: false, review_quality_measured: true, decision_api_cost: null, latency_ms: null,
};
const catalog = { models: [{ model_id: 'certified-model', capability_tier: 'deep', certification_status: 'certified' }] };
const delivery = { outcome: 'success', artifactId: 'artifact-1', runId: binding.workflowRunId, runAttempt: 2 };
const args = (overrides = {}) => ({ mode: 'enforce', expectedBinding: binding, decisionRecord, finalAudit, delivery, checkRunId: '123', ownerDecisions: {}, headSha: binding.headSha, catalog, ...overrides });

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

test('scope gap blocks unless explicitly approved', () => {
  const blocked = evaluatePublishEligibility(args({ finalAudit: { ...finalAudit, review_scope_gap: true } }));
  assert.deepEqual(blocked, { authorized: false, reason: 'REVIEW_SCOPE_GAP_BLOCKED' });
  assert.deepEqual(evaluatePublishEligibility(args({ finalAudit: { ...finalAudit, review_scope_gap: true }, ownerDecisions: { d04BlockingApproved: true } })), { authorized: false, reason: 'REVIEW_SCOPE_GAP_BLOCKED' });
});

test('zero-review normal skip is eligible but scope-gap skip is not', () => {
  const zeroAudit = { ...finalAudit, executed_review_model: null, host_success_model: null, attempted_review_models: [], review_quality_measured: false };
  assert.equal(evaluatePublishEligibility(args({ decisionRecord: { ...decisionRecord, reviewable_file_count: 0 }, finalAudit: zeroAudit, catalog: { models: [] } })).authorized, true);
  assert.equal(evaluatePublishEligibility(args({ decisionRecord: { ...decisionRecord, reviewable_file_count: 0 }, finalAudit: { ...zeroAudit, review_scope_gap: true } })).reason, 'REVIEW_SCOPE_GAP_BLOCKED');
  assert.equal(evaluatePublishEligibility(args({ decisionRecord: { ...decisionRecord, reviewable_file_count: 0 }, finalAudit: { ...finalAudit, executed_review_model: 'certified-model', host_success_model: 'certified-model', attempted_review_models: ['certified-model'], review_quality_measured: true } })).reason, 'AUDIT_INCOMPLETE');
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
  assert.equal(evaluatePublishEligibility(args({ catalog: { models: [{ model_id: 'pending-model', certification_status: 'pending' }] } })).reason, 'MODEL_NOT_CERTIFIED');
  assert.equal(evaluatePublishEligibility(args({ catalog: { models: [] } })).reason, 'MODEL_NOT_CERTIFIED');
  assert.equal(evaluatePublishEligibility(args({ catalog: undefined })).reason, 'MODEL_NOT_CERTIFIED');
  assert.equal(evaluatePublishEligibility(args({ finalAudit: { ...finalAudit, executed_review_model: 'uncertified-model', host_success_model: 'uncertified-model', attempted_review_models: ['uncertified-model'] } })).reason, 'MODEL_NOT_CERTIFIED');
  assert.equal(evaluatePublishEligibility(args({ finalAudit: { ...finalAudit, executed_review_model: 'certified-model', host_success_model: null } })).reason, 'AUDIT_INCOMPLETE');
  assert.equal(evaluatePublishEligibility(args({ finalAudit: { ...finalAudit, attempted_review_models: [], executed_review_model: 'certified-model' } })).reason, 'AUDIT_INCOMPLETE');
});

test('publish gate requires owner approval only for allowed egress', () => {
  const allowed = { ...decisionRecord, egress_status: 'allowed' };
  assert.equal(evaluatePublishEligibility(args({ decisionRecord: allowed, finalAudit: { ...finalAudit, egress_status: 'allowed' } })).reason, 'EGRESS_NOT_APPROVED');
  assert.equal(evaluatePublishEligibility(args({ decisionRecord: allowed, finalAudit: { ...finalAudit, egress_status: 'allowed', owner_approval_ref: 'owner/approval-7' } })).authorized, true);
  assert.equal(evaluatePublishEligibility(args({ decisionRecord: { ...allowed, owner_approval_ref: 'bad ref' }, finalAudit: { ...finalAudit, egress_status: 'allowed' } })).reason, 'AUDIT_INCOMPLETE');
});

test('publish gate rejects skipped delivery and exact run binding mismatches', () => {
  assert.equal(evaluatePublishEligibility(args({ delivery: { ...delivery, outcome: 'skipped' } })).reason, 'ARTIFACT_UPLOAD_FAILED');
  assert.equal(evaluatePublishEligibility(args({ delivery: { ...delivery, runId: '123' } })).reason, 'RUN_BINDING_MISMATCH');
  assert.equal(evaluatePublishEligibility(args({ delivery: { ...delivery, runAttempt: 3 } })).reason, 'RUN_BINDING_MISMATCH');
});
