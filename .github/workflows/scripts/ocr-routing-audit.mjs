import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { assertRunBindingValid, assertSerializedRunBindingMatches, assertRunBindingEquals } from './ocr-run-binding.mjs';
import { validateAttemptEvent, validateAttemptOrder, validateRoutingAttempts } from './routing-attempts.mjs';
export { validateRoutingAttempts } from './routing-attempts.mjs';

const CLASSIFICATIONS = ['allowlisted_docs_only', 'high_risk_metadata', 'unclassified_code', 'unclassified_other', 'incomplete'];
const STRATEGIES = ['fast', 'deep'];
const ROUTE_SOURCES = ['model_decision', 'deterministic_fallback', 'not_requested'];
const DECISION_STATUSES = ['succeeded', 'unavailable', 'not_requested', 'invalid_response'];
const EGRESS_STATUSES = ['allowed', 'denied', 'not_checked'];
const DECISION_KEYS = ['schema_version','effective_mode','head_sha','workflow_run_id','run_attempt','classification_status','risk_floor','reviewable_file_count','proposed_strategy','selected_strategy','route_source','decision_status','egress_status','observer_status','decision_latency_ms','decision_api_cost','policy_version','feature_schema_version','decision_state_version','model_catalog_version'];
const AUDIT_KEYS = ['schema_version','repo_id','repo','pr_number','head_sha','workflow_run_id','run_attempt','effective_mode','decision_status','egress_status','classification_status','risk_floor','selected_strategy','proposed_strategy','policy_version','feature_schema_version','decision_state_version','model_catalog_version','owner_approval_ref','proposed_review_model','selected_review_model','host_success_model','executed_review_model','attempted_review_models','result_sha256','review_validation_status','head_validation_status','audit_status','review_scope_gap','features_incomplete','review_quality_measured','decision_api_cost','latency_ms'];
const APPROVAL_REF = /^[A-Za-z0-9_.:/-]+$/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const writtenDecisionPaths = new Set();
const writtenAuditPaths = new Set();

function ownRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
  if (!ownRecord(value)) throw new Error('AUDIT_SCHEMA_INVALID');
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || keys.some(key => !Object.hasOwn(value, key) || value[key] === undefined) || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))) throw new Error('AUDIT_SCHEMA_INVALID');
}
function enumValue(value, allowed) { if (!allowed.includes(value)) throw new Error('AUDIT_SCHEMA_INVALID'); }
function count(value) { if (!Number.isSafeInteger(value) || value < 0) throw new Error('AUDIT_SCHEMA_INVALID'); }
function nullableNumber(value) { if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('AUDIT_SCHEMA_INVALID'); }
function validVersion(value) { if (typeof value !== 'string' || value.length === 0 || value.length > 128) throw new Error('AUDIT_SCHEMA_INVALID'); }
function nullableModelId(value) { if (value !== null && (typeof value !== 'string' || !MODEL_ID.test(value))) throw new Error('AUDIT_SCHEMA_INVALID'); }
function nullableSha256(value) { if (value !== null && (typeof value !== 'string' || !SHA256.test(value))) throw new Error('AUDIT_SCHEMA_INVALID'); }
function nullableApprovalRef(value) {
  if (value !== null && (typeof value !== 'string' || value.length > 128 || !APPROVAL_REF.test(value))) throw new Error('AUDIT_SCHEMA_INVALID');
}
function validRepo(value) { return typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value); }
function catalogModel(catalog, model, enforce) {
  nullableModelId(model);
  if (model === null) return null;
  const found = catalog?.models?.find(item => item?.model_id === model);
  return found && (!enforce || found.certification_status === 'certified') ? model : null;
}

