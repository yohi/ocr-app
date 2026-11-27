import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  resolveCertifiedModels,
  resolvePinnedModels,
  isPinnedTerminalModelApproved,
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

const pendingCertificationState = models => models.map(model => ({
  ...model,
  certification_status: 'pending',
  certification_reference: null,
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
  const cycle = structuredClone({ ...catalog, models: pendingCertificationState(catalog.models) });
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
  const degrading = structuredClone({ ...catalog, models: pendingCertificationState(catalog.models) });
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
    allowedFallbackModels: [
      'claude-opus-5-5-high',
      'gemini-4-argon-high',
      'claude-sonnet-5-5-high',
    ],
    capabilityTier: 'fast',
  });
  assert.deepEqual(resolveCertifiedModels(certifiedCatalog, 'deep', evidence), {
    primaryModelId: 'claude-opus-5-5-high',
    allowedFallbackModels: [
      'gemini-4-argon-high',
      'claude-sonnet-5-5-high',
      'gpt-oss-120b-medium',
    ],
    capabilityTier: 'deep',
  });
});

test('accepts the pending example catalog during semantic validation', () => {
  assert.doesNotThrow(() => validateCatalogSemantics({ ...catalog, models: pendingCertificationState(catalog.models) }, evidence));
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

test('RED 3-1: rejects a pending model missing from the CLI inventory', () => {
  assert.throws(() => validateCatalogSemantics(catalog, {
    ...evidence,
    cliAvailableModels: [],
  }), /model_unavailable/);
});

test('accepts extra CLI inventory IDs while requiring every catalog model in the inventory', () => {
  const extraInventory = {
    ...evidence,
    cliAvailableModels: [...evidence.cliAvailableModels, 'gemini-3.8-flash-legacy'],
  };
  assert.ok(catalog.models.every(model => extraInventory.cliAvailableModels.includes(model.model_id)));
  assert.doesNotThrow(() => validateCatalogSemantics({ ...catalog, models: pendingCertificationState(catalog.models) }, extraInventory));
});

test('RED 3-1: rejects a root/model catalog_version mismatch', () => {
  const mismatched = structuredClone(catalog);
  const [major, minor, patch] = catalog.catalog_version.split('.').map(Number);
  mismatched.catalog_version = `${major}.${minor}.${patch + 1}`;
  assert.throws(() => validateCatalogSemantics(mismatched, evidence), /catalog_version_mismatch/);
});

test('RED 3-1: rejects preferred/fallback references to a model with a mismatched catalog_version', () => {
  const oldRef = structuredClone(catalog);
  oldRef.models[1].catalog_version = '0.9.0';
  assert.throws(() => validateCatalogSemantics(oldRef, evidence), /catalog_version_mismatch/);
});

test('off-mode pinned resolver selects only allowlisted models from exact CLI snapshot', () => {
  const index = { cli_inventory: { approval_ref: 'OWNER-CLI' },
    certifications: catalog.models.filter(model => model.certification_reference !== null).map(model => ({
      sha256: model.certification_reference.slice(7), approval_ref: `OWNER-${model.model_id}`,
    })) };
  const available = { cliAvailableModels: catalog.models.map(model => model.model_id),
    index, revokedRefs: [] };
  assert.deepEqual(resolvePinnedModels(catalog, 'deep', available), {
    primaryModelId: 'claude-opus-5-5-high',
    allowedFallbackModels: ['gemini-4-argon-high', 'claude-sonnet-5-5-high'],
    capabilityTier: 'deep',
  });
  for (const missing of ['claude-opus-5-5-high', 'gemini-4-argon-high']) {
    assert.throws(() => resolvePinnedModels(catalog, 'deep', {
      cliAvailableModels: available.cliAvailableModels.filter(model => model !== missing),
    }), /review_model_unavailable/);
  }
  const pendingPrimary = structuredClone(catalog);
  pendingPrimary.models.find(model => model.model_id === 'claude-opus-5-5-high').certification_status = 'pending';
  pendingPrimary.models.find(model => model.model_id === 'claude-opus-5-5-high').certification_reference = null;
  assert.throws(() => resolvePinnedModels(pendingPrimary, 'deep', available), /review_model_unavailable/);
  const pendingFallback = structuredClone(catalog);
  pendingFallback.models.find(model => model.model_id === 'gemini-4-argon-high').certification_status = 'pending';
  pendingFallback.models.find(model => model.model_id === 'gemini-4-argon-high').certification_reference = null;
  assert.throws(() => resolvePinnedModels(pendingFallback, 'deep', available), /review_model_unavailable/);
  assert.throws(() => resolvePinnedModels(catalog, 'invalid', available), /review_model_unavailable/);
  assert.throws(() => resolvePinnedModels(catalog, 'deep', {
    ...available, revokedRefs: ['OWNER-CLI'],
  }), /review_model_unavailable/);
  assert.throws(() => resolvePinnedModels(catalog, 'deep', {
    ...available, revokedRefs: ['OWNER-claude-opus-5-5-high'],
  }), /review_model_unavailable/);
  assert.throws(() => resolvePinnedModels(catalog, 'deep', { cliAvailableModels: ['claude-opus-5-5-high'] }), /review_model_unavailable/);
});

test('terminal OCR_LLM_MODEL can differ from fast preferred but must be pinned and unrevoked', () => {
  const terminal = 'gpt-oss-120b-medium';
  assert.notEqual(terminal, catalog.strategies.fast.preferred_model_id);
  const index = { cli_inventory: { approval_ref: 'OWNER-CLI' },
    certifications: catalog.models.filter(model => model.certification_reference !== null).map(model => ({
      sha256: model.certification_reference.slice(7), approval_ref: `OWNER-${model.model_id}`,
    })) };
  const pinned = { cliAvailableModels: catalog.models.map(model => model.model_id),
    index, revokedRefs: [] };
  assert.equal(isPinnedTerminalModelApproved(catalog, terminal, pinned), true);
  assert.equal(isPinnedTerminalModelApproved(catalog, 'not-in-catalog', pinned), false);
  assert.equal(isPinnedTerminalModelApproved(catalog, terminal, {
    ...pinned, cliAvailableModels: pinned.cliAvailableModels.filter(id => id !== terminal),
  }), false);
  assert.equal(isPinnedTerminalModelApproved(catalog, terminal, {
    ...pinned, revokedRefs: [`OWNER-${terminal}`],
  }), false);
  assert.equal(isPinnedTerminalModelApproved(catalog, terminal, {
    ...pinned, revokedRefs: ['OWNER-CLI'],
  }), false);
  const tampered = structuredClone(catalog);
  tampered.models.find(model => model.model_id === terminal).certification_status = 'pending';
  assert.equal(isPinnedTerminalModelApproved(tampered, terminal, pinned), false);
  assert.equal(isPinnedTerminalModelApproved(catalog, terminal, { ...pinned, index: null }), false);
});


test('Hydrogen High terminal approval binds the successful strict OAuth smoke to the exact pinned CLI', () => {
  const readConfig = name => readFileSync(new URL('../config/' + name, import.meta.url));
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const model = 'gemini-4-hydrogen-high';
  const capabilityBytes = readConfig('routing-evidence/pro-capability-gemini-4-hydrogen-high-20261113.json');
  const certificateBytes = readConfig('routing-evidence/pro-model-certification-gemini-4-hydrogen-high-20261113.json');
  const inventoryBytes = readConfig('routing-evidence/pro-cli-inventory-20261113.json');
  const index = JSON.parse(readConfig('review-certification-index.json'));
  const registry = JSON.parse(readConfig('routing-authorization.json'));
  const capability = JSON.parse(capabilityBytes);
  const certificate = JSON.parse(certificateBytes);
  const inventory = JSON.parse(inventoryBytes);
  const entry = catalog.models.find(item => item.model_id === model);
  const certificateHash = digest(certificateBytes);
  const capabilityHash = digest(capabilityBytes);
  const inventoryHash = digest(inventoryBytes);
  const reference = index.certifications.filter(item => item.sha256 === certificateHash);
  assert.equal(reference.length, 1);
  assert.equal(reference[0].approval_ref, 'OWNER-MODEL-CERT-GEMINI-4-HYDROGEN-HIGH-20261113');
  assert.equal(entry.capability_tier, 'deep');
  assert.equal(entry.certification_status, 'certified');
  assert.equal(entry.certification_reference, 'sha256:' + certificateHash);
  assert.equal(certificate.model_id, model);
  assert.equal(certificate.capability_tier, entry.capability_tier);
  assert.equal(certificate.catalog_version, catalog.catalog_version);
  assert.equal(certificate.capability_evidence_sha256, capabilityHash);
  assert.equal(certificate.cli_evidence_sha256, inventoryHash);
  assert.equal(index.cli_inventory.sha256, inventoryHash);
  assert.equal(inventory.cli_binary_sha256,
    '9db59b6371107b939befa9c507c0a24989fda974e75d81d8529f3689ef7322e5');
  assert.ok(inventory.models.includes(model));
  assert.equal(capability.model_id, model);
  assert.equal(capability.capability_tier, 'deep');
  assert.match(capability.quality_basis.join(' '), /43423036181/);
  assert.match(capability.quality_basis.join(' '), /toolPermission strict/);
  assert.match(capability.quality_basis.join(' '), /does not establish real code-review quality/);
  const expectedApprovals = [
    [index.cli_inventory.approval_ref, 'cli_inventory', inventoryHash],
    ['OWNER-CAPABILITY-GEMINI-4-HYDROGEN-HIGH-20261113', 'model', capabilityHash],
    [reference[0].approval_ref, 'model', certificateHash],
  ];
  for (const [ref, kind, hash] of expectedApprovals) {
    const approvals = registry.approvals.filter(approval => approval.ref === ref);
    assert.equal(approvals.length, 1, ref);
    assert.equal(approvals[0].kind, kind);
    assert.equal(approvals[0].subject_sha256, 'sha256:' + hash);
    assert.equal(approvals[0].repo_id, 1318645969);
    assert.equal(approvals[0].full_name, 'yohi/ocr-app');
    assert.equal(approvals[0].issued_at, certificate.issued_at);
    assert.equal(approvals[0].expires_at, certificate.expires_at);
    assert.ok(!registry.revoked_refs.includes(ref));
  }
  const pinned = { cliAvailableModels: inventory.models, index, revokedRefs: registry.revoked_refs };
  assert.equal(isPinnedTerminalModelApproved(catalog, model, pinned), true);
  assert.equal(isPinnedTerminalModelApproved(catalog, model,
    { ...pinned, revokedRefs: [reference[0].approval_ref] }), false);
  assert.equal(isPinnedTerminalModelApproved(catalog, model,
    { ...pinned, cliAvailableModels: inventory.models.filter(item => item !== model) }), false);
  assert.equal(isPinnedTerminalModelApproved(catalog, model,
    { ...pinned, revokedRefs: [index.cli_inventory.approval_ref] }), false);
});
