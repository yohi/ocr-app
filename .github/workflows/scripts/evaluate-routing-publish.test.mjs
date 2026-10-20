import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePublishEligibility } from './evaluate-routing-publish.mjs';

const binding = { workflowRunId: '9007199254740993', runAttempt: 2, headSha: 'a'.repeat(40), mode: 'enforce' };
const decisionRecord = { schema_version: '1', workflow_run_id: binding.workflowRunId, run_attempt: 2, head_sha: binding.headSha, effective_mode: 'enforce', selected_review_model: 'certified-model' };
const finalAudit = { schema_version: '2', workflow_run_id: binding.workflowRunId, run_attempt: 2, head_sha: binding.headSha, effective_mode: 'enforce', audit_status: 'sealed', review_validation_status: 'passed', head_validation_status: 'passed', executed_review_model: 'certified-model', attempted_review_models: ['certified-model'], review_scope_gap: false, reviewable_file_count: 1 };
const delivery = { outcome: 'success', artifactId: 'artifact-1', runId: binding.workflowRunId, runAttempt: 2 };
const args = (overrides = {}) => ({ mode: 'enforce', expectedBinding: binding, decisionRecord, finalAudit, delivery, checkRunId: '123', ownerDecisions: {}, headSha: binding.headSha, ...overrides });

test('publishing requires a fully matching sealed and delivered audit', () => {
  assert.deepEqual(evaluatePublishEligibility(args()), { authorized: true, reason: 'PUBLISH_AUTHORIZED' });
  assert.equal(evaluatePublishEligibility(args({ mode: 'shadow' })).reason, 'NOT_ENFORCE_MODE');
  assert.equal(evaluatePublishEligibility(args({ finalAudit: { ...finalAudit, audit_status: 'incomplete' } })).reason, 'AUDIT_NOT_SEALED');
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
  assert.equal(evaluatePublishEligibility(args({ finalAudit: { ...finalAudit, review_scope_gap: true }, ownerDecisions: { d04BlockingApproved: true } })).authorized, true);
});

test('zero-review normal skip is eligible but scope-gap skip is not', () => {
  assert.equal(evaluatePublishEligibility(args({ finalAudit: { ...finalAudit, reviewable_file_count: 0, executed_review_model: null } })).authorized, true);
  assert.equal(evaluatePublishEligibility(args({ finalAudit: { ...finalAudit, reviewable_file_count: 0, review_scope_gap: true }, ownerDecisions: { d04BlockingApproved: true } })).reason, 'REVIEW_SCOPE_GAP_BLOCKED');
});