export function validateRoutingDecisionRecord(record) {
  exactKeys(record, DECISION_KEYS);
  if (record.schema_version !== '1' || !/^[0-9a-f]{40}$/.test(record.head_sha) || !/^[1-9][0-9]{0,31}$/.test(record.workflow_run_id) || !Number.isSafeInteger(record.run_attempt) || record.run_attempt < 1) throw new Error('AUDIT_SCHEMA_INVALID');
  enumValue(record.effective_mode, ['shadow','enforce']); enumValue(record.classification_status, CLASSIFICATIONS); enumValue(record.risk_floor, STRATEGIES);
  enumValue(record.route_source, ROUTE_SOURCES); enumValue(record.decision_status, DECISION_STATUSES); enumValue(record.egress_status, EGRESS_STATUSES); enumValue(record.observer_status, ['available','unavailable','not_started']);
  if (record.proposed_strategy !== null) enumValue(record.proposed_strategy, STRATEGIES);
  if (record.selected_strategy !== null) enumValue(record.selected_strategy, STRATEGIES);
  if ((record.effective_mode === 'shadow' && record.selected_strategy !== null) || (record.effective_mode === 'enforce' && record.reviewable_file_count > 0 && record.selected_strategy === null)) throw new Error('AUDIT_SCHEMA_INVALID');
  count(record.reviewable_file_count); nullableNumber(record.decision_latency_ms); nullableNumber(record.decision_api_cost);
  if (record.route_source === 'not_requested' && record.reviewable_file_count !== 0) throw new Error('AUDIT_SCHEMA_INVALID');
  validVersion(record.policy_version); validVersion(record.model_catalog_version);
  if (record.feature_schema_version !== '3' || record.decision_state_version !== '1') throw new Error('AUDIT_SCHEMA_INVALID');
  return record;
}

export function validateRoutingAudit(record) {
  exactKeys(record, AUDIT_KEYS);
  if (record.schema_version !== '3' || !Number.isSafeInteger(record.repo_id) || record.repo_id < 1 || !validRepo(record.repo) || !Number.isSafeInteger(record.pr_number) || record.pr_number < 1 || !/^[0-9a-f]{40}$/.test(record.head_sha) || !/^[1-9][0-9]{0,31}$/.test(record.workflow_run_id) || !Number.isSafeInteger(record.run_attempt) || record.run_attempt < 1) throw new Error('AUDIT_SCHEMA_INVALID');
  enumValue(record.effective_mode, ['shadow','enforce']); enumValue(record.decision_status, DECISION_STATUSES); enumValue(record.egress_status, EGRESS_STATUSES);
  enumValue(record.classification_status, CLASSIFICATIONS); enumValue(record.risk_floor, STRATEGIES);
  if (record.selected_strategy !== null) enumValue(record.selected_strategy, STRATEGIES);
  if (record.proposed_strategy !== null) enumValue(record.proposed_strategy, STRATEGIES);
  for (const key of ['policy_version', 'model_catalog_version']) validVersion(record[key]);
  if (record.feature_schema_version !== '3' || record.decision_state_version !== '1') throw new Error('AUDIT_SCHEMA_INVALID');
  nullableApprovalRef(record.owner_approval_ref);
  for (const key of ['proposed_review_model', 'selected_review_model', 'host_success_model', 'executed_review_model']) nullableModelId(record[key]);
  if (!Array.isArray(record.attempted_review_models) || record.attempted_review_models.some(model => typeof model !== 'string' || !MODEL_ID.test(model)) || new Set(record.attempted_review_models).size !== record.attempted_review_models.length) throw new Error('AUDIT_SCHEMA_INVALID');
  if (record.executed_review_model !== null) {
    if (record.host_success_model !== record.executed_review_model || !record.attempted_review_models.includes(record.executed_review_model)) throw new Error('AUDIT_SCHEMA_INVALID');
  }
  nullableSha256(record.result_sha256);
  enumValue(record.review_validation_status, ['passed', 'failed', 'not_run']); enumValue(record.head_validation_status, ['passed', 'failed', 'not_run']);
  if (record.result_sha256 === null && record.review_validation_status === 'passed') throw new Error('AUDIT_SCHEMA_INVALID');
  if (record.audit_status !== 'sealed' || typeof record.review_scope_gap !== 'boolean' || typeof record.features_incomplete !== 'boolean' || typeof record.review_quality_measured !== 'boolean' || (record.effective_mode === 'shadow' && record.review_quality_measured)) throw new Error('AUDIT_SCHEMA_INVALID');
  nullableNumber(record.decision_api_cost); nullableNumber(record.latency_ms);
  return record;
}

