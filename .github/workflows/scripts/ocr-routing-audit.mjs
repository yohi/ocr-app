import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { assertRunBindingValid, assertSerializedRunBindingMatches, assertRunBindingEquals } from './ocr-run-binding.mjs';

const CLASSIFICATIONS = ['allowlisted_docs_only', 'high_risk_metadata', 'unclassified_code', 'unclassified_other', 'incomplete'];
const STRATEGIES = ['fast', 'deep'];
const ROUTE_SOURCES = ['model_decision', 'deterministic_fallback', 'not_requested'];
const DECISION_STATUSES = ['succeeded', 'unavailable', 'not_requested', 'invalid_response'];
const EGRESS_STATUSES = ['allowed', 'denied', 'not_checked'];
const EVENTS = ['startup', 'attempt_started', 'attempt_completed', 'host_completed', 'publication'];
const RESULTS = ['spawn_failed', 'timeout', 'transport_error', 'invalid_output', 'model_reported_failure', 'host_validated_success', 'host_skipped', 'other_failure'];
const TIER_RANK = { fast: 1, deep: 2 };
const DECISION_KEYS = ['schema_version','effective_mode','head_sha','workflow_run_id','run_attempt','classification_status','risk_floor','reviewable_file_count','proposed_strategy','selected_strategy','route_source','decision_status','egress_status','observer_status','decision_latency_ms','decision_api_cost','policy_version','feature_schema_version','decision_state_version','model_catalog_version'];
const AUDIT_KEYS = ['schema_version','repo_id','repo','pr_number','head_sha','workflow_run_id','run_attempt','effective_mode','decision_status','egress_status','classification_status','risk_floor','selected_strategy','proposed_strategy','policy_version','feature_schema_version','decision_state_version','model_catalog_version','owner_approval_ref','proposed_review_model','selected_review_model','host_success_model','executed_review_model','attempted_review_models','review_validation_status','head_validation_status','audit_status','review_scope_gap','features_incomplete','review_quality_measured','decision_api_cost','latency_ms'];
const APPROVAL_REF = /^[A-Za-z0-9_.:/-]+$/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/;
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
  if (record.schema_version !== '2' || !Number.isSafeInteger(record.repo_id) || record.repo_id < 1 || !validRepo(record.repo) || !Number.isSafeInteger(record.pr_number) || record.pr_number < 1 || !/^[0-9a-f]{40}$/.test(record.head_sha) || !/^[1-9][0-9]{0,31}$/.test(record.workflow_run_id) || !Number.isSafeInteger(record.run_attempt) || record.run_attempt < 1) throw new Error('AUDIT_SCHEMA_INVALID');
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
  enumValue(record.review_validation_status, ['passed', 'failed', 'not_run']); enumValue(record.head_validation_status, ['passed', 'failed', 'not_run']);
  if (record.audit_status !== 'sealed' || typeof record.review_scope_gap !== 'boolean' || typeof record.features_incomplete !== 'boolean' || typeof record.review_quality_measured !== 'boolean' || (record.effective_mode === 'shadow' && record.review_quality_measured)) throw new Error('AUDIT_SCHEMA_INVALID');
  nullableNumber(record.decision_api_cost); nullableNumber(record.latency_ms);
  return record;
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

