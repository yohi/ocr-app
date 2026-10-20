import { assertRunBindingValid, assertSerializedRunBindingMatches, assertRunBindingEquals } from './ocr-run-binding.mjs';

const result = reason => ({ authorized: false, reason });
const validModels = catalog => catalog?.models?.filter(model => model?.certification_status === 'certified').map(model => model.model_id) ?? [];

export function evaluatePublishEligibility({ mode, expectedBinding, decisionRecord, finalAudit, delivery, checkRunId, ownerDecisions, headSha, catalog }) {
  if (mode !== 'enforce') return result('NOT_ENFORCE_MODE');
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
  if (!finalAudit || finalAudit.schema_version !== '2' || !decisionRecord || decisionRecord.schema_version !== '1' || !Array.isArray(finalAudit.attempted_review_models) || !Number.isSafeInteger(finalAudit.reviewable_file_count) || finalAudit.reviewable_file_count < 0) return result('AUDIT_INCOMPLETE');
  const certified = validModels(catalog);
  const selectedModel = decisionRecord.selected_review_model ?? finalAudit.selected_review_model;
  const modelOk = typeof finalAudit.executed_review_model === 'string' &&
    (certified.length > 0 ? certified.includes(finalAudit.executed_review_model) : finalAudit.executed_review_model === selectedModel);
  if (finalAudit.review_scope_gap === true && ownerDecisions?.d04BlockingApproved !== true) return result('REVIEW_SCOPE_GAP_BLOCKED');
  if (finalAudit.reviewable_file_count === 0) {
    if (finalAudit.review_scope_gap === true) return result('REVIEW_SCOPE_GAP_BLOCKED');
  } else if (finalAudit.executed_review_model === null) return result('REVIEW_EXECUTION_FAILED');
  else if (!modelOk || finalAudit.executed_review_model !== selectedModel) return result('MODEL_NOT_CERTIFIED');
  if (delivery?.outcome !== 'success') return result('ARTIFACT_UPLOAD_FAILED');
  if (typeof delivery.artifactId !== 'string' || delivery.artifactId.length === 0) return result('MISSING_ARTIFACT_ID');
  if (delivery.runId !== expectedBinding.workflowRunId || delivery.runAttempt !== expectedBinding.runAttempt) return result('RUN_BINDING_MISMATCH');
  if (typeof checkRunId !== 'string' || checkRunId.length === 0) return result('CHECK_RUN_MISSING');
  return { authorized: true, reason: 'PUBLISH_AUTHORIZED' };
}