export function verifyValidatedResultEvidence({ rawBytes, validatedResultSha256, validationStatus }) {
  enumValue(validationStatus, ['passed', 'failed', 'not_run']);
  if (rawBytes !== null && !Buffer.isBuffer(rawBytes)) throw new Error('AUDIT_SCHEMA_INVALID');

  const resultSha256 = rawBytes === null ? null : createHash('sha256').update(rawBytes).digest('hex');
  const validatorDigestMatches = typeof validatedResultSha256 === 'string'
    && SHA256.test(validatedResultSha256)
    && resultSha256 !== null
    && validatedResultSha256 === resultSha256;
  const reviewValidationStatus = validationStatus === 'passed' && !validatorDigestMatches ? 'failed' : validationStatus;

  return { reviewValidationStatus, resultSha256 };
}

export function createRoutingDecisionRecord({ runBinding, features, decision, egressStatus, route, policyVersions }) {
  assertRunBindingValid(runBinding);
  if (!ownRecord(features) || !ownRecord(decision) || !ownRecord(route) || !ownRecord(policyVersions)) throw new Error('AUDIT_SCHEMA_INVALID');
  const record = {
    schema_version: '1', effective_mode: runBinding.mode, head_sha: runBinding.headSha, workflow_run_id: runBinding.workflowRunId, run_attempt: runBinding.runAttempt,
    classification_status: features.classification_status, risk_floor: features.risk_floor, reviewable_file_count: features.reviewable_file_count,
    proposed_strategy: route.proposedStrategy ?? null, selected_strategy: route.selectedStrategy ?? null, route_source: route.routeSource, decision_status: route.decisionStatus,
    egress_status: egressStatus, observer_status: 'not_started', decision_latency_ms: decision.latencyMs ?? null, decision_api_cost: decision.cost ?? null,
    policy_version: policyVersions.policyVersion, feature_schema_version: '3', decision_state_version: '1', model_catalog_version: policyVersions.modelCatalogVersion,
  };
  validateRoutingDecisionRecord(record);
  return Object.freeze(record);
}

export function writeRoutingDecision({ runTemp, record, mkdirSync = fs.mkdirSync, writeFileSync = fs.writeFileSync, chmodSync = fs.chmodSync }) {
  validateRoutingDecisionRecord(record);
  const directory = join(runTemp, 'ocr-routing'); const path = join(directory, 'decision.json');
  if (writtenDecisionPaths.has(path)) throw new Error('AUDIT_ALREADY_WRITTEN');
  mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
  writeFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600, flag: 'wx' }); chmodSync(path, 0o600);
  writtenDecisionPaths.add(path);
}

export function createAttemptRecorder({ runTemp, mode, catalog, runAttemptId, runAttempt, appendFileSync = fs.appendFileSync, mkdirSync = fs.mkdirSync, chmodSync = fs.chmodSync }) {
  if (!['shadow','enforce'].includes(mode)) throw new Error('AUDIT_MODE_INVALID');
  if (!Number.isSafeInteger(runAttempt) || runAttempt < 1) throw new Error('AUDIT_EVENT_INVALID: runAttempt must be a positive safe integer');
  const boundRunAttemptId = runAttemptId ?? randomBytes(16).toString('hex');
  if (typeof boundRunAttemptId !== 'string' || !/^[a-f0-9]{32}$/.test(boundRunAttemptId)) throw new Error('AUDIT_EVENT_INVALID');
  const directory = join(runTemp, 'ocr-routing'); const path = join(directory, 'attempts.ndjson');
  let state = 'available'; let sealed = false;
  mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
  function markUnavailable(error) {
    state = 'unavailable';
    if (mode === 'enforce') throw new Error(error === 'AUDIT_MODEL_NOT_CERTIFIED' ? error : 'AUDIT_EVENT_INVALID');
  }
  function onAttemptEvent(event) {
    if (sealed) { markUnavailable('AUDIT_EVENT_INVALID'); return; }
    try {
      validateAttemptEvent(event, boundRunAttemptId, catalog, mode === 'enforce');
      appendFileSync(path, `${JSON.stringify(event)}\n`, { mode: 0o600, flag: 'a' });
      chmodSync(path, 0o600);
    } catch (error) {
      markUnavailable(error instanceof Error && error.message === 'AUDIT_MODEL_NOT_CERTIFIED' ? error.message : 'AUDIT_EVENT_INVALID');
    }
  }
  function seal() {
    if (sealed) return;
    sealed = true;
    if (state === 'unavailable') return;
    try { appendFileSync(path, '', { mode: 0o600, flag: 'a' }); chmodSync(path, 0o600); }
    catch { markUnavailable('AUDIT_EVENT_INVALID'); }
  }
  return Object.freeze({ onAttemptEvent, seal, health: () => state, runAttemptId: boundRunAttemptId });
}

