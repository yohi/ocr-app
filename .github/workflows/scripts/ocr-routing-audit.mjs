import fs from 'node:fs';
import { join } from 'node:path';
import { assertRunBindingValid, assertSerializedRunBindingMatches, assertRunBindingEquals } from './ocr-run-binding.mjs';

const CLASSIFICATIONS = ['allowlisted_docs_only', 'high_risk_metadata', 'unclassified_code', 'unclassified_other', 'incomplete'];
const STRATEGIES = ['fast', 'deep'];
const ROUTE_SOURCES = ['model_decision', 'deterministic_fallback', 'not_requested'];
const DECISION_STATUSES = ['succeeded', 'unavailable', 'not_requested', 'invalid_response'];
const EGRESS_STATUSES = ['allowed', 'denied', 'not_checked'];
const EVENTS = ['attempt_started', 'attempt_completed', 'host_completed'];
const RESULTS = ['spawn_failed', 'timeout', 'transport_error', 'invalid_output', 'model_reported_failure', 'host_validated_success', 'host_skipped', 'other_failure'];
const DECISION_KEYS = ['schema_version','effective_mode','head_sha','workflow_run_id','run_attempt','classification_status','risk_floor','reviewable_file_count','proposed_strategy','selected_strategy','route_source','decision_status','egress_status','observer_status','decision_latency_ms','decision_api_cost','policy_version','feature_schema_version','decision_state_version','model_catalog_version'];
const AUDIT_KEYS = ['schema_version','repo_id','repo','pr_number','head_sha','workflow_run_id','run_attempt','effective_mode','decision_status','egress_status','classification_status','risk_floor','selected_strategy','proposed_strategy','policy_version','feature_schema_version','decision_state_version','model_catalog_version','owner_approval_ref','proposed_review_model','selected_review_model','host_success_model','executed_review_model','attempted_review_models','reviewable_file_count','review_validation_status','head_validation_status','audit_status','review_scope_gap','features_incomplete','review_quality_measured','decision_api_cost','latency_ms'];
const ownRecord = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function exactKeys(value, keys) {
  const ownKeys = Reflect.ownKeys(value);
  if (!ownRecord(value) || ownKeys.length !== keys.length || keys.some(key => !Object.hasOwn(value, key) || value[key] === undefined) || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))) throw new Error('AUDIT_SCHEMA_INVALID');
}
function enumValue(value, allowed) { if (!allowed.includes(value)) throw new Error('AUDIT_SCHEMA_INVALID'); }
function count(value) { if (!Number.isSafeInteger(value) || value < 0) throw new Error('AUDIT_SCHEMA_INVALID'); }
function nullableNumber(value) { if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('AUDIT_SCHEMA_INVALID'); }
function validVersion(value) { if (typeof value !== 'string' || value.length === 0 || value.length > 128) throw new Error('AUDIT_SCHEMA_INVALID'); }
function modelId(model) {
  return typeof model === 'string' && model.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/.test(model) ? model : null;
}
function catalogModel(catalog, model, enforce) {
  if (model === null) return null;
  const id = modelId(model);
  if (id === null) return null;
  const found = catalog?.models?.find(item => item?.model_id === id);
  return found && (!enforce || found.certification_status === 'certified') ? id : null;
}
function validateDecision(record) {
  exactKeys(record, DECISION_KEYS);
  if (record.schema_version !== '1' || !/^[0-9a-f]{40}$/.test(record.head_sha) || !/^[1-9][0-9]{0,31}$/.test(record.workflow_run_id) || !Number.isSafeInteger(record.run_attempt) || record.run_attempt < 1) throw new Error('AUDIT_SCHEMA_INVALID');
  enumValue(record.effective_mode, ['shadow','enforce']); enumValue(record.classification_status, CLASSIFICATIONS); enumValue(record.risk_floor, STRATEGIES);
  enumValue(record.route_source, ROUTE_SOURCES); enumValue(record.decision_status, DECISION_STATUSES); enumValue(record.egress_status, EGRESS_STATUSES); enumValue(record.observer_status, ['available','unavailable','not_started']);
  if (record.proposed_strategy !== null) enumValue(record.proposed_strategy, STRATEGIES);
  if (record.selected_strategy !== null) enumValue(record.selected_strategy, STRATEGIES);
  if ((record.effective_mode === 'shadow' && record.selected_strategy !== null) || (record.effective_mode === 'enforce' && record.reviewable_file_count > 0 && record.selected_strategy === null)) throw new Error('AUDIT_SCHEMA_INVALID');
  count(record.reviewable_file_count); nullableNumber(record.decision_latency_ms); nullableNumber(record.decision_api_cost);
  for (const key of ['policy_version','model_catalog_version']) validVersion(record[key]);
  if (record.feature_schema_version !== '3' || record.decision_state_version !== '1') throw new Error('AUDIT_SCHEMA_INVALID');
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
  validateDecision(record);
  return Object.freeze(record);
}

