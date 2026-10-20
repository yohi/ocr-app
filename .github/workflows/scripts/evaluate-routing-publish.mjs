import { assertRunBindingValid, assertSerializedRunBindingMatches, assertRunBindingEquals } from './ocr-run-binding.mjs';
import { validateRoutingAudit, validateRoutingDecisionRecord } from './ocr-routing-audit.mjs';

const result = reason => ({ authorized: false, reason });
const APPROVAL_REF = /^[A-Za-z0-9_.:/-]+$/;
function validateRecords(decisionRecord, finalAudit) {
  validateRoutingDecisionRecord(decisionRecord);
  validateRoutingAudit(finalAudit);
  const sharedFields = [
    ['workflow_run_id', 'workflow_run_id'], ['run_attempt', 'run_attempt'], ['head_sha', 'head_sha'], ['effective_mode', 'effective_mode'],
    ['decision_status', 'decision_status'], ['egress_status', 'egress_status'], ['classification_status', 'classification_status'], ['risk_floor', 'risk_floor'],
    ['selected_strategy', 'selected_strategy'], ['proposed_strategy', 'proposed_strategy'], ['policy_version', 'policy_version'],
    ['feature_schema_version', 'feature_schema_version'], ['decision_state_version', 'decision_state_version'], ['model_catalog_version', 'model_catalog_version'],
  ];
  if (sharedFields.some(([decisionKey, auditKey]) => decisionRecord[decisionKey] !== finalAudit[auditKey])) throw new Error('AUDIT_SCHEMA_INVALID');
}
function certifiedModelIds(catalog) {
  if (!Array.isArray(catalog?.models)) return [];
  return catalog.models.filter(model => model?.certification_status === 'certified' && typeof model.model_id === 'string').map(model => model.model_id);
}

export function evaluatePublishEligibility({ mode, expectedBinding, decisionRecord, finalAudit, delivery, checkRunId, ownerDecisions, headSha, catalog }) {
  if (mode !== 'enforce') return result('NOT_ENFORCE_MODE');
  try { validateRecords(decisionRecord, finalAudit); } catch { return result('AUDIT_INCOMPLETE'); }
  try { assertRunBindingValid(expectedBinding); } catch { return result('RUN_BINDING_INVALID'); }
  if (expectedBinding.mode !== mode) return result('RUN_BINDING_MISMATCH');
  try {
    assertSerializedRunBindingMatches(expectedBinding, decisionRecord);
    assertSerializedRunBindingMatches(expectedBinding, finalAudit);
    assertRunBindingEquals(expectedBinding, { workflowRunId: decisionRecord.workflow_run_id, runAttempt: decisionRecord.run_attempt, headSha: decisionRecord.head_sha, mode: decisionRecord.effective_mode });
    assertRunBindingEquals(expectedBinding, { workflowRunId: finalAudit.workflow_run_id, runAttempt: finalAudit.run_attempt, headSha: finalAudit.head_sha, mode: finalAudit.effective_mode });
  } catch { return result('RUN_BINDING_MISMATCH'); }
  if (headSha !== expectedBinding.headSha) return result('HEAD_MISMATCH');
  if (finalAudit.audit_status !== 'sealed') return result('AUDIT_NOT_SEALED');
  if (finalAudit.review_validation_status !== 'passed') return result('REVIEW_VALIDATION_FAILED');
  if (finalAudit.head_validation_status !== 'passed') return result('HEAD_VALIDATION_FAILED');
  if (finalAudit.review_scope_gap) return result('REVIEW_SCOPE_GAP_BLOCKED');
  if (decisionRecord.egress_status === 'allowed') {
    const approvalRef = finalAudit.owner_approval_ref;
    if (typeof approvalRef !== 'string' || approvalRef.length === 0 || approvalRef.length > 128 || !APPROVAL_REF.test(approvalRef)) return result('EGRESS_NOT_APPROVED');
  }
  if (decisionRecord.reviewable_file_count === 0) {
    if (finalAudit.executed_review_model !== null || finalAudit.attempted_review_models.length !== 0 || finalAudit.host_success_model !== null) return result('AUDIT_INCOMPLETE');
    if (finalAudit.review_scope_gap) return result('REVIEW_SCOPE_GAP_BLOCKED');
  } else {
    const certified = certifiedModelIds(catalog);
    if (certified.length === 0) return result('MODEL_NOT_CERTIFIED');
    if (typeof finalAudit.executed_review_model !== 'string' || !certified.includes(finalAudit.executed_review_model) || finalAudit.executed_review_model !== finalAudit.selected_review_model) return result('MODEL_NOT_CERTIFIED');
  }
  if (delivery?.outcome !== 'success') return result('ARTIFACT_UPLOAD_FAILED');
  if (typeof delivery.artifactId !== 'string' || delivery.artifactId.length === 0) return result('MISSING_ARTIFACT_ID');
  if (delivery.runId !== expectedBinding.workflowRunId || delivery.runAttempt !== expectedBinding.runAttempt) return result('RUN_BINDING_MISMATCH');
  if (typeof checkRunId !== 'string' || checkRunId.length === 0) return result('CHECK_RUN_MISSING');
  return { authorized: true, reason: 'PUBLISH_AUTHORIZED' };
}
