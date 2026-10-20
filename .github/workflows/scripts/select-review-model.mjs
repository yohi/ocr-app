import { resolveCertifiedModels } from './validate-review-model-catalog.mjs';
import { assertRunBindingValid } from './ocr-run-binding.mjs';

const RANK = Object.freeze({ fast: 0, deep: 1 });
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/;
const DECISION_STATUS = Object.freeze({
  available: 'succeeded', unavailable: 'unavailable', invalid: 'invalid_response',
});

function assertMode(mode, runBinding) {
  if (mode === 'off') throw new Error('routing_disabled');
  if (mode !== 'shadow' && mode !== 'enforce') throw new Error('routing_mode_invalid');
  try {
    assertRunBindingValid(runBinding);
  } catch {
    throw new Error('run_binding_invalid');
  }
  if (runBinding.mode !== mode) throw new Error('run_binding_mismatch');
}

function localFloor(features) {
  return features?.risk_floor === 'fast' ? 'fast' : 'deep';
}

function normalizedDecision(decision) {
  if (decision?.status === 'decision_unavailable') return { status: DECISION_STATUS.unavailable };
  if (decision?.status === 'invalid_response') return { status: DECISION_STATUS.invalid };
  if (decision?.status !== 'decision_available' || !['fast', 'deep'].includes(decision.choice)) {
    return { status: DECISION_STATUS.invalid };
  }
  const probabilities = decision.probabilities;
  if (!probabilities || !['fast', 'deep'].every(key =>
    typeof probabilities[key] === 'number' && Number.isFinite(probabilities[key]) && probabilities[key] >= 0 && probabilities[key] <= 1,
  ) || Math.abs(probabilities.fast + probabilities.deep - 1) > 0.01) {
    return { status: DECISION_STATUS.invalid };
  }
  return { status: DECISION_STATUS.available, choice: decision.choice, probabilities };
}

function strategyFor(floor, decision) {
  if (decision.status !== DECISION_STATUS.available) {
    return { strategy: floor, source: 'deterministic_fallback' };
  }
  const probability = decision.probabilities[decision.choice];
  const margin = Math.abs(decision.probabilities.fast - decision.probabilities.deep);
  if (probability < 0.65 || margin < 0.15) return { strategy: 'deep', source: 'deterministic_fallback' };
  const strategy = RANK[decision.choice] < RANK[floor] ? floor : decision.choice;
  return { strategy, source: strategy === decision.choice ? 'model_decision' : 'deterministic_fallback' };
}

function catalogProposal(catalog, strategy) {
  const modelId = catalog?.strategies?.[strategy]?.preferred_model_id;
  return typeof modelId === 'string' && modelId.length <= 128 && MODEL_ID.test(modelId) ? modelId : null;
}

function boundedRoute(route) {
  if (JSON.stringify(route).length > 4096) throw new Error('review_model_unavailable');
  return route;
}

function result({ mode, strategy, source, decisionStatus, certifiedCatalog }) {
  const catalog = certifiedCatalog?.catalog ?? certifiedCatalog;
  const evidence = certifiedCatalog?.evidence;
  if (mode === 'shadow') {
    return boundedRoute({
      selectedStrategy: null,
      proposedStrategy: strategy,
      selectedReviewModel: null,
      proposedReviewModel: catalogProposal(catalog, strategy),
      fallbackModels: [],
      routeSource: source,
      decisionStatus,
      humanAttention: false,
    });
  }

  let resolved;
  try {
    resolved = resolveCertifiedModels(catalog, strategy, evidence);
  } catch {
    throw new Error('review_model_unavailable');
  }
  const route = {
    selectedStrategy: strategy,
    proposedStrategy: strategy,
    selectedReviewModel: resolved.primaryModelId,
    proposedReviewModel: resolved.primaryModelId,
    fallbackModels: [...resolved.allowedFallbackModels],
    routeSource: source,
    decisionStatus,
    humanAttention: false,
  };
  return boundedRoute(route);
}

export function selectReviewRoute({ mode, features, decision, certifiedCatalog, runBinding }) {
  assertMode(mode, runBinding);
  if (features?.reviewable_file_count === 0) {
    return {
      selectedStrategy: null,
      proposedStrategy: null,
      selectedReviewModel: null,
      proposedReviewModel: null,
      fallbackModels: [],
      routeSource: 'not_requested',
      decisionStatus: 'not_requested',
      humanAttention: false,
    };
  }

  const local = localFloor(features);
  const normalized = normalizedDecision(decision);
  const { strategy, source } = strategyFor(local, normalized);
  return result({
    mode,
    strategy,
    source,
    decisionStatus: normalized.status,
    certifiedCatalog,
  });
}
