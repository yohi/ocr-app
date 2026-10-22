import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { hashRoutingSourceManifest } from './routing-authorization.mjs';
import {
  createRunBindingFromEnv, loadRouteFromFile, readSelectedReviewRoute,
  serializeSelectedReviewRoute, writeSelectedReviewRoute, prepareRoutingStep,
} from './prepare-review-routing.mjs';

const env = mode => ({ GITHUB_RUN_ID: '9007199254740993', GITHUB_RUN_ATTEMPT: '2', COMMIT_SHA: 'a'.repeat(40), DECISION_ROUTING_MODE: mode,
  GITHUB_REPOSITORY: 'central-org/central-repo' });
const binding = () => createRunBindingFromEnv(env('shadow'));
const preparation = () => ({
  route: { status: 'degraded', reviewableCount: 2, selectedStrategy: null, proposedStrategy: 'deep', selectedReviewModel: null, fallbackModels: [], routeSource: 'deterministic_fallback', decisionStatus: 'unavailable' },
  runBinding: binding(),
  policyVersions: { policyVersion: '1.0.0', modelCatalogVersion: '1.2.0' },
});
const route = () => serializeSelectedReviewRoute(preparation());
const hash = value => createHash('sha256').update(value).digest('hex');
const riskPolicyFixture = JSON.parse(readFileSync(new URL('../config/review-risk-policy.json', import.meta.url), 'utf8'));
const catalogFixture = JSON.parse(readFileSync(new URL('../config/review-model-catalog.json', import.meta.url), 'utf8'));
const egressPolicyFixture = JSON.parse(readFileSync(new URL('../config/decision-egress-policy.json', import.meta.url), 'utf8'));
const allowedEgressPolicyFixture = { schema_version: '1', destination: 'openrouter-decisions', policy_version: '1',
  approval_reference_format: 'OWNER-<approval-id>', allowed_repositories: [{ id: 1, full_name: 'owner/repo', approval_ref: 'OWNER-TEST' }] };
const egressPolicyFs = overrides => ({ ...fs, ...overrides,
  readFileSync(path, ...args) {
    if (String(path).endsWith('decision-egress-policy.json')) return JSON.stringify({ schema_version: '1', destination: 'openrouter-decisions',
      policy_version: '1', approval_reference_format: 'OWNER-<approval-id>',
      allowed_repositories: [{ id: 1, full_name: 'owner/repo', approval_ref: 'OWNER-TEST' }] });
    return fs.readFileSync(path, ...args);
  },
});
function trustedInputs(mode, digests = {}) {
  const policySha256 = digests.policySha256 ?? `sha256:${'b'.repeat(64)}`;
  const catalogSha256 = digests.catalogSha256 ?? `sha256:${'c'.repeat(64)}`;
  const sourceManifestSha256 = digests.sourceManifestSha256 ?? `sha256:${'d'.repeat(64)}`;
  const kinds = ['owner_operation', 'security', 'audit_operation', ...(mode === 'enforce' ? ['g1', 'g2', 'g3', 'g4'] : ['g1'])];
  const operationalDossiers = {};
  const approvals = kinds.map((kind, i) => {
    const ref = `OWNER-TASK-${i}`;
    const dossier = { schema_version: '1', ref, kind, issuer: 'owner', owner_decision: 'approve', repo_id: 1,
      full_name: 'owner/repo', allowed_modes: ['shadow', 'enforce'], allowed_effects: ['routing'],
      source_manifest_sha256: sourceManifestSha256, policy_sha256: policySha256, catalog_sha256: catalogSha256,
      issued_at: '2025-01-01T00:00:00.000Z', expires_at: '2027-01-01T00:00:00.000Z', revocation_ref: ref };
    const subject_sha256 = kind === 'owner_operation' || kind === 'security' || kind === 'audit_operation'
      ? `sha256:${hash(JSON.stringify(dossier))}` : sourceManifestSha256;
    if (kind === 'owner_operation' || kind === 'security' || kind === 'audit_operation') operationalDossiers[ref] = Buffer.from(JSON.stringify(dossier));
    return { ref, kind, repo_id: 1, full_name: 'owner/repo', subject_sha256,
      issued_at: '2025-01-01T00:00:00.000Z', expires_at: '2027-01-01T00:00:00.000Z' };
  });
  return { policySha256, catalogSha256, sourceManifestSha256, operationalDossiers,
    riskPolicy: riskPolicyFixture, egressPolicy: egressPolicyFixture, catalog: catalogFixture, index: {},
    readCliIdentity: async () => ({ binarySha256: 'e'.repeat(64) }),
    readEvidence: () => { throw new Error('unexpected evidence read'); },
    registry: { schema_version: '1', approvals, revoked_refs: [], activations: [{ repo_id: 1,
      full_name: 'owner/repo', mode, issued_at: '2025-01-01T00:00:00.000Z', expires_at: '2027-01-01T00:00:00.000Z',
      policy_sha256: policySha256, catalog_sha256: catalogSha256, approval_refs: approvals.map(item => item.ref) }] } };
}

