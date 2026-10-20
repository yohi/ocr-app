import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(readFileSync(new URL('../config/review-model-catalog.schema.json', import.meta.url), 'utf8'));
const validateSchema = new Ajv2020({ allErrors: true }).compile(schema);
const tierRank = Object.freeze({ fast: 0, deep: 1 });

function fail(code) {
  throw new Error(code);
}

export function validateCatalogShape(catalog) {
  if (!validateSchema(catalog)) fail('invalid_catalog_shape');
}

function certificationIsVerified(model, verifiedCertificationRefs) {
  return Array.isArray(verifiedCertificationRefs) && verifiedCertificationRefs.some(reference =>
    reference?.certification_reference === model.certification_reference &&
    reference?.model_id === model.model_id &&
    reference?.capability_tier === model.capability_tier &&
    reference?.catalog_version === model.catalog_version,
  );
}

export function validateCatalogSemantics(catalog, { verifiedCertificationRefs, cliAvailableModels } = {}) {
  if (Array.isArray(catalog?.models)) {
    const identifiers = new Set();
    for (const model of catalog.models) {
      if (typeof model?.model_id === 'string') {
        if (identifiers.has(model.model_id)) fail('duplicate_model_id');
        identifiers.add(model.model_id);
      }
      if (Array.isArray(model?.allowed_fallbacks) &&
          new Set(model.allowed_fallbacks).size !== model.allowed_fallbacks.length) {
        fail('duplicate_fallback');
      }
    }
  }
  validateCatalogShape(catalog);
  const models = new Map();
  for (const model of catalog.models) {
    if (models.has(model.model_id)) fail('duplicate_model_id');
    if (model.catalog_version !== catalog.catalog_version) fail('catalog_version_mismatch');
    if (!Array.isArray(cliAvailableModels) || !cliAvailableModels.includes(model.model_id)) {
      fail('model_unavailable');
    }
    models.set(model.model_id, model);
  }

  for (const strategy of ['fast', 'deep']) {
    const preferred = models.get(catalog.strategies[strategy].preferred_model_id);
    if (!preferred) fail('preferred_model_missing');
    if (tierRank[preferred.capability_tier] < tierRank[strategy]) fail('tier_degradation');
  }

  for (const model of catalog.models) {
    const seenFallbacks = new Set();
    for (const fallbackId of model.allowed_fallbacks) {
      if (!models.has(fallbackId)) fail('fallback_model_missing');
      if (fallbackId === model.model_id) fail('fallback_self_reference');
      if (seenFallbacks.has(fallbackId)) fail('duplicate_fallback');
      seenFallbacks.add(fallbackId);
    }
    if (model.certification_status === 'certified' && !certificationIsVerified(model, verifiedCertificationRefs)) {
      fail('certification_reference_unverified');
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(modelId) {
    if (visiting.has(modelId)) fail('fallback_cycle');
    if (visited.has(modelId)) return;
    visiting.add(modelId);
    for (const fallbackId of models.get(modelId).allowed_fallbacks) visit(fallbackId);
    visiting.delete(modelId);
    visited.add(modelId);
  }
  for (const modelId of models.keys()) visit(modelId);
  for (const model of catalog.models) {
    for (const fallbackId of model.allowed_fallbacks) {
      if (tierRank[models.get(fallbackId).capability_tier] < tierRank[model.capability_tier]) {
        fail('tier_degradation');
      }
    }
  }
}

export function resolveCertifiedModels(catalog, strategy, evidence) {
  if (strategy !== 'fast' && strategy !== 'deep') fail('review_model_unavailable');
  try {
    validateCatalogSemantics(catalog, evidence);
  } catch {
    fail('review_model_unavailable');
  }

  const minimumRank = tierRank[strategy];
  const models = new Map(catalog.models.map(model => [model.model_id, model]));
  const primary = models.get(catalog.strategies[strategy].preferred_model_id);
  const eligible = model => model?.certification_status === 'certified' &&
    certificationIsVerified(model, evidence?.verifiedCertificationRefs) &&
    evidence?.cliAvailableModels?.includes(model.model_id) &&
    tierRank[model.capability_tier] >= minimumRank;
  if (!eligible(primary)) fail('review_model_unavailable');

  const fallbacks = primary.allowed_fallbacks.map(modelId => models.get(modelId));
  if (fallbacks.some(model => !eligible(model))) fail('review_model_unavailable');
  return {
    primaryModelId: primary.model_id,
    allowedFallbackModels: fallbacks.map(model => model.model_id),
    capabilityTier: primary.capability_tier,
  };
}