function validTimestamp(timestamp) {
  if (typeof timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(timestamp)) return false;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === timestamp.slice(0, 19);
}
function validateAttemptEvent(event, runAttemptId, catalog) {
  if (event?.event === 'startup') {
    exactKeys(event, ['event', 'run_attempt', 'mode', 'binding']);
    assertRunBindingValid(event.binding);
    if (event.run_attempt !== event.binding.runAttempt || event.mode !== event.binding.mode) throw new Error('AUDIT_EVENT_INVALID');
    return event;
  }
  if (event?.event === 'publication') {
    exactKeys(event, ['event', 'run_attempt']);
    if (!Number.isSafeInteger(event.run_attempt) || event.run_attempt < 1) throw new Error('AUDIT_EVENT_INVALID');
    return event;
  }
  const keys = ['schema_version','run_attempt_id','attempt_index','event','model','result','timestamp','duration_ms','host_status'];
  keys.push('run_attempt');
  exactKeys(event, keys);
  if (event.schema_version !== '1' || event.run_attempt_id !== runAttemptId || !Number.isSafeInteger(event.run_attempt) || event.run_attempt < 1) throw new Error('AUDIT_EVENT_INVALID');
  enumValue(event.event, EVENTS);
  if (event.event === 'host_completed' ? event.attempt_index !== null : (!Number.isSafeInteger(event.attempt_index) || event.attempt_index < 1)) throw new Error('AUDIT_EVENT_INVALID');
  if (!validTimestamp(event.timestamp)) throw new Error('AUDIT_EVENT_INVALID');
  if (event.duration_ms !== null && (!Number.isSafeInteger(event.duration_ms) || event.duration_ms < 0)) throw new Error('AUDIT_EVENT_INVALID');
  if (event.event === 'attempt_started' && (event.result !== null || event.duration_ms !== null || event.host_status !== null)) throw new Error('AUDIT_EVENT_INVALID');
  if (event.event === 'attempt_completed' && (event.result === null || event.host_status !== null)) throw new Error('AUDIT_EVENT_INVALID');
  if (event.event === 'host_completed' && (event.result !== null || event.host_status === null)) throw new Error('AUDIT_EVENT_INVALID');
  if (event.result !== null) enumValue(event.result, RESULTS);
  if (event.host_status !== null) enumValue(event.host_status, ['success','skipped','failed']);
  if (event.event === 'host_completed') {
    if (event.model !== null) throw new Error('AUDIT_EVENT_INVALID');
  } else {
    if (typeof event.model !== 'string' || !MODEL_ID.test(event.model) || !catalog?.models?.some(item => item?.model_id === event.model && item.certification_status === 'certified')) throw new Error('AUDIT_MODEL_NOT_CERTIFIED');
  }
  return event;
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
      const boundEvent = event?.event === 'attempt_started' || event?.event === 'attempt_completed' || event?.event === 'host_completed'
        ? { ...event, run_attempt: event.run_attempt ?? runAttempt }
        : event;
      if (runAttempt !== undefined && boundEvent.run_attempt !== runAttempt) throw new Error('AUDIT_EVENT_INVALID');
      validateAttemptEvent(boundEvent, boundRunAttemptId, catalog);
      appendFileSync(path, `${JSON.stringify(boundEvent)}\n`, { mode: 0o600, flag: 'a' });
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
  function recordStartup(binding) {
    try { assertRunBindingValid(binding); } catch (cause) { throw new Error('AUDIT_EVENT_INVALID', { cause }); }
    if (binding.mode !== mode || (runAttempt !== undefined && binding.runAttempt !== runAttempt)) throw new Error('AUDIT_EVENT_INVALID');
    onAttemptEvent({ event: 'startup', run_attempt: binding.runAttempt, mode: binding.mode, binding });
  }
  function recordPublicationAttempt(runAttempt) { onAttemptEvent({ event: 'publication', run_attempt: runAttempt }); }
  return Object.freeze({ onAttemptEvent, recordStartup, recordPublicationAttempt, seal, health: () => state, runAttemptId: boundRunAttemptId });
}

function validateAttemptOrder(attempts, binding, allowEmpty, { relaxed = false } = {}) {
  if (!Array.isArray(attempts) || (attempts.length === 0 && !allowEmpty)) throw new Error('AUDIT_EVENT_INVALID');
  if (attempts.length === 0) return { valid: true, completed: [], success: null };
  const started = new Map(); const completed = []; let hostCount = 0; let hostSuccess = null; let successCount = 0; let priorAttempt = 0; let attemptRun = null; let activeAttempt = null; let hostCompletedSeen = false;
  try {
    for (const [position, event] of attempts.entries()) {
      if (event?.event === 'startup') {
        validateAttemptEvent(event, null, null);
        if (position !== 0 || event.run_attempt !== binding.runAttempt || event.mode !== binding.mode) throw new Error('AUDIT_EVENT_INVALID');
        assertRunBindingEquals(binding, event.binding);
        continue;
      }
      if ((!relaxed && (position === 0 || attempts[0]?.event !== 'startup')) || event?.run_attempt !== binding.runAttempt) throw new Error('AUDIT_EVENT_INVALID');
      if (event?.event === 'publication') {
        validateAttemptEvent(event, null, null);
        if (position !== attempts.length - 1 || activeAttempt !== null || started.size !== completed.length) throw new Error('AUDIT_EVENT_INVALID');
        continue;
      }
      if (hostCompletedSeen) throw new Error('AUDIT_EVENT_INVALID');
      const eventId = event?.run_attempt_id;
      validateAttemptEvent(event, eventId, { models: [{ model_id: event?.model, certification_status: 'certified' }] });
      if (attemptRun !== null && attemptRun !== eventId) throw new Error('AUDIT_EVENT_INVALID');
      attemptRun = eventId;
      if (event.event === 'attempt_started') {
        if (activeAttempt !== null || event.attempt_index <= priorAttempt || started.has(event.attempt_index)) throw new Error('AUDIT_EVENT_INVALID');
        priorAttempt = event.attempt_index; started.set(event.attempt_index, event); activeAttempt = event.attempt_index;
      } else if (event.event === 'attempt_completed') {
        if (activeAttempt !== event.attempt_index || event.model !== started.get(event.attempt_index).model) throw new Error('AUDIT_EVENT_INVALID');
        completed.push(event); activeAttempt = null;
      } else {
        hostCount += 1;
        if (hostCount > 1 || activeAttempt !== null || started.size === 0 || completed.length !== started.size) throw new Error('AUDIT_EVENT_INVALID');
        hostCompletedSeen = true;
        if (event.host_status === 'success') {
          const eligible = completed.filter(item => item.result === 'host_validated_success');
          if (eligible.length !== 1) throw new Error('AUDIT_EVENT_INVALID');
          successCount += 1;
          if (successCount > 1) throw new Error('AUDIT_EVENT_INVALID');
          hostSuccess = eligible[0];
        }
      }
    }
    if (hostCount !== 1 || started.size === 0 || completed.length !== started.size || successCount > 1
      || (!relaxed && attempts.at(-1)?.event !== 'publication')) throw new Error('AUDIT_EVENT_INVALID');
    return { valid: true, completed, success: hostSuccess };
  } catch (cause) { throw Object.assign(new Error('AUDIT_EVENT_INVALID', { cause }), { reason: 'attempt_chain_invalid' }); }
}