const writtenPaths = new Set();
export function writeRoutingDecision({ runTemp, record, mkdirSync = fs.mkdirSync, writeFileSync = fs.writeFileSync }) {
  validateDecision(record);
  const directory = join(runTemp, 'ocr-routing'); const path = join(directory, 'decision.json');
  if (writtenPaths.has(path)) throw new Error('AUDIT_ALREADY_WRITTEN');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600, flag: 'wx' });
  writtenPaths.add(path);
}

function validEvent(event) {
  const keys = ['schema_version','run_attempt_id','attempt_index','event','model','result','timestamp','duration_ms','host_status'];
  exactKeys(event, keys);
  if (event.schema_version !== '1' || typeof event.run_attempt_id !== 'string' || event.run_attempt_id.length < 1 || event.run_attempt_id.length > 128) throw new Error('AUDIT_EVENT_INVALID');
  enumValue(event.event, EVENTS);
  if (event.attempt_index !== null && (!Number.isSafeInteger(event.attempt_index) || event.attempt_index < 1)) throw new Error('AUDIT_EVENT_INVALID');
  if (event.event !== 'host_completed' && event.attempt_index === null) throw new Error('AUDIT_EVENT_INVALID');
  if (event.model !== null && (typeof event.model !== 'string' || event.model.length > 128)) throw new Error('AUDIT_EVENT_INVALID');
  if (event.event === 'attempt_started' && (event.result !== null || event.duration_ms !== null || event.host_status !== null)) throw new Error('AUDIT_EVENT_INVALID');
  if (event.event === 'attempt_completed' && (event.result === null || event.host_status !== null)) throw new Error('AUDIT_EVENT_INVALID');
  if (event.event === 'host_completed' && (event.result !== null || event.host_status === null)) throw new Error('AUDIT_EVENT_INVALID');
  if (event.result !== null) enumValue(event.result, RESULTS);
  if (event.duration_ms !== null && (typeof event.duration_ms !== 'number' || !Number.isFinite(event.duration_ms) || event.duration_ms < 0)) throw new Error('AUDIT_EVENT_INVALID');
  if (typeof event.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(event.timestamp) || Number.isNaN(Date.parse(event.timestamp))) throw new Error('AUDIT_EVENT_INVALID');
  if (event.host_status !== null) enumValue(event.host_status, ['success','skipped','failed']);
  return event;
}
export function createAttemptRecorder({ runTemp, mode, catalog, appendFileSync = fs.appendFileSync, mkdirSync = fs.mkdirSync }) {
  if (!['shadow','enforce'].includes(mode)) throw new Error('AUDIT_MODE_INVALID');
  const directory = join(runTemp, 'ocr-routing'); const path = join(directory, 'attempts.ndjson');
  let state = 'available'; let sealed = false;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  function onAttemptEvent(event) {
    if (!event || !EVENTS.includes(event.event)) return;
    if (sealed) { state = 'unavailable'; if (mode === 'enforce') throw new Error('AUDIT_EVENT_INVALID'); return; }
    try {
      validEvent(event);
      if (event.model !== null && !catalog?.models?.some(item => item?.model_id === event.model && item.certification_status === 'certified')) state = 'unavailable';
      appendFileSync(path, `${JSON.stringify(event)}\n`, { mode: 0o600, flag: 'a' });
    } catch {
      state = 'unavailable';
      if (mode === 'enforce') throw new Error('AUDIT_EVENT_INVALID');
    }
  }
  function seal() {
    if (sealed) return;
    sealed = true;
    if (state === 'unavailable') return;
    try { appendFileSync(path, '', { mode: 0o600, flag: 'a' }); }
    catch {
      state = 'unavailable';
      if (mode === 'enforce') throw new Error('AUDIT_EVENT_INVALID');
    }
  }
  return Object.freeze({ onAttemptEvent, seal, health: () => state });
}
function validateAttemptOrder(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return { valid: false, completed: [], success: null };
  const started = new Map(); const completed = []; let hostCount = 0; let hostSuccess = null; let priorAttempt = 0; let attemptRun = null; let activeAttempt = null;
  try {
    for (const [position, event] of attempts.entries()) {
      validEvent(event);
      if (attemptRun !== null && attemptRun !== event.run_attempt_id) throw new Error('AUDIT_EVENT_INVALID');
      attemptRun = event.run_attempt_id;
      if (event.event === 'attempt_started') {
        if (activeAttempt !== null || event.attempt_index <= priorAttempt || started.has(event.attempt_index)) throw new Error('AUDIT_EVENT_INVALID');
        priorAttempt = event.attempt_index; started.set(event.attempt_index, event); activeAttempt = event.attempt_index;
      } else if (event.event === 'attempt_completed') {
        if (activeAttempt !== event.attempt_index || event.model !== started.get(event.attempt_index).model) throw new Error('AUDIT_EVENT_INVALID');
        completed.push(event); activeAttempt = null;
      } else {
        hostCount += 1;
        if (hostCount > 1 || activeAttempt !== null || position !== attempts.length - 1 || event.attempt_index !== null || event.model !== null) throw new Error('AUDIT_EVENT_INVALID');
        if (event.host_status === 'success') {
          const eligible = completed.filter(item => item.result === 'host_validated_success');
          if (eligible.length === 1) hostSuccess = eligible[0];
        }
      }
    }
    if (hostCount !== 1 || completed.length !== started.size || [...started.keys()].some(index => !completed.some(item => item.attempt_index === index))) throw new Error('AUDIT_EVENT_INVALID');
    return { valid: true, completed, success: hostSuccess };
  } catch { return { valid: false, completed: [], success: null }; }
}
export function finalizeRoutingAudit({ decision, attempts, reviewResult, validation, headCheck, runBinding, policy, catalog = policy?.catalog }) {
  validateDecision(decision); assertRunBindingValid(runBinding); assertSerializedRunBindingMatches(runBinding, decision);
  assertRunBindingEquals(runBinding, { workflowRunId: decision.workflow_run_id, runAttempt: decision.run_attempt, headSha: decision.head_sha, mode: decision.effective_mode });
  const order = validateAttemptOrder(attempts);
  const enforced = decision.effective_mode === 'enforce';
  const validStatus = value => ['passed','failed','not_run'].includes(value) ? value : 'not_run';
  const reviewStatus = validStatus(validation?.status); const headStatus = validStatus(headCheck?.status);
  const completedModels = order.valid ? order.completed.filter(item => item.event === 'attempt_completed').map(item => enforced ? catalogModel(catalog, item.model, true) : modelId(item.model)).filter(Boolean) : [];
  const attempted = [...new Set(completedModels)];
  const successfulModel = order.valid && order.success ? (enforced ? catalogModel(catalog, order.success.model, true) : modelId(order.success.model)) : null;
  const qualifies = order.valid && order.success && reviewResult?.status === 'success' && reviewStatus === 'passed' && headStatus === 'passed' && successfulModel !== null;
  const model = value => catalogModel(catalog, value ?? null, enforced);
  const repoId = policy?.repoId ?? policy?.repo_id; const repo = policy?.repo ?? policy?.repoName; const pr = policy?.prNumber ?? policy?.pr_number;
  if (!Number.isSafeInteger(repoId) || repoId < 1 || typeof repo !== 'string' || repo.length === 0 || !Number.isSafeInteger(pr) || pr < 1) throw new Error('AUDIT_SCHEMA_INVALID');
  const audit = {
    schema_version: '2', repo_id: repoId, repo, pr_number: pr, head_sha: decision.head_sha, workflow_run_id: decision.workflow_run_id, run_attempt: decision.run_attempt, effective_mode: decision.effective_mode,
    decision_status: decision.decision_status, egress_status: decision.egress_status, classification_status: decision.classification_status, risk_floor: decision.risk_floor,
    selected_strategy: decision.selected_strategy, proposed_strategy: decision.proposed_strategy, policy_version: decision.policy_version, feature_schema_version: decision.feature_schema_version, decision_state_version: decision.decision_state_version, model_catalog_version: decision.model_catalog_version,
    owner_approval_ref: typeof policy?.ownerApprovalRef === 'string' ? policy.ownerApprovalRef : typeof policy?.owner_approval_ref === 'string' ? policy.owner_approval_ref : null,
    proposed_review_model: model(policy?.proposedReviewModel ?? policy?.proposed_review_model ?? decision.proposed_review_model), selected_review_model: model(policy?.selectedReviewModel ?? policy?.selected_review_model ?? decision.selected_review_model), host_success_model: successfulModel,
    executed_review_model: qualifies ? successfulModel : null, attempted_review_models: attempted, reviewable_file_count: decision.reviewable_file_count,
    review_validation_status: reviewStatus, head_validation_status: headStatus, audit_status: 'sealed', review_scope_gap: Boolean(policy?.reviewScopeGap ?? policy?.review_scope_gap),
    features_incomplete: Boolean(policy?.featuresIncomplete ?? policy?.features_incomplete ?? policy?.features?.features_incomplete), review_quality_measured: enforced && Boolean(qualifies),
    decision_api_cost: decision.decision_api_cost, latency_ms: decision.decision_latency_ms,
  };
  exactKeys(audit, AUDIT_KEYS);
  if (!/^[0-9a-f]{40}$/.test(audit.head_sha) || !/^[1-9][0-9]{0,31}$/.test(audit.workflow_run_id)) throw new Error('AUDIT_SCHEMA_INVALID');
  nullableNumber(audit.decision_api_cost); nullableNumber(audit.latency_ms);
  return Object.freeze({ ...audit, attempted_review_models: Object.freeze(audit.attempted_review_models) });
}