export function finalizeRoutingAudit(input) {
  const allowedKeys = ['decision','attempts','reviewResult','validation','headCheck','runBinding','policy','catalog','selectedRoute','certifiedBundle','runTemp','resultSha256','fs'];
  if (!ownRecord(input) || Reflect.ownKeys(input).some(key => typeof key !== 'string' || !allowedKeys.includes(key))) throw new Error('AUDIT_EVENT_INVALID');
  const { decision, attempts, reviewResult, validation, headCheck, runBinding, policy, catalog = policy?.catalog, selectedRoute, certifiedBundle, runTemp, resultSha256, fs: fileSystem = fs } = input;
  validateRoutingDecisionRecord(decision); assertRunBindingValid(runBinding); assertSerializedRunBindingMatches(runBinding, decision);
  assertRunBindingEquals(runBinding, { workflowRunId: decision.workflow_run_id, runAttempt: decision.run_attempt, headSha: decision.head_sha, mode: decision.effective_mode });
  const enforced = decision.effective_mode === 'enforce';
  if (enforced && Array.isArray(attempts) && attempts.length === 0 && (decision.reviewable_file_count !== 0 || reviewResult?.status !== 'skipped')) throw new Error('AUDIT_EVENT_INVALID');
  let chain = attempts;
  let validatedAttempts = { attemptedModels: [], successModel: null };
  if (enforced && decision.reviewable_file_count > 0) {
    if (typeof runTemp !== 'string' || !selectedRoute || !certifiedBundle) throw new Error('AUDIT_EVENT_INVALID');
    try {
      const path = join(runTemp, 'ocr-routing', 'attempts.ndjson');
      const lines = fileSystem.readFileSync(path, 'utf8').split(/\r?\n/);
      if (lines.at(-1) === '') lines.pop();
      if (lines.length === 0 || lines.some(line => line.trim() === '')) throw new Error('AUDIT_EVENT_INVALID');
      chain = lines.map(line => JSON.parse(line));
      if (!isDeepStrictEqual(chain, attempts)) throw new Error('AUDIT_EVENT_INVALID');
    } catch (cause) { throw Object.assign(new Error('AUDIT_EVENT_INVALID', { cause }), { reason: 'attempt_chain_unavailable' }); }
    validatedAttempts = validateRoutingAttempts({ attempts: chain, selectedRoute, certifiedBundle });
  }
  let order = { valid: false, completed: [], success: null };
  if (enforced && decision.reviewable_file_count > 0) {
    order = validateAttemptOrder(chain, runBinding, false);
  } else if (!enforced && Array.isArray(attempts) && attempts.length > 0) {
    order = validateAttemptOrder(attempts, runBinding, false);
    validatedAttempts = { attemptedModels: order.completed.map(item => item.model), successModel: order.success?.model ?? null };
  } else if (enforced && reviewResult?.status === 'skipped' && decision.reviewable_file_count === 0) {
    order = validateAttemptOrder(chain, runBinding, true);
  }
  const status = value => ['passed','failed','not_run'].includes(value) ? value : 'not_run';
  const reviewStatus = status(validation?.status); const headStatus = status(headCheck?.status);
  const completedModels = order.valid ? validatedAttempts.attemptedModels.map(item => enforced ? catalogModel(catalog, item, true) : item).filter(Boolean) : [];
  const attempted = [...new Set(completedModels)];
  const successfulModel = order.valid && validatedAttempts.successModel ? catalogModel(catalog, validatedAttempts.successModel, enforced) : null;
  const qualifies = order.valid && order.success && reviewResult?.status === 'success' && reviewStatus === 'passed' && headStatus === 'passed' && successfulModel !== null;
  const model = value => catalogModel(catalog, value ?? null, enforced);
  const repoId = policy?.repoId ?? policy?.repo_id; const repo = policy?.repo ?? policy?.repoName; const pr = policy?.prNumber ?? policy?.pr_number;
  if (!Number.isSafeInteger(repoId) || repoId < 1 || !validRepo(repo) || !Number.isSafeInteger(pr) || pr < 1) throw new Error('AUDIT_SCHEMA_INVALID');
  const reviewScopeGap = policy?.review_scope_gap ?? policy?.features?.review_scope_gap ?? policy?.reviewScopeGap ?? policy?.features?.reviewScopeGap;
  const featuresIncomplete = policy?.features_incomplete ?? policy?.features?.features_incomplete ?? policy?.featuresIncomplete ?? policy?.features?.featuresIncomplete;
  if (typeof reviewScopeGap !== 'boolean' || typeof featuresIncomplete !== 'boolean') throw new Error('AUDIT_SCHEMA_INVALID');
  const ownerApprovalRef = policy?.ownerApprovalRef ?? policy?.owner_approval_ref ?? null;
  nullableApprovalRef(ownerApprovalRef);
  const audit = {
    schema_version: '3', repo_id: repoId, repo, pr_number: pr, head_sha: decision.head_sha, workflow_run_id: decision.workflow_run_id, run_attempt: decision.run_attempt, effective_mode: decision.effective_mode,
    decision_status: decision.decision_status, egress_status: decision.egress_status, classification_status: decision.classification_status, risk_floor: decision.risk_floor,
    selected_strategy: decision.selected_strategy, proposed_strategy: decision.proposed_strategy, policy_version: decision.policy_version, feature_schema_version: decision.feature_schema_version, decision_state_version: decision.decision_state_version, model_catalog_version: decision.model_catalog_version,
    owner_approval_ref: ownerApprovalRef,
    proposed_review_model: model(policy?.proposedReviewModel ?? policy?.proposed_review_model ?? decision.proposed_review_model), selected_review_model: model(policy?.selectedReviewModel ?? policy?.selected_review_model ?? decision.selected_review_model), host_success_model: successfulModel,
    executed_review_model: qualifies ? successfulModel : null, attempted_review_models: attempted,
    result_sha256: resultSha256, review_validation_status: reviewStatus, head_validation_status: headStatus, audit_status: 'sealed', review_scope_gap: reviewScopeGap,
    features_incomplete: featuresIncomplete, review_quality_measured: enforced && Boolean(qualifies),
    decision_api_cost: decision.decision_api_cost, latency_ms: decision.decision_latency_ms,
  };
  validateRoutingAudit(audit);
  return Object.freeze({ ...audit, attempted_review_models: Object.freeze(audit.attempted_review_models) });
}

export function writeRoutingAudit({ runTemp, record, expectedBinding, fs: fileSystem = fs }) {
  validateRoutingAudit(record); assertRunBindingValid(expectedBinding); assertSerializedRunBindingMatches(expectedBinding, record);
  const directory = join(runTemp, 'ocr-routing'); const path = join(directory, 'final.json');
  if (writtenAuditPaths.has(path)) throw new Error('AUDIT_ALREADY_WRITTEN');
  fileSystem.mkdirSync(directory, { recursive: true, mode: 0o700 }); fileSystem.chmodSync(directory, 0o700);
  fileSystem.writeFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600, flag: 'wx' }); fileSystem.chmodSync(path, 0o600);
  writtenAuditPaths.add(path);
}