export function validateRoutingAttempts({ attempts, selectedRoute, certifiedBundle }) {
  const binding = attempts?.[0]?.binding;
  let order;
  try {
    if (!binding) throw new Error('AUDIT_EVENT_INVALID');
    order = validateAttemptOrder(attempts, binding, false);
    const allowed = [selectedRoute?.selected_model_id, ...(selectedRoute?.fallback_models ?? [])];
    if (!selectedRoute || !Array.isArray(selectedRoute.fallback_models) || typeof selectedRoute.selected_model_id !== 'string') throw new Error('AUDIT_EVENT_INVALID');
    const available = certifiedBundle?.evidence?.cli_available_models;
    const attemptedModels = order.completed.map(item => item.model);
    if (attemptedModels.some(model => !allowed.includes(model))) throw new Error('AUDIT_EVENT_INVALID');
    let priorModelIndex = -1;
    for (const model of attemptedModels) {
      const modelIndex = allowed.indexOf(model);
      if (modelIndex < priorModelIndex) throw new Error('AUDIT_EVENT_INVALID');
      priorModelIndex = modelIndex;
    }
    if (certifiedBundle && (!Array.isArray(available) || attemptedModels.some(model => !available.includes(model)))) throw new Error('AUDIT_EVENT_INVALID');
    const successModel = order.success?.model ?? null;
    if (successModel !== null && (!allowed.includes(successModel) || (Array.isArray(available) && !available.includes(successModel)))) throw new Error('AUDIT_EVENT_INVALID');
    const desiredTier = selectedRoute.selected_strategy ?? selectedRoute.proposed_strategy;
    const successEntry = certifiedBundle?.catalog?.models?.find(model => model?.model_id === successModel);
    if (successModel !== null && desiredTier && successEntry?.capability_tier
      && TIER_RANK[successEntry.capability_tier] < TIER_RANK[desiredTier]) throw new Error('AUDIT_EVENT_INVALID');
    return { attemptedModels, successModel };
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'AUDIT_EVENT_INVALID') throw cause;
    throw Object.assign(new Error('AUDIT_EVENT_INVALID', { cause }), { reason: 'attempt_chain_invalid' });
  }
}

export function finalizeRoutingAudit(input) {
  const allowedKeys = ['decision','attempts','reviewResult','validation','headCheck','runBinding','policy','catalog','selectedRoute','certifiedBundle','runTemp','fs'];
  if (!ownRecord(input) || Reflect.ownKeys(input).some(key => typeof key !== 'string' || !allowedKeys.includes(key))) throw new Error('AUDIT_EVENT_INVALID');
  const { decision, attempts, reviewResult, validation, headCheck, runBinding, policy, catalog = policy?.catalog, selectedRoute, certifiedBundle, runTemp, fs: fileSystem = fs } = input;
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
    try { assertRunBindingEquals(runBinding, chain[0]?.binding); }
    catch (cause) { throw Object.assign(new Error('AUDIT_EVENT_INVALID', { cause }), { reason: 'attempt_chain_invalid' }); }
    validatedAttempts = validateRoutingAttempts({ attempts: chain, selectedRoute, certifiedBundle });
  }
  let order = { valid: false, completed: [], success: null };
  if (enforced && decision.reviewable_file_count > 0) {
    order = validateAttemptOrder(chain, runBinding, false);
  } else if (!enforced && Array.isArray(attempts) && attempts.length > 0) {
    order = validateAttemptOrder(attempts, runBinding, false, { relaxed: true });
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
    schema_version: '2', repo_id: repoId, repo, pr_number: pr, head_sha: decision.head_sha, workflow_run_id: decision.workflow_run_id, run_attempt: decision.run_attempt, effective_mode: decision.effective_mode,
    decision_status: decision.decision_status, egress_status: decision.egress_status, classification_status: decision.classification_status, risk_floor: decision.risk_floor,
    selected_strategy: decision.selected_strategy, proposed_strategy: decision.proposed_strategy, policy_version: decision.policy_version, feature_schema_version: decision.feature_schema_version, decision_state_version: decision.decision_state_version, model_catalog_version: decision.model_catalog_version,
    owner_approval_ref: ownerApprovalRef,
    proposed_review_model: model(policy?.proposedReviewModel ?? policy?.proposed_review_model ?? decision.proposed_review_model), selected_review_model: model(policy?.selectedReviewModel ?? policy?.selected_review_model ?? decision.selected_review_model), host_success_model: successfulModel,
    executed_review_model: qualifies ? successfulModel : null, attempted_review_models: attempted,
    review_validation_status: reviewStatus, head_validation_status: headStatus, audit_status: 'sealed', review_scope_gap: reviewScopeGap,
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