function certificationFixture(digests) {
  const trust = trustedInputs('enforce', digests);
  trust.egressPolicy = allowedEgressPolicyFixture;
  const binary = Buffer.from('test-cli-binary');
  const evidence = new Map();
  const now = '2026-01-01T00:00:00.000Z';
  const expires = '2027-01-01T00:00:00.000Z';
  const models = [
    { model_id: 'certified-primary', capability_tier: 'deep', certification_status: 'certified', certification_reference: null, allowed_fallbacks: ['certified-fallback'], catalog_version: '2.0.0' },
    { model_id: 'certified-fallback', capability_tier: 'deep', certification_status: 'certified', certification_reference: null, allowed_fallbacks: [], catalog_version: '2.0.0' },
  ];
  const catalog = { schema_version: '1', catalog_version: '2.0.0', models,
    strategies: { fast: { preferred_model_id: 'certified-fallback' }, deep: { preferred_model_id: 'certified-primary' } }, unknown_risk_strategy: 'deep' };
  const certifications = models.map((model, index) => {
    const capabilityBytes = Buffer.from(`capability-${index}`);
    const certification = { schema_version: '1', model_id: model.model_id, capability_tier: model.capability_tier,
      catalog_version: catalog.catalog_version, issued_at: now, expires_at: expires,
      capability_evidence_sha256: hash(capabilityBytes), cli_evidence_sha256: hash(Buffer.from(`cli-${index}`)) };
    const bytes = Buffer.from(JSON.stringify(certification));
    const ref = `OWNER-CERT-${index}`;
    const capabilityRef = `OWNER-CAP-${index}`;
    const approval = (approvalRef, kind, digest) => ({ ref: approvalRef, kind, repo_id: 1, full_name: 'owner/repo',
      subject_sha256: `sha256:${digest}`, issued_at: now, expires_at: expires });
    trust.registry.approvals.push(approval(ref, 'model', hash(bytes)), approval(capabilityRef, 'model', hash(capabilityBytes)));
    evidence.set(`cert-${index}.json`, bytes);
    evidence.set(`capability-${index}.bin`, capabilityBytes);
    model.certification_reference = `sha256:${hash(bytes)}`;
    return { path: `cert-${index}.json`, sha256: hash(bytes), approval_ref: ref };
  });
  const inventory = { schema_version: '1', cli_version: '1.0.0', cli_binary_sha256: hash(binary),
    models: models.map(model => model.model_id), observed_at: now, expires_at: expires };
  const inventoryBytes = Buffer.from(JSON.stringify(inventory));
  evidence.set('inventory.json', inventoryBytes);
  trust.registry.approvals.push({ ref: 'OWNER-CLI', kind: 'cli_inventory', repo_id: 1, full_name: 'owner/repo',
    subject_sha256: `sha256:${hash(inventoryBytes)}`, issued_at: now, expires_at: expires });
  trust.index = { schema_version: '1', certifications,
    cli_inventory: { path: 'inventory.json', sha256: hash(inventoryBytes), approval_ref: 'OWNER-CLI' } };
  trust.catalog = catalog;
  trust.readEvidence = path => {
    const bytes = evidence.get(path);
    if (!bytes) throw new Error('missing evidence');
    return bytes;
  };
  trust.fetchCurrentAuthorization = async () => ({ registry: trust.registry, operationalDossiers: trust.operationalDossiers });
  return { trust, binary, now, evidence };
}

