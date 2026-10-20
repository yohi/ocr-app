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

test('rejects fallback self references', () => {
  const self = structuredClone(catalog);
  self.models[0].allowed_fallbacks = [self.models[0].model_id];
  assert.throws(() => validateCatalogSemantics(self, evidence), /fallback_self_reference/);
});

test('detects a cycle between same-tier models independently of tier degradation', () => {
  const cycle = structuredClone(catalog);
  const deepPreferred = {
    model_id: 'deep-test-model',
    capability_tier: 'deep',
    certification_status: 'pending',
    certification_reference: null,
    allowed_fallbacks: [],
    catalog_version: catalog.catalog_version,
  };
  cycle.models[1].capability_tier = 'fast';
  cycle.models.push(deepPreferred);
  cycle.strategies.deep.preferred_model_id = deepPreferred.model_id;
  cycle.models[0].allowed_fallbacks = [cycle.models[1].model_id];
  cycle.models[1].allowed_fallbacks = [cycle.models[0].model_id];
  assert.throws(() => validateCatalogSemantics(cycle, {
    ...evidence,
    cliAvailableModels: [...evidence.cliAvailableModels, deepPreferred.model_id],
  }), /fallback_cycle/);
});

test('rejects a deep-to-fast fallback independently of fallback cycles', () => {
  const degrading = structuredClone(catalog);
  degrading.strategies.fast.preferred_model_id = degrading.models[1].model_id;
  degrading.strategies.deep.preferred_model_id = degrading.models[0].model_id;
  degrading.models[0].capability_tier = 'deep';
  degrading.models[1].capability_tier = 'fast';
  degrading.models[0].allowed_fallbacks = [degrading.models[1].model_id];
  assert.throws(() => validateCatalogSemantics(degrading, evidence), /tier_degradation/);
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

test('fails closed when any certification evidence binding field mismatches', () => {
  const mismatchCases = [
    ['model_id', { model_id: 'different-model' }],
    ['capability_tier', { capability_tier: 'deep' }],
    ['catalog_version', { catalog_version: '2.0.0' }],
    ['certification_reference', { certification_reference: `sha256:${'b'.repeat(64)}` }],
  ];

  for (const [field, mismatch] of mismatchCases) {
    const mismatchedEvidence = {
      ...evidence,
      verifiedCertificationRefs: evidence.verifiedCertificationRefs.map((reference, index) =>
        index === 0 ? { ...reference, ...mismatch } : reference,
      ),
    };
    assert.throws(() => resolveCertifiedModels(certifiedCatalog, 'fast', mismatchedEvidence), error => {
      assert.equal(error.message, 'review_model_unavailable', field);
      assert.doesNotMatch(error.message, /gemini-|claude-/);
      return true;
    });
  }
});

test('resolves certified primary and fallback models for fast and deep strategies', () => {
  assert.deepEqual(resolveCertifiedModels(certifiedCatalog, 'fast', evidence), {
    primaryModelId: 'gemini-3.8-flash-medium',
    allowedFallbackModels: ['claude-opus-4-6-thinking'],
    capabilityTier: 'fast',
  });
  assert.deepEqual(resolveCertifiedModels(certifiedCatalog, 'deep', evidence), {
    primaryModelId: 'claude-opus-4-6-thinking',
    allowedFallbackModels: [],
    capabilityTier: 'deep',
  });
});

test('accepts the pending example catalog during semantic validation', () => {
  assert.doesNotThrow(() => validateCatalogSemantics(catalog, evidence));
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
