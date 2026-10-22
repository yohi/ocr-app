import { assertRunBindingValid, assertSerializedRunBindingMatches, assertRunBindingEquals } from './ocr-run-binding.mjs';
import { validateRoutingAudit, validateRoutingDecisionRecord, validateRoutingAttempts } from './ocr-routing-audit.mjs';

const result = reason => ({ authorized: false, reason });
const APPROVAL_REF = /^[A-Za-z0-9_.:/-]+$/;

const tierRank = { fast: 1, deep: 2 };
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

export function evaluatePublishEligibility({ mode, expectedBinding, decisionRecord, finalAudit, delivery, checkRunId, startupAuthorization, headSha, selectedRoute, attempts, certifiedBundle }) {
  if (mode !== 'enforce') return result('NOT_ENFORCE_MODE');
  if (startupAuthorization?.authorized !== true || !Array.isArray(startupAuthorization.approvalRefs)
    || startupAuthorization.approvalRefs.some(ref => typeof ref !== 'string' || !APPROVAL_REF.test(ref))) return result('ROUTING_ACTIVATION_DENIED');
  try { assertRunBindingValid(expectedBinding); } catch { return result('RUN_BINDING_INVALID'); }
  if (headSha !== expectedBinding.headSha) return result('HEAD_MISMATCH');
  try { validateRecords(decisionRecord, finalAudit); } catch { return result('AUDIT_INCOMPLETE'); }
  if (expectedBinding.mode !== mode) return result('RUN_BINDING_MISMATCH');
  try {
    assertSerializedRunBindingMatches(expectedBinding, decisionRecord);
    assertSerializedRunBindingMatches(expectedBinding, finalAudit);
    assertRunBindingEquals(expectedBinding, { workflowRunId: decisionRecord.workflow_run_id, runAttempt: decisionRecord.run_attempt, headSha: decisionRecord.head_sha, mode: decisionRecord.effective_mode });
    assertRunBindingEquals(expectedBinding, { workflowRunId: finalAudit.workflow_run_id, runAttempt: finalAudit.run_attempt, headSha: finalAudit.head_sha, mode: finalAudit.effective_mode });
  } catch { return result('RUN_BINDING_MISMATCH'); }
  if (finalAudit.audit_status !== 'sealed') return result('AUDIT_NOT_SEALED');
  const emptyReview = decisionRecord.reviewable_file_count === 0;
  if (!emptyReview) {
    const selectedStrategyRank = tierRank[selectedRoute?.selected_strategy];
    const riskFloorRank = tierRank[decisionRecord.risk_floor];
    if (!selectedStrategyRank || !riskFloorRank || selectedStrategyRank < riskFloorRank
      || decisionRecord.selected_strategy !== selectedRoute.selected_strategy) return result('ROUTING_ACTIVATION_DENIED');
  }
  if (!emptyReview && finalAudit.review_validation_status !== 'passed') return result('REVIEW_VALIDATION_FAILED');
  if (!emptyReview && finalAudit.head_validation_status !== 'passed') return result('HEAD_VALIDATION_FAILED');
  if (finalAudit.review_scope_gap) return result('REVIEW_SCOPE_GAP_BLOCKED');
  if (decisionRecord.egress_status === 'allowed') {
    const approvalRef = finalAudit.owner_approval_ref;
    if (typeof approvalRef !== 'string' || approvalRef.length === 0 || approvalRef.length > 128 || !APPROVAL_REF.test(approvalRef)) return result('EGRESS_NOT_APPROVED');
  }
  if (emptyReview) {
    if (!Array.isArray(attempts) || attempts.length !== 0 || finalAudit.executed_review_model !== null
      || finalAudit.attempted_review_models.length !== 0 || finalAudit.host_success_model !== null
      || selectedRoute?.selected_model_id !== null || selectedRoute?.fallback_models?.length !== 0) return result('AUDIT_INCOMPLETE');
  } else {
    let validation;
    try {
      assertRunBindingEquals(expectedBinding, attempts?.[0]?.binding);
      validation = validateRoutingAttempts({ attempts, selectedRoute, certifiedBundle });
    }
    catch { return result('ROUTE_ATTEMPT_MISMATCH'); }
    if (!validation.successModel) return result('ROUTE_ATTEMPT_MISMATCH');
    const primary = selectedRoute.selected_model_id;
    const successModel = validation.successModel;
    const fallback = successModel !== primary;
    if (fallback && (!selectedRoute.fallback_models.includes(successModel)
      || !attempts.some(event => event.event === 'attempt_completed' && event.model === primary && event.result !== 'host_validated_success'))) return result('ROUTE_ATTEMPT_MISMATCH');
    const catalogModels = certifiedBundle?.catalog?.models;
    const certified = certifiedModelIds(certifiedBundle?.catalog);
    const availableModels = certifiedBundle?.evidence?.cli_available_models;
    const successEntry = catalogModels?.find(model => model.model_id === successModel && model.certification_status === 'certified');
    const requiredTier = selectedRoute.selected_strategy ?? decisionRecord.risk_floor;
    if (!certified.includes(successModel) || !Array.isArray(availableModels)
      || !availableModels.includes(successModel) || finalAudit.executed_review_model !== successModel
      || finalAudit.host_success_model !== successModel || finalAudit.selected_review_model !== primary
      || !successEntry || !tierRank[successEntry.capability_tier] || tierRank[successEntry.capability_tier] < tierRank[requiredTier]
      || tierRank[successEntry.capability_tier] < tierRank[decisionRecord.risk_floor]) return result('MODEL_NOT_CERTIFIED');
  }
  if (delivery?.outcome !== 'success') return result('ARTIFACT_UPLOAD_FAILED');
  if (typeof delivery.artifactId !== 'string' || delivery.artifactId.length === 0) return result('MISSING_ARTIFACT_ID');
  if (delivery.runId !== expectedBinding.workflowRunId || delivery.runAttempt !== expectedBinding.runAttempt) return result('RUN_BINDING_MISMATCH');
  if (typeof checkRunId !== 'string' || checkRunId.length === 0) return result('CHECK_RUN_MISSING');
  return { authorized: true, reason: 'PUBLISH_AUTHORIZED' };
}
