import fs from 'node:fs';
import { join } from 'node:path';
import { extractPRFeatures } from './extract-pr-review-features.mjs';
import { classifyPRRisk } from './classify-pr-review-risk.mjs';
import { buildDecisionState } from './build-decision-state.mjs';
import { authorizeDecisionEgress } from './authorize-decision-egress.mjs';
import { requestReviewDecision } from './decision-provider.mjs';
import { selectReviewRoute } from './select-review-model.mjs';
import { createRunBindingFromEnv as createCanonicalRunBindingFromEnv, assertRunBindingValid, assertRunBindingEquals, assertSerializedRunBindingMatches } from './ocr-run-binding.mjs';
import { createRoutingDecisionRecord, writeRoutingDecision } from './ocr-routing-audit.mjs';

const ROUTE_KEYS = Object.freeze([
  'schema_version', 'workflow_run_id', 'run_attempt', 'head_sha', 'effective_mode', 'status',
  'reviewable_file_count', 'proposed_strategy', 'selected_strategy', 'selected_model_id',
  'fallback_models', 'route_source', 'decision_status', 'policy_version', 'model_catalog_version',
]);
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/;
const STRATEGIES = ['fast', 'deep', null];
const DECISION_STATUSES = ['succeeded', 'unavailable', 'not_requested', 'invalid_response'];
const ROUTE_SOURCES = ['model_decision', 'deterministic_fallback', 'not_requested'];
const ROUTE_STATUSES = ['prepared', 'no_reviewable_files', 'degraded', 'blocked'];
const writtenRoutes = new Set();

function routeError() { throw new Error('ROUTE_SCHEMA_INVALID'); }
function plainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function modelId(value, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || value.length > 128 || !MODEL_ID.test(value) || /[\r\n]/.test(value)) routeError();
}

function validateRoute(value) {
  if (!plainRecord(value)) routeError();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== ROUTE_KEYS.length || keys.some(key => typeof key !== 'string' || !ROUTE_KEYS.includes(key) || value[key] === undefined)) routeError();
  if (value.schema_version !== '1' || !['shadow', 'enforce'].includes(value.effective_mode) || !ROUTE_STATUSES.includes(value.status) ||
      !/^[1-9][0-9]{0,31}$/.test(value.workflow_run_id) || !Number.isSafeInteger(value.run_attempt) || value.run_attempt < 1 ||
      !/^[0-9a-f]{40}$/.test(value.head_sha) || !Number.isSafeInteger(value.reviewable_file_count) || value.reviewable_file_count < 0 ||
      !STRATEGIES.includes(value.selected_strategy) || !STRATEGIES.includes(value.proposed_strategy) ||
      !DECISION_STATUSES.includes(value.decision_status) || !ROUTE_SOURCES.includes(value.route_source)) routeError();
  modelId(value.selected_model_id, true);
  if (!Array.isArray(value.fallback_models) || value.fallback_models.length > 16 || new Set(value.fallback_models).size !== value.fallback_models.length) routeError();
  for (const fallback of value.fallback_models) modelId(fallback);
  for (const key of ['policy_version', 'model_catalog_version']) {
    if (typeof value[key] !== 'string' || value[key].length < 1 || value[key].length > 128 || /[\r\n]/.test(value[key])) routeError();
  }
  if (value.effective_mode === 'shadow' && (value.selected_model_id !== null || value.fallback_models.length !== 0 || value.selected_strategy !== null)) routeError();
  if (value.status === 'no_reviewable_files' && value.reviewable_file_count !== 0) routeError();
  if (value.route_source === 'not_requested' && value.reviewable_file_count !== 0) routeError();
  return value;
}

export function createRunBindingFromEnv(env) {
  const binding = createCanonicalRunBindingFromEnv(env);
  return Object.freeze(binding);
}

// Keep the shared Task 4 codec as the only authority for runner identity.
export function loadRouteFromFile(path, fileSystem = fs) {
  let route;
  try { route = JSON.parse(fileSystem.readFileSync(path, 'utf8')); } catch { throw new Error('ROUTE_FILE_INVALID'); }
  validateRoute(route);
  return Object.freeze({ ...route, fallback_models: route.fallback_models === null || route.fallback_models === undefined ? route.fallback_models : Object.freeze([...route.fallback_models]) });
}

export function serializeSelectedReviewRoute({ route, runBinding, policyVersions }) {
  assertRunBindingValid(runBinding);
  if (!plainRecord(route) || !plainRecord(policyVersions)) routeError();
  const serialized = {
    schema_version: '1',
    workflow_run_id: runBinding.workflowRunId,
    run_attempt: runBinding.runAttempt,
    head_sha: runBinding.headSha,
    effective_mode: runBinding.mode,
    status: route.status,
    reviewable_file_count: route.reviewableCount,
    proposed_strategy: route.proposedStrategy,
    selected_strategy: route.selectedStrategy,
    selected_model_id: route.selectedModelId ?? route.selectedReviewModel ?? null,
    fallback_models: runBinding.mode === 'shadow' ? [] : [...route.fallbackModels],
    route_source: route.routeSource,
    decision_status: route.decisionStatus,
    policy_version: policyVersions.policyVersion,
    model_catalog_version: policyVersions.modelCatalogVersion,
  };
  validateRoute(serialized);
  return Object.freeze({ ...serialized, fallback_models: Object.freeze([...serialized.fallback_models]) });
}

