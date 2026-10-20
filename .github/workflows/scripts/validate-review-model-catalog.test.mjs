import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  resolveCertifiedModels,
  validateCatalogSemantics,
  validateCatalogShape,
} from './validate-review-model-catalog.mjs';

const catalog = JSON.parse(readFileSync(new URL('../config/review-model-catalog.json', import.meta.url)));
const verified = catalog.models.map(model => ({
  certification_reference: `sha256:${'a'.repeat(64)}`,
  model_id: model.model_id,
  capability_tier: model.capability_tier,
  catalog_version: model.catalog_version,
}));
const evidence = { verifiedCertificationRefs: verified, cliAvailableModels: catalog.models.map(model => model.model_id) };
const certifiedCatalog = structuredClone(catalog);
certifiedCatalog.models = certifiedCatalog.models.map(model => ({
  ...model,
  certification_status: 'certified',
  certification_reference: `sha256:${'a'.repeat(64)}`,
}));

test('accepts the R4 pending catalog shape and rejects unknown root/model properties', () => {
  assert.doesNotThrow(() => validateCatalogShape(catalog));
  assert.throws(() => validateCatalogShape({ ...catalog, surprise: true }));
  assert.throws(() => validateCatalogShape({
    ...catalog,
    models: [{ ...catalog.models[0], surprise: true }, catalog.models[1]],
  }));
});

test('rejects duplicate model IDs and model catalog version mismatches', () => {
  assert.throws(() => validateCatalogSemantics({
    ...catalog,
    models: [catalog.models[0], { ...catalog.models[1], model_id: catalog.models[0].model_id }],
  }, evidence), /duplicate_model_id/);
  assert.throws(() => validateCatalogSemantics({
    ...catalog,
    models: [{ ...catalog.models[0], catalog_version: '0.9.0' }, catalog.models[1]],
  }, evidence), /catalog_version_mismatch/);
});

test('rejects fallback self references and cycles', () => {
  const self = structuredClone(catalog);
  self.models[0].allowed_fallbacks = [self.models[0].model_id];
  assert.throws(() => validateCatalogSemantics(self, evidence), /fallback_self_reference/);
  const cycle = structuredClone(catalog);
  cycle.models[1].allowed_fallbacks = [cycle.models[0].model_id];
  assert.throws(() => validateCatalogSemantics(cycle, evidence), /fallback_cycle|tier_degradation/);
});

test('rejects absent preferred and fallback model IDs', () => {
  const preferred = structuredClone(catalog);
  preferred.strategies.fast.preferred_model_id = 'absent';
  assert.throws(() => validateCatalogSemantics(preferred, evidence), /preferred_model_missing/);
  const fallback = structuredClone(catalog);
  fallback.models[0].allowed_fallbacks = ['absent'];
  assert.throws(() => validateCatalogSemantics(fallback, evidence), /fallback_model_missing/);
});

test('refuses pending, suspended, and revoked models as primary or fallback', () => {
  for (const status of ['pending', 'suspended', 'revoked']) {
    const candidate = structuredClone(catalog);
    candidate.strategies.fast.preferred_model_id = candidate.models[1].model_id;
    candidate.models[1].certification_status = status;
    assert.throws(() => resolveCertifiedModels(candidate, 'fast', evidence), /review_model_unavailable/);

    const fallback = structuredClone(certifiedCatalog);
    fallback.models[1].certification_status = status;
    fallback.models[0].allowed_fallbacks = [fallback.models[1].model_id];
    assert.throws(() => resolveCertifiedModels(fallback, 'fast', evidence), /review_model_unavailable/);
  }
});

test('requires trusted evidence bound to the exact certification reference and model metadata', () => {
  const invalidEvidence = { ...evidence, verifiedCertificationRefs: [] };
  assert.throws(() => validateCatalogSemantics(certifiedCatalog, invalidEvidence), /certification_reference_unverified/);
  assert.throws(() => resolveCertifiedModels(certifiedCatalog, 'fast', invalidEvidence), /review_model_unavailable/);
});

test('does not resolve an unavailable deep model or return any model ID', () => {
  assert.throws(() => resolveCertifiedModels(certifiedCatalog, 'deep', {
    ...evidence,
    cliAvailableModels: [catalog.models[0].model_id],
  }), error => error.message.includes('review_model_unavailable') && !error.message.includes(catalog.models[1].model_id));
});

test('requires non-degrading capability tiers and rejects duplicate fallbacks', () => {
  const degrading = structuredClone(certifiedCatalog);
  degrading.strategies.deep.preferred_model_id = degrading.models[0].model_id;
  assert.throws(() => validateCatalogSemantics(degrading, evidence), /tier_degradation/);
  const duplicates = structuredClone(catalog);
  duplicates.models[0].allowed_fallbacks = [catalog.models[1].model_id, catalog.models[1].model_id];
  assert.throws(() => validateCatalogSemantics(duplicates, evidence), /duplicate_fallback/);
});

test('keeps pending models unavailable even when catalog and CLI names match', () => {
  assert.throws(() => resolveCertifiedModels(catalog, 'deep', evidence), error => {
    assert.match(error.message, /review_model_unavailable/);
    assert.doesNotMatch(error.message, /gemini-|claude-/);
    return true;
  });
});