const CENTRAL_MANIFEST_PATHS = [
  '.github/workflows/ocr-engine.yml', '.github/workflows/package.json', '.github/workflows/package-lock.json',
  '.github/workflows/config/review-risk-policy.json', '.github/workflows/config/decision-egress-policy.json',
  '.github/workflows/config/review-model-catalog.json', '.github/workflows/config/review-model-catalog.schema.json',
];
function createCentralCheckout(root, registry, overrides = {}) {
  const configDir = join(root, '.github/workflows/config');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(join(configDir, 'routing-evidence'), { recursive: true });
  const centralFiles = {
    '.github/workflows/ocr-engine.yml': 'name: central\n',
    '.github/workflows/package.json': '{}\n',
    '.github/workflows/package-lock.json': '{}\n',
    '.github/workflows/config/review-risk-policy.json': JSON.stringify(overrides.riskPolicy ?? riskPolicyFixture),
    '.github/workflows/config/decision-egress-policy.json': JSON.stringify(overrides.egressPolicy ?? egressPolicyFixture),
    '.github/workflows/config/review-model-catalog.json': JSON.stringify(overrides.catalog ?? catalogFixture),
    '.github/workflows/config/review-model-catalog.schema.json': '{}\n',
    '.github/workflows/config/routing-authorization.json': JSON.stringify(registry),
    '.github/workflows/config/review-certification-index.json': JSON.stringify(overrides.index ?? { schema_version: '1', certifications: [], cli_inventory: {} }),
  };
  for (const [path, contents] of Object.entries(centralFiles)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, contents);
  }
}

test('run binding keeps canonical run ID and freezes runner identity', () => {
  const binding = createRunBindingFromEnv(env('shadow'));
  assert.equal(binding.workflowRunId, '9007199254740993');
  assert.equal(binding.runAttempt, 2);
  assert.equal(Object.isFrozen(binding), true);
});