export function readSelectedReviewRoute({ runBinding, runTemp, fs: fileSystem = fs }) {
  assertRunBindingValid(runBinding);
  const route = loadRouteFromFile(join(runTemp, 'ocr-selected-route.json'), fileSystem);
  assertSerializedRunBindingMatches(runBinding, route);
  assertRunBindingEquals(runBinding, { workflowRunId: route.workflow_run_id, runAttempt: route.run_attempt, headSha: route.head_sha, mode: route.effective_mode });
  return route;
}

export function writeSelectedReviewRoute({ runTemp, result, fs: fileSystem = fs }) {
  const route = serializeSelectedReviewRoute(result);
  const path = join(runTemp, 'ocr-selected-route.json');
  if (writtenRoutes.has(path)) throw new Error('ROUTE_ALREADY_WRITTEN');
  fileSystem.writeFileSync(path, `${JSON.stringify(route)}\n`, { mode: 0o600, flag: 'wx' });
  fileSystem.chmodSync(path, 0o600);
  writtenRoutes.add(path);
}

export async function prepareRoutingStep({ runBinding, env, fs: fileSystem = fs, fetchImpl = fetch, runGit }) {
  if (env?.DECISION_ROUTING_MODE === 'off') return { route: null, decisionRecord: null, egressStatus: 'not_checked' };
  const binding = runBinding ?? createRunBindingFromEnv(env);
  assertRunBindingValid(binding);
  if (!['shadow', 'enforce'].includes(binding.mode) || env?.DECISION_ROUTING_MODE !== binding.mode) throw new Error('RUN_BINDING_MISMATCH');
  const preview = JSON.parse(fileSystem.readFileSync(env.OCR_PREVIEW_PATH, 'utf8'));
  const features = classifyPRRisk(await extractPRFeatures({ cwd: env.TARGET_REPO_PATH || 'target-repo', baseRef: env.BASE_REF, headSha: binding.headSha, preview, ...(runGit ? { runGit } : {}) }),
    JSON.parse(fileSystem.readFileSync(new URL('../config/review-risk-policy.json', import.meta.url), 'utf8')));
  const policy = JSON.parse(fileSystem.readFileSync(new URL('../config/decision-egress-policy.json', import.meta.url), 'utf8'));
  const catalog = JSON.parse(fileSystem.readFileSync(new URL('../config/review-model-catalog.json', import.meta.url), 'utf8'));
  const grant = await authorizeDecisionEgress({ targetRepo: env.TARGET_REPO, headSha: binding.headSha, checkoutRepo: env.CHECKOUT_REPO, runBinding: binding, installationToken: env.GITHUB_TOKEN, policy, fetchImpl });
  let egressStatus = grant.allowed ? 'allowed' : 'denied';
  let decision = { status: 'not_requested', latencyMs: null, cost: null };
  if (features.reviewable_file_count > 0 && !features.features_incomplete && grant.allowed) {
    decision = await requestReviewDecision({ decisionState: buildDecisionState(features), grant, expectedBinding: { ...binding, destination: 'openrouter-decisions' }, apiKey: env.OPENROUTER_API_KEY, fetchImpl, timeoutMs: 5000 });
  }
  const resolved = selectReviewRoute({ mode: binding.mode, features, decision, certifiedCatalog: catalog, runBinding: binding });
  const normalizedDecisionStatus = resolved.decisionStatus === 'egress_denied' ? 'unavailable' : resolved.decisionStatus;
  const auditRoute = { ...resolved, decisionStatus: normalizedDecisionStatus };
  const record = createRoutingDecisionRecord({ runBinding: binding, features, decision, egressStatus, route: auditRoute, policyVersions: { policyVersion: policy.policy_version, modelCatalogVersion: catalog.catalog_version } });
  const policyVersions = { policyVersion: policy.policy_version, modelCatalogVersion: catalog.catalog_version };
  const routeResult = {
    ...resolved,
    status: features.reviewable_file_count === 0 ? 'no_reviewable_files' : normalizedDecisionStatus === 'succeeded' ? 'prepared' : 'degraded',
    decisionStatus: normalizedDecisionStatus,
    reviewableCount: features.reviewable_file_count,
    selectedModelId: resolved.selectedReviewModel,
  };
  const serializedRoute = serializeSelectedReviewRoute({ route: routeResult, runBinding: binding, policyVersions });
  writeRoutingDecision({ runTemp: env.RUNNER_TEMP, record });
  writeSelectedReviewRoute({ runTemp: env.RUNNER_TEMP, result: { route: routeResult, runBinding: binding, policyVersions }, fs: fileSystem });
  fileSystem.writeFileSync(join(env.RUNNER_TEMP, 'ocr-routing-state.json'), `${JSON.stringify({ review_scope_gap: features.review_scope_gap, features_incomplete: features.features_incomplete, owner_approval_ref: grant.approval_ref })}\n`, { mode: 0o600, flag: 'wx' });
  fileSystem.chmodSync(join(env.RUNNER_TEMP, 'ocr-routing-state.json'), 0o600);
  return { route: serializedRoute, decisionRecord: record, egressStatus };
}
