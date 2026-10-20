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
  'schema_version', 'effective_mode', 'workflow_run_id', 'run_attempt', 'head_sha',
  'selected_strategy', 'proposed_strategy', 'selected_review_model', 'proposed_review_model',
  'fallback_models', 'route_source', 'decision_status', 'decision_latency_ms', 'decision_api_cost',
]);
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/;
const STRATEGIES = ['fast', 'deep', null];
const DECISION_STATUSES = ['succeeded', 'unavailable', 'not_requested', 'invalid_response'];
const ROUTE_SOURCES = ['model_decision', 'deterministic_fallback', 'not_requested'];
const writtenRoutes = new Set();

function routeError() { throw new Error('ROUTE_SCHEMA_INVALID'); }
function plainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function validateRoute(value) {
  if (!plainRecord(value)) routeError();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== ROUTE_KEYS.length || keys.some(key => typeof key !== 'string' || !ROUTE_KEYS.includes(key) || value[key] === undefined)) routeError();
  if (value.schema_version !== '1' || !['shadow', 'enforce'].includes(value.effective_mode) ||
      !/^[1-9][0-9]{0,31}$/.test(value.workflow_run_id) || !Number.isSafeInteger(value.run_attempt) || value.run_attempt < 1 ||
      !/^[0-9a-f]{40}$/.test(value.head_sha) || !STRATEGIES.includes(value.selected_strategy) || !STRATEGIES.includes(value.proposed_strategy) ||
      !DECISION_STATUSES.includes(value.decision_status) || !ROUTE_SOURCES.includes(value.route_source)) routeError();
  for (const key of ['selected_review_model', 'proposed_review_model']) {
    const model = value[key];
    if (model !== null && (typeof model !== 'string' || model.length > 128 || !MODEL_ID.test(model) || /[\r\n]/.test(model))) routeError();
  }
  if (value.fallback_models !== null && value.fallback_models !== undefined &&
      (!Array.isArray(value.fallback_models) || value.fallback_models.length > 16 || value.fallback_models.some(model => typeof model !== 'string' || model.length > 128 || !MODEL_ID.test(model) || /[\r\n]/.test(model)) || new Set(value.fallback_models).size !== value.fallback_models.length)) routeError();
  for (const key of ['decision_latency_ms', 'decision_api_cost']) {
    if (value[key] !== null && (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0)) routeError();
  }
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

export function readSelectedReviewRoute({ runBinding, runTemp, fs: fileSystem = fs }) {
  assertRunBindingValid(runBinding);
  const route = loadRouteFromFile(join(runTemp, 'ocr-routing', 'route.json'), fileSystem);
  assertSerializedRunBindingMatches(runBinding, route);
  assertRunBindingEquals(runBinding, { workflowRunId: route.workflow_run_id, runAttempt: route.run_attempt, headSha: route.head_sha, mode: route.effective_mode });
  return route;
}

export function writeSelectedReviewRoute({ runTemp, route, runBinding, fs: fileSystem = fs }) {
  validateRoute(route);
  assertRunBindingValid(runBinding);
  assertSerializedRunBindingMatches(runBinding, route);
  assertRunBindingEquals(runBinding, { workflowRunId: route.workflow_run_id, runAttempt: route.run_attempt, headSha: route.head_sha, mode: route.effective_mode });
  const directory = join(runTemp, 'ocr-routing');
  const path = join(directory, 'route.json');
  if (writtenRoutes.has(path)) throw new Error('ROUTE_ALREADY_WRITTEN');
  fileSystem.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fileSystem.chmodSync(directory, 0o700);
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
  const route = validateRoute({
    schema_version: '1', effective_mode: binding.mode, workflow_run_id: binding.workflowRunId,
    run_attempt: binding.runAttempt, head_sha: binding.headSha,
    selected_strategy: resolved.selectedStrategy, proposed_strategy: resolved.proposedStrategy,
    selected_review_model: resolved.selectedReviewModel, proposed_review_model: resolved.proposedReviewModel,
    fallback_models: resolved.fallbackModels, route_source: resolved.routeSource,
    decision_status: resolved.decisionStatus === 'egress_denied' ? 'unavailable' : resolved.decisionStatus,
    decision_latency_ms: decision.latencyMs ?? null, decision_api_cost: decision.cost ?? null,
  });
  const auditRoute = { ...resolved, decisionStatus: route.decision_status };
  const record = createRoutingDecisionRecord({ runBinding: binding, features, decision, egressStatus, route: auditRoute, policyVersions: { policyVersion: policy.policy_version, modelCatalogVersion: catalog.catalog_version } });
  writeRoutingDecision({ runTemp: env.RUNNER_TEMP, record });
  writeSelectedReviewRoute({ runTemp: env.RUNNER_TEMP, route, runBinding: binding, fs: fileSystem });
  fileSystem.writeFileSync(join(env.RUNNER_TEMP, 'ocr-routing-state.json'), `${JSON.stringify({ review_scope_gap: features.review_scope_gap, features_incomplete: features.features_incomplete })}\n`, { mode: 0o600, flag: 'wx' });
  fileSystem.chmodSync(join(env.RUNNER_TEMP, 'ocr-routing-state.json'), 0o600);
  return { route, decisionRecord: record, egressStatus };
}