test('route serializer emits the exact 15-key contract and writer seals the standalone route privately', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-routing-'));
  try {
    const serialized = route();
    assert.deepEqual(Object.keys(serialized), ['schema_version', 'workflow_run_id', 'run_attempt', 'head_sha', 'effective_mode', 'status', 'reviewable_file_count', 'proposed_strategy', 'selected_strategy', 'selected_model_id', 'fallback_models', 'route_source', 'decision_status', 'policy_version', 'model_catalog_version']);
    const path = join(runTemp, 'ocr-selected-route.json');
    writeSelectedReviewRoute({ runTemp, result: preparation() });
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(readSelectedReviewRoute({ runBinding: binding(), runTemp }), serialized);
    assert.throws(() => writeSelectedReviewRoute({ runTemp, result: preparation() }));
    const invalid = { ...route(), extra: 'no' };
    assert.throws(() => loadRouteFromFile(path, { readFileSync: () => JSON.stringify(invalid) }));
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('enforce route carries only selected certified execution fields', () => {
  const routeInput = {
    route: { status: 'prepared', reviewableCount: 1, selectedStrategy: 'deep', proposedStrategy: 'deep', selectedReviewModel: 'model/deep', fallbackModels: ['model/deep-fallback'], routeSource: 'deterministic_fallback', decisionStatus: 'unavailable' },
    runBinding: createRunBindingFromEnv(env('enforce')),
    policyVersions: { policyVersion: '1.0.0', modelCatalogVersion: '1.2.0' },
  };
  const serialized = serializeSelectedReviewRoute(routeInput);
  assert.equal(serialized.selected_model_id, 'model/deep');
  assert.deepEqual(serialized.fallback_models, ['model/deep-fallback']);
  assert.equal(Object.hasOwn(serialized, 'decision_latency_ms'), false);
  assert.equal(Object.hasOwn(serialized, 'selected_review_model'), false);
});

test('enforce route rejects a missing model when reviewable files exist', () => {
  const routeInput = {
    route: { status: 'degraded', reviewableCount: 1, selectedStrategy: 'deep', proposedStrategy: 'deep', selectedReviewModel: null, fallbackModels: [], routeSource: 'deterministic_fallback', decisionStatus: 'unavailable' },
    runBinding: createRunBindingFromEnv(env('enforce')),
    policyVersions: { policyVersion: '1.0.0', modelCatalogVersion: '1.2.0' },
  };

  assert.throws(() => serializeSelectedReviewRoute(routeInput), { message: 'ROUTE_SCHEMA_INVALID' });
});

test('saved route binding mismatch fails before a caller can spawn Host', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-routing-mismatch-'));
  let spawnCount = 0;
  try {
    writeSelectedReviewRoute({ runTemp, result: preparation() });
    assert.throws(() => {
      readSelectedReviewRoute({ runBinding: createRunBindingFromEnv({ ...env('shadow'), GITHUB_RUN_ATTEMPT: '3' }), runTemp });
      spawnCount++;
    }, { message: 'RUN_BINDING_MISMATCH' });
    assert.equal(spawnCount, 0);
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('off mode performs no routing I/O or network request', async () => {
  let networkCalls = 0;
  const result = await prepareRoutingStep({ runBinding: null, env: env('off'), fetchImpl: async () => { networkCalls++; } });
  assert.deepEqual(result, { route: null, decisionRecord: null, egressStatus: 'not_checked' });
  assert.equal(networkCalls, 0);
});

for (const mode of ['shadow', 'enforce']) {
  test(`${mode} prepares a run-bound route and decision without a Decision API call when nothing is reviewable`, async () => {
    const runTemp = mkdtempSync(join(tmpdir(), `ocr-routing-${mode}-`));
    let networkCalls = 0;
    let evidenceReads = 0;
    let cliLookups = 0;
    let identityGets = 0;
    try {
      const environment = { ...env(mode), RUNNER_TEMP: runTemp, OCR_PREVIEW_PATH: join(runTemp, 'preview.json'), BASE_REF: 'main', TARGET_REPO: 'owner/repo', GITHUB_TOKEN: 'test-token' };
      writeFileSync(environment.OCR_PREVIEW_PATH, JSON.stringify({ reviewable_files: [] }));
      const result = await prepareRoutingStep({
        env: environment,
        trustedInputs: { ...trustedInputs(mode), readEvidence: () => { evidenceReads++; throw new Error('unexpected evidence read'); } },
        now: () => '2026-01-01T00:00:00.000Z',
        readCliIdentity: () => { cliLookups++; throw new Error('unexpected CLI lookup'); },
        fetchRepoIdentity: async () => { identityGets++; return { id: 1, full_name: 'owner/repo' }; },
        fetchImpl: async (_url, options) => {
          networkCalls++;
          assert.equal(options.method, 'GET');
          return { ok: true, json: async () => ({ id: 1, full_name: 'owner/repo', private: true, visibility: 'private' }) };
        },
        runGit: async (_command, args) => {
          if (args[0] === 'config') return Buffer.from('https://github.com/owner/repo.git\n');
          if (args[0] === 'rev-parse') return Buffer.from(`${'a'.repeat(40)}\n`);
          if (args[0] === 'merge-base') return Buffer.from(`${'b'.repeat(40)}\n`);
          return Buffer.alloc(0);
        },
      });
      assert.equal(networkCalls, 1);
      assert.equal(evidenceReads, 0);
      assert.equal(cliLookups, 0);
      assert.equal(identityGets, 2);
      assert.equal(result.route.decision_status, 'not_requested');
      assert.equal(result.decisionRecord.effective_mode, mode);
      assert.equal(existsSync(join(runTemp, 'ocr-selected-route.json')), true);
      assert.equal(existsSync(join(runTemp, 'ocr-routing', 'decision.json')), true);
      assert.equal(statSync(join(runTemp, 'ocr-selected-route.json')).mode & 0o777, 0o600);
      assert.equal(statSync(join(runTemp, 'ocr-routing', 'decision.json')).mode & 0o777, 0o600);
      assert.equal(JSON.parse(readFileSync(join(runTemp, 'ocr-routing-state.json'), 'utf8')).owner_approval_ref, null);
    } finally { rmSync(runTemp, { recursive: true, force: true }); }
  });
}

test('checkout identity is independent of matching dispatch and CHECKOUT_REPO values', async () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-routing-checkout-mismatch-'));
  let decisionPosts = 0;
  try {
    const environment = { ...env('shadow'), RUNNER_TEMP: runTemp, OCR_PREVIEW_PATH: join(runTemp, 'preview.json'), BASE_REF: 'main', TARGET_REPO: 'owner/repo', CHECKOUT_REPO: 'https://github.com/owner/repo.git', GITHUB_TOKEN: 'test-token' };
    writeFileSync(environment.OCR_PREVIEW_PATH, JSON.stringify({ reviewable_files: [] }));
    await assert.rejects(prepareRoutingStep({
      env: environment,
      trustedInputs: trustedInputs('shadow'),
      now: () => '2026-01-01T00:00:00.000Z',
      fetchRepoIdentity: async () => ({ id: 1, full_name: 'owner/repo' }),
      fetchImpl: async (_url, options) => { if (options.method === 'POST') decisionPosts++; return { ok: true, json: async () => ({ id: 1, full_name: 'owner/repo', private: true, visibility: 'private' }) }; },
      runGit: async (_command, args) => {
        if (args[0] === 'config') return Buffer.from('https://github.com/other/repo.git\n');
        if (args[0] === 'rev-parse') return Buffer.from(`${'a'.repeat(40)}\n`);
        if (args[0] === 'merge-base') return Buffer.from(`${'b'.repeat(40)}\n`);
        return Buffer.alloc(0);
      },
    }), { message: 'CHECKOUT_IDENTITY_MISMATCH' });
    assert.equal(decisionPosts, 0);
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('denied startup aborts before routing writes, Decision POST, or model evidence reads', async () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-routing-denied-'));
  const counters = { decisionPosts: 0, routingWrites: 0, modelEvidenceReads: 0 };
  const environment = { ...env('enforce'), RUNNER_TEMP: runTemp, OCR_PREVIEW_PATH: join(runTemp, 'preview.json'),
    BASE_REF: 'main', TARGET_REPO: 'owner/repo', GITHUB_TOKEN: 'test-token' };
  try {
    writeFileSync(environment.OCR_PREVIEW_PATH, JSON.stringify({ reviewable_files: [{ path: 'src/example.js' }] }));
    await assert.rejects(prepareRoutingStep({ env: environment,
      trustedInputs: { ...trustedInputs('enforce'), registry: {} }, now: () => '2026-01-01T00:00:00.000Z',
      fetchRepoIdentity: async () => ({ id: 1, full_name: 'owner/repo' }),
      readEvidence: () => { counters.modelEvidenceReads++; throw new Error('unexpected evidence read'); },
      readCliIdentity: () => { throw new Error('unexpected CLI lookup'); },
      fetchImpl: async (_url, options) => { if (options.method === 'POST') counters.decisionPosts++; return { ok: true, json: async () => ({ id: 1, full_name: 'owner/repo' }) }; },
      fs: { readFileSync, writeFileSync: (...args) => { counters.routingWrites++; return writeFileSync(...args); },
        chmodSync: (...args) => { counters.routingWrites++; return chmodSync(...args); } },
      runGit: async (_command, args) => args[0] === 'config' ? 'https://github.com/owner/repo.git\n' : `${'a'.repeat(40)}\n`,
    }), { code: 'ROUTING_ACTIVATION_DENIED' });
    assert.deepEqual(counters, { decisionPosts: 0, routingWrites: 0, modelEvidenceReads: 0 });
    assert.deepEqual(readdirSync(runTemp), ['preview.json']);
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('production trusted-input defaults deny cleanly when the central registry has no activation', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'ocr-routing-default-deny-'));
  const oldCwd = process.cwd();
  const selfRepo = join(workspace, 'self-repo');
  createCentralCheckout(selfRepo, { schema_version: '1', approvals: [], activations: [], revoked_refs: [] });
  const runTemp = join(workspace, 'runner-temp');
  mkdirSync(runTemp);
  const environment = { ...env('shadow'), RUNNER_TEMP: runTemp, OCR_PREVIEW_PATH: join(runTemp, 'preview.json'),
    BASE_REF: 'main', TARGET_REPO: 'owner/repo', GITHUB_TOKEN: 'test-token', SELF_REPO_PATH: 'self-repo' };
  writeFileSync(environment.OCR_PREVIEW_PATH, JSON.stringify({ reviewable_files: [] }));
  try {
    process.chdir(workspace);
    await assert.rejects(prepareRoutingStep({ env: environment,
      now: () => '2026-01-01T00:00:00.000Z', fetchRepoIdentity: async () => ({ id: 1, full_name: 'owner/repo' }),
      fetchCurrentAuthorization: async () => ({ registry: { schema_version: '1', approvals: [], activations: [], revoked_refs: [] }, operationalDossiers: {} }),
      listTrackedPaths: () => CENTRAL_MANIFEST_PATHS }),
    { code: 'ROUTING_ACTIVATION_DENIED' });
  } finally { process.chdir(oldCwd); rmSync(workspace, { recursive: true, force: true }); }
});

test('default path denies central authority fetch failure even with a populated pinned registry', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'ocr-routing-authority-denied-'));
  const oldCwd = process.cwd();
  const selfRepo = join(workspace, 'self-repo');
  createCentralCheckout(selfRepo, { schema_version: '1', approvals: [{ ref: 'OWNER-PINNED' }], activations: [], revoked_refs: [] });
  const runTemp = join(workspace, 'runner-temp');
  mkdirSync(runTemp);
  const environment = { ...env('shadow'), RUNNER_TEMP: runTemp, OCR_PREVIEW_PATH: join(runTemp, 'preview.json'),
    BASE_REF: 'main', TARGET_REPO: 'owner/repo', GITHUB_TOKEN: 'target-app-token', CENTRAL_GITHUB_TOKEN: 'central-token', SELF_REPO_PATH: 'self-repo' };
  writeFileSync(environment.OCR_PREVIEW_PATH, JSON.stringify({ reviewable_files: [] }));
  let centralToken;
  const identityTokens = new Map();
  try {
    process.chdir(workspace);
    await assert.rejects(prepareRoutingStep({ env: environment,
      now: () => '2026-01-01T00:00:00.000Z',
      fetchCurrentAuthorization: async options => {
        centralToken = options.token;
        assert.equal(options.centralRepoId, 2);
        assert.equal(options.centralRepoFullName, 'central-org/central-repo');
        return { reason: 'ROUTING_AUTHORITY_UNAVAILABLE' };
      },
      fetchImpl: async (url, options) => {
        const fullName = decodeURIComponent(url.slice('https://api.github.com/repos/'.length));
        identityTokens.set(fullName, options.headers.Authorization);
        return { ok: true, json: async () => ({ id: fullName === 'owner/repo' ? 1 : 2, full_name: fullName }) };
      },
      listTrackedPaths: () => CENTRAL_MANIFEST_PATHS }), { code: 'ROUTING_ACTIVATION_DENIED' });
    assert.equal(centralToken, 'central-token');
    assert.equal(identityTokens.get('owner/repo'), 'Bearer target-app-token');
    assert.equal(identityTokens.get('central-org/central-repo'), 'Bearer central-token');
  } finally { process.chdir(oldCwd); rmSync(workspace, { recursive: true, force: true }); }
});

test('enforce preparation uses a verified certification bundle end to end', async () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-routing-certified-'));
  const fixture = certificationFixture();
  const environment = { ...env('enforce'), RUNNER_TEMP: runTemp, OCR_PREVIEW_PATH: join(runTemp, 'preview.json'),
    BASE_REF: 'main', TARGET_REPO: 'owner/repo', GITHUB_TOKEN: 'test-token', OPENROUTER_API_KEY: 'test-key' };
  writeFileSync(environment.OCR_PREVIEW_PATH, JSON.stringify({ reviewable_files: [{ path: 'src/example.js' }] }));
  const sha = 'a'.repeat(40);
  const oldSha = 'b'.repeat(40);
  let contextWrites = 0;
  const fileSystem = { readFileSync, lstatSync, linkSync, unlinkSync,
    writeFileSync: (path, ...args) => { if (String(path).includes('routing-execution-context')) contextWrites++; return writeFileSync(path, ...args); },
    chmodSync };
  try {
    const result = await prepareRoutingStep({ env: environment, fs: egressPolicyFs(fileSystem), trustedInputs: fixture.trust,
      now: () => fixture.now, fetchRepoIdentity: async () => ({ id: 1, full_name: 'owner/repo' }),
      readCliIdentity: async () => ({ binarySha256: hash(fixture.binary) }),
      fetchImpl: async (_url, options) => options.method === 'POST'
        ? { ok: false, status: 503 }
        : { ok: true, json: async () => ({ id: 1, full_name: 'owner/repo', private: false, visibility: 'public' }) },
      runGit: async (_command, args) => {
        if (args[0] === 'config') return Buffer.from('https://github.com/owner/repo.git\n');
        if (args[0] === 'rev-parse') return Buffer.from(`${sha}\n`);
        if (args[0] === 'merge-base') return Buffer.from(`${oldSha}\n`);
        if (args.includes('--name-status')) return Buffer.from('M\0src/example.js\0');
        if (args.includes('--numstat')) return Buffer.from('1\t0\tsrc/example.js\0');
        if (args.includes('--raw')) return Buffer.from(`:100644 100644 ${oldSha} ${sha} M\0src/example.js\0`);
        return Buffer.alloc(0);
      },
    });
    assert.equal(result.route.selected_model_id, 'certified-primary');
    assert.deepEqual(result.route.fallback_models, ['certified-fallback']);
    assert.equal(contextWrites, 1);
    assert.equal(existsSync(join(runTemp, 'ocr-routing-execution-context.json')), true);
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('default enforce preparation loads and verifies evidence from central config routing-evidence', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'ocr-routing-default-evidence-'));
  const oldCwd = process.cwd();
  const selfRepo = join(workspace, 'self-repo');
  const runTemp = join(workspace, 'runner-temp');
  mkdirSync(runTemp);
  const fixture = certificationFixture();
  const now = fixture.now;
  const pinnedRegistry = { schema_version: '1', approvals: [], activations: [], revoked_refs: [] };
  createCentralCheckout(selfRepo, pinnedRegistry, { catalog: fixture.trust.catalog, index: fixture.trust.index,
    egressPolicy: allowedEgressPolicyFixture });
  const configRoot = join(selfRepo, '.github/workflows/config');
  const policySha256 = `sha256:${hash(readFileSync(join(configRoot, 'review-risk-policy.json')))}`;
  const catalogSha256 = `sha256:${hash(readFileSync(join(configRoot, 'review-model-catalog.json')))}`;
  const sourceManifestSha256 = hashRoutingSourceManifest({ trustedRoot: selfRepo,
    readFile: (path, root) => readFileSync(join(root, path)), listTrackedPaths: () => CENTRAL_MANIFEST_PATHS });
  const startup = trustedInputs('enforce', { policySha256, catalogSha256, sourceManifestSha256 });
  const modelApprovals = fixture.trust.registry.approvals.slice(7);
  fixture.trust.registry.approvals = [...startup.registry.approvals, ...modelApprovals];
  fixture.trust.registry.activations = startup.registry.activations;
  fixture.trust.operationalDossiers = startup.operationalDossiers;
  writeFileSync(join(configRoot, 'routing-authorization.json'), JSON.stringify(fixture.trust.registry));
  const evidenceRoot = join(configRoot, 'routing-evidence');
  for (const [path, bytes] of fixture.evidence) writeFileSync(join(evidenceRoot, path), bytes);
  const environment = { ...env('enforce'), GITHUB_REPOSITORY: 'owner/repo', SELF_REPO_PATH: 'self-repo',
    RUNNER_TEMP: runTemp, OCR_PREVIEW_PATH: join(runTemp, 'preview.json'), BASE_REF: 'main', TARGET_REPO: 'owner/repo',
    GITHUB_TOKEN: 'target-app-token', CENTRAL_GITHUB_TOKEN: 'central-token', OPENROUTER_API_KEY: 'test-key' };
  writeFileSync(environment.OCR_PREVIEW_PATH, JSON.stringify({ reviewable_files: [{ path: 'src/example.js' }] }));
  const sha = 'a'.repeat(40);
  const oldSha = 'b'.repeat(40);
  try {
    process.chdir(workspace);
    const result = await prepareRoutingStep({ env: environment, now: () => now,
      fetchRepoIdentity: async ({ fullName }) => ({ id: 1, full_name: fullName }),
      fetchCurrentAuthorization: async () => ({ registry: fixture.trust.registry, operationalDossiers: fixture.trust.operationalDossiers }),
      readCliIdentity: async () => ({ binarySha256: hash(fixture.binary) }),
      fetchImpl: async (_url, options) => options.method === 'POST'
        ? { ok: false, status: 503 }
        : { ok: true, json: async () => ({ id: 1, full_name: 'owner/repo', private: false, visibility: 'public' }) },
      listTrackedPaths: () => CENTRAL_MANIFEST_PATHS,
      runGit: async (_command, args) => {
        if (args[0] === 'config') return Buffer.from('https://github.com/owner/repo.git\n');
        if (args[0] === 'rev-parse') return Buffer.from(`${sha}\n`);
        if (args[0] === 'merge-base') return Buffer.from(`${oldSha}\n`);
        if (args.includes('--name-status')) return Buffer.from('M\0src/example.js\0');
        if (args.includes('--numstat')) return Buffer.from('1\t0\tsrc/example.js\0');
        if (args.includes('--raw')) return Buffer.from(`:100644 100644 ${oldSha} ${sha} M\0src/example.js\0`);
        return Buffer.alloc(0);
      },
    });
    assert.equal(result.route.selected_model_id, 'certified-primary');
    assert.deepEqual(result.route.fallback_models, ['certified-fallback']);
    assert.equal(existsSync(join(runTemp, 'ocr-routing-execution-context.json')), true);
  } finally { process.chdir(oldCwd); rmSync(workspace, { recursive: true, force: true }); }
});

test('enforce preparation rejects omitted model certification evidence before Decision POST', async () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-routing-evidence-omitted-'));
  const fixture = certificationFixture();
  fixture.trust.index.certifications = [];
  const environment = { ...env('enforce'), RUNNER_TEMP: runTemp, OCR_PREVIEW_PATH: join(runTemp, 'preview.json'),
    BASE_REF: 'main', TARGET_REPO: 'owner/repo', GITHUB_TOKEN: 'test-token', OPENROUTER_API_KEY: 'test-key' };
  writeFileSync(environment.OCR_PREVIEW_PATH, JSON.stringify({ reviewable_files: [{ path: 'src/example.js' }] }));
  let decisionPosts = 0;
  const sha = 'a'.repeat(40);
  const oldSha = 'b'.repeat(40);
  try {
    await assert.rejects(prepareRoutingStep({ env: environment, trustedInputs: fixture.trust,
      now: () => fixture.now, fetchRepoIdentity: async () => ({ id: 1, full_name: 'owner/repo' }),
      readCliIdentity: async () => ({ binarySha256: hash(fixture.binary) }),
      fetchImpl: async (_url, options) => {
        if (options.method === 'POST') decisionPosts++;
        return options.method === 'POST' ? { ok: false, status: 503 }
          : { ok: true, json: async () => ({ id: 1, full_name: 'owner/repo', private: false, visibility: 'public' }) };
      },
      runGit: async (_command, args) => {
        if (args[0] === 'config') return Buffer.from('https://github.com/owner/repo.git\n');
        if (args[0] === 'rev-parse') return Buffer.from(`${sha}\n`);
        if (args[0] === 'merge-base') return Buffer.from(`${oldSha}\n`);
        if (args.includes('--name-status')) return Buffer.from('M\0src/example.js\0');
        if (args.includes('--numstat')) return Buffer.from('1\t0\tsrc/example.js\0');
        if (args.includes('--raw')) return Buffer.from(`:100644 100644 ${oldSha} ${sha} M\0src/example.js\0`);
        return Buffer.alloc(0);
      },
    }), { message: 'REVIEW_CERTIFICATION_INVALID' });
    assert.equal(decisionPosts, 0);
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('shadow startup revocation is re-evaluated before a Decision POST', async () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-routing-shadow-revoked-'));
  const trust = trustedInputs('shadow');
  trust.egressPolicy = allowedEgressPolicyFixture;
  const environment = { ...env('shadow'), RUNNER_TEMP: runTemp, OCR_PREVIEW_PATH: join(runTemp, 'preview.json'),
    BASE_REF: 'main', TARGET_REPO: 'owner/repo', GITHUB_TOKEN: 'test-token', OPENROUTER_API_KEY: 'test-key' };
  writeFileSync(environment.OCR_PREVIEW_PATH, JSON.stringify({ reviewable_files: [{ path: 'src/example.js' }] }));
  let decisionPosts = 0;
  let freshReads = 0;
  const sha = 'a'.repeat(40);
  const oldSha = 'b'.repeat(40);
  try {
    await assert.rejects(prepareRoutingStep({ env: environment, fs: egressPolicyFs(), trustedInputs: { ...trust,
      fetchCurrentAuthorization: async () => { freshReads++; return { registry: {}, operationalDossiers: {} }; } },
      now: () => '2026-01-01T00:00:00.000Z', fetchRepoIdentity: async () => ({ id: 1, full_name: 'owner/repo' }),
      fetchImpl: async (_url, options) => {
        if (options.method === 'POST') decisionPosts++;
        return { ok: true, json: async () => ({ id: 1, full_name: 'owner/repo', private: false, visibility: 'public' }) };
      },
      runGit: async (_command, args) => {
        if (args[0] === 'config') return Buffer.from('https://github.com/owner/repo.git\n');
        if (args[0] === 'rev-parse') return Buffer.from(`${sha}\n`);
        if (args[0] === 'merge-base') return Buffer.from(`${oldSha}\n`);
        if (args.includes('--name-status')) return Buffer.from('M\0src/example.js\0');
        if (args.includes('--numstat')) return Buffer.from('1\t0\tsrc/example.js\0');
        if (args.includes('--raw')) return Buffer.from(`:100644 100644 ${oldSha} ${sha} M\0src/example.js\0`);
        return Buffer.alloc(0);
      },
    }), { code: 'ROUTING_ACTIVATION_DENIED' });
    assert.equal(freshReads, 1);
    assert.equal(decisionPosts, 0);
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});
