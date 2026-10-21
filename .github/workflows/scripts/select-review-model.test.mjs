import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { selectReviewRoute } from './select-review-model.mjs';

const pendingCatalog = JSON.parse(readFileSync(new URL('../config/review-model-catalog.json', import.meta.url), 'utf8'));
const certifiedCatalog = structuredClone(pendingCatalog);
certifiedCatalog.models = certifiedCatalog.models.map(model => ({
  ...model,
  certification_status: 'certified',
  certification_reference: `sha256:${'a'.repeat(64)}`,
}));

const evidence = {
  verifiedCertificationRefs: certifiedCatalog.models.map(model => ({
    certification_reference: model.certification_reference,
    model_id: model.model_id,
    capability_tier: model.capability_tier,
    catalog_version: model.catalog_version,
  })),
  cliAvailableModels: certifiedCatalog.models.map(model => model.model_id),
};
const certifiedBundle = { catalog: certifiedCatalog, evidence };
const features = { risk_floor: 'fast' };
const runBinding = { workflowRunId: '123', runAttempt: 1, headSha: 'a'.repeat(40), mode: 'enforce' };
const confidentFast = { status: 'decision_available', choice: 'fast', probabilities: { fast: 0.8, deep: 0.2 }, confidence: 0.8 };
const deepResult = { status: 'decision_available', choice: 'deep', probabilities: { fast: 0.2, deep: 0.8 }, confidence: 0.8 };
const select = (overrides = {}) => selectReviewRoute({
  mode: 'enforce', features, decision: confidentFast, certifiedCatalog: certifiedBundle, runBinding,
  ...overrides,
});

test('a deep local risk floor cannot be downgraded by a confident fast decision', () => {
  const result = select({ features: { risk_floor: 'deep' } });
  assert.equal(result.selectedStrategy, 'deep');
  assert.equal(result.selectedReviewModel, certifiedCatalog.strategies.deep.preferred_model_id);
});

test('low choice probability selects deep', () => {
  const result = select({ decision: { ...confidentFast, probabilities: { fast: 0.64, deep: 0.36 } } });
  assert.equal(result.selectedStrategy, 'deep');
});

test('a probability margin below the threshold selects deep', () => {
  const result = select({ decision: { ...confidentFast, probabilities: { fast: 0.57, deep: 0.43 } } });
  assert.equal(result.selectedStrategy, 'deep');
});

test('invalid decision uses the local risk floor', () => {
  const result = select({ features: { risk_floor: 'fast' }, decision: { status: 'invalid_response' } });
  assert.equal(result.selectedStrategy, 'fast');
  assert.equal(result.routeSource, 'deterministic_fallback');
  assert.equal(result.decisionStatus, 'invalid_response');
});

test('HTTP 429 unavailable decision uses the local risk floor without raw error text', () => {
  const result = select({ decision: { status: 'decision_unavailable', reason: '429 private provider response' } });
  assert.equal(result.selectedStrategy, 'fast');
  assert.equal(result.routeSource, 'deterministic_fallback');
  assert.equal(result.decisionStatus, 'unavailable');
  assert.doesNotMatch(JSON.stringify(result), /429|private provider/);
});

test('missing-key decision uses the local risk floor', () => {
  const result = select({ decision: { status: 'decision_unavailable', reason: 'missing_api_key' } });
  assert.equal(result.selectedStrategy, 'fast');
  assert.equal(result.decisionStatus, 'unavailable');
});

test('egress denial retains its decision status while using the local risk floor', () => {
  const result = select({ decision: { status: 'egress_denied' } });
  assert.equal(result.selectedStrategy, 'fast');
  assert.equal(result.decisionStatus, 'egress_denied');
});

test('not-requested decision status is preserved when features skip the Decision request', () => {
  const result = select({ decision: { status: 'not_requested' } });
  assert.equal(result.selectedStrategy, 'fast');
  assert.equal(result.decisionStatus, 'not_requested');
});

test('docs-only local fast floor can select fast', () => {
  const result = select({ features: { risk_floor: 'fast' }, decision: confidentFast });
  assert.equal(result.selectedStrategy, 'fast');
  assert.equal(result.selectedReviewModel, certifiedCatalog.strategies.fast.preferred_model_id);
});

test('enforce rejects uncertified requested deep models without downgrading to fast', () => {
  assert.throws(() => select({
    features: { risk_floor: 'deep' }, decision: deepResult, certifiedCatalog: { catalog: pendingCatalog, evidence },
  }), error => error.message === 'review_model_unavailable');
});

test('enforce rejects the real pending plain catalog without leaking a raw validation error', () => {
  assert.throws(() => select({
    features: { risk_floor: 'deep' }, decision: deepResult, certifiedCatalog: pendingCatalog,
  }), error => error.message === 'review_model_unavailable');
});

test('shadow proposes a strategy with pending catalog but selects no Host model or fallback', () => {
  const result = select({ mode: 'shadow', decision: deepResult, certifiedCatalog: pendingCatalog,
    runBinding: { ...runBinding, mode: 'shadow' } });
  assert.equal(result.selectedStrategy, null);
  assert.equal(result.selectedReviewModel, null);
  assert.deepEqual(result.fallbackModels, []);
  assert.equal(result.proposedStrategy, 'deep');
  assert.equal(result.proposedReviewModel, pendingCatalog.strategies.deep.preferred_model_id);
});

test('enforce returns an explicit empty fallback list when the certified primary has no fallback', () => {
  const result = select({ decision: deepResult });
  assert.deepEqual(result.fallbackModels, []);
  assert.equal(Object.hasOwn(result, 'fallbackModels'), true);
});

test('enforce returns only the certified primary model allowed by its fallback policy', () => {
  const result = select();
  assert.equal(result.selectedReviewModel, certifiedCatalog.strategies.fast.preferred_model_id);
  assert.deepEqual(result.fallbackModels, certifiedCatalog.models[0].allowed_fallbacks);
});

test('no reviewable files returns a not-requested route without selecting a model', () => {
  const result = select({ features: { risk_floor: 'deep', reviewable_file_count: 0 } });
  assert.equal(result.selectedStrategy, null);
  assert.equal(result.proposedStrategy, null);
  assert.equal(result.selectedReviewModel, null);
  assert.equal(result.proposedReviewModel, null);
  assert.deepEqual(result.fallbackModels, []);
  assert.equal(result.routeSource, 'not_requested');
  assert.equal(result.decisionStatus, 'not_requested');
});

test('unknown mode fails closed', () => {
  assert.throws(() => select({ mode: 'observe' }), /routing_mode_invalid/);
});

test('off mode is rejected rather than invoking this workflow resolver', () => {
  assert.throws(() => select({ mode: 'off' }), /routing_disabled/);
});

test('returned route strings reject newline injection and model IDs are bounded', () => {
  const malicious = structuredClone(certifiedCatalog);
  malicious.strategies.fast.preferred_model_id = `model\nGITHUB_OUTPUT=evil`;
  malicious.models[0].model_id = malicious.strategies.fast.preferred_model_id;
  assert.throws(() => select({ certifiedCatalog: { catalog: malicious, evidence } }), error => error.message === 'review_model_unavailable');
});

test('choice probability of 0.65 is sufficient when the margin is clear', () => {
  const result = select({ decision: { ...confidentFast, probabilities: { fast: 0.65, deep: 0.35 } } });
  assert.equal(result.selectedStrategy, 'fast');
});
