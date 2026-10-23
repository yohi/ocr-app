import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { authorizeRoutingStart } from './authorize-routing-start.mjs';
import { prepareRoutingStep, createRunBindingFromEnv, readSelectedReviewRoute } from './prepare-review-routing.mjs';
import { runRoutingReview } from './run-routing-review.mjs';
import { createAttemptRecorder, createRoutingDecisionRecord, finalizeRoutingAudit, writeRoutingAudit } from './ocr-routing-audit.mjs';
import { evaluatePublishEligibility } from './evaluate-routing-publish.mjs';
import { publishRoutingReview } from './publish-routing-review.mjs';
import { revalidateRoutingExecutionContext } from './routing-execution-context.mjs';
import { readInstalledCliIdentity } from './load-review-certification.mjs';
import { readCheckoutIdentity } from './read-checkout-identity.mjs';
import { fetchCurrentRoutingAuthorization } from './routing-authorization.mjs';
import { evaluateRoutingStartup, hashRoutingSourceManifest } from './routing-authorization.mjs';
import { readRoutingExecutionContext, writeRoutingExecutionContext } from './routing-execution-context.mjs';
import { run as postOcrComments } from './post-ocr-comments.mjs';

const timestamp = '2026-10-21T12:00:00.000Z';
const head = 'a'.repeat(40);
const temporary = [];

function tempDir() {
  const path = mkdtempSync(join(tmpdir(), 'routing-remediation-'));
  temporary.push(path);
  return path;
}

test.after(() => {
  for (const path of temporary) rmSync(path, { recursive: true, force: true });
});

function effects() {
  const calls = [];
  return {
    calls,
    snapshot: () => ({
      decisionPosts: calls.filter(call => call.kind === 'decision-post').length,
      hostSpawns: calls.filter(call => call.kind === 'host').length,
      uploads: calls.filter(call => call.kind === 'upload').length,
      posts: calls.filter(call => call.kind === 'post').length,
      threads: calls.filter(call => call.kind === 'thread').length,
    }),
  };
}

function commitRepo(root, fileContents = { 'README.md': '# repo\n' }) {
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Integration Test']);
  for (const [path, contents] of Object.entries(fileContents)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, contents);
  }
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-qm', 'fixture']);
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

function trustedCentralCheckout() {
  const root = tempDir();
  commitRepo(root, {
    '.github/workflows/ocr-engine.yml': 'name: trusted\n',
    '.github/workflows/package.json': '{}\n',
    '.github/workflows/package-lock.json': '{}\n',
    '.github/workflows/config/review-risk-policy.json': '{}\n',
    '.github/workflows/config/decision-egress-policy.json': '{}\n',
    '.github/workflows/config/review-model-catalog.json': '{}\n',
    '.github/workflows/config/review-model-catalog.schema.json': '{}\n',
  });
  const digest = path => `sha256:${createHash('sha256').update(readFileSync(join(root, path))).digest('hex')}`;
  const sourceManifestSha256 = hashRoutingSourceManifest({ trustedRoot: root, readFile: path => readFileSync(join(root, path)),
    listTrackedPaths: () => execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean) });
  return { root, policySha256: digest('.github/workflows/config/review-risk-policy.json'),
    catalogSha256: digest('.github/workflows/config/review-model-catalog.json'), sourceManifestSha256 };
}

function authority(repoId = 7, fullName = 'owner/repo') {
  return { registry: { schema_version: '1', approvals: [], activations: [], revoked_refs: [] }, operationalDossiers: {}, repoIdentity: { repo_id: repoId, full_name: fullName } };
}

function routingDecision(runBinding, reviewableFileCount = 1) {
  return createRoutingDecisionRecord({ runBinding,
    features: { classification_status: 'unclassified_code', risk_floor: 'deep', reviewable_file_count: reviewableFileCount },
    decision: {}, egressStatus: 'denied',
    route: { proposedStrategy: 'deep', selectedStrategy: runBinding.mode === 'shadow' ? null : 'deep',
      routeSource: 'deterministic_fallback', decisionStatus: 'unavailable' },
    policyVersions: { policyVersion: '1', modelCatalogVersion: '1' } });
}

function authorizedTrust(mode, repoId = 7, fullName = 'owner/repo', digests = {}) {
  const policySha256 = digests.policySha256 ?? `sha256:${'b'.repeat(64)}`;
  const catalogSha256 = digests.catalogSha256 ?? `sha256:${'c'.repeat(64)}`;
  const sourceManifestSha256 = digests.sourceManifestSha256 ?? `sha256:${'d'.repeat(64)}`;
  const kinds = ['owner_operation', 'security', 'audit_operation', 'g1'];
  if (mode === 'enforce') kinds.push('g2', 'g3', 'g4');
  const operationalDossiers = {};
  const approvals = kinds.map((kind, index) => {
    const ref = `OWNER-TASK-${index}`;
    const dossier = { schema_version: '1', ref, kind, issuer: 'owner', owner_decision: 'approve', repo_id: repoId,
      full_name: fullName, allowed_modes: ['shadow', 'enforce'], allowed_effects: ['routing'], source_manifest_sha256: sourceManifestSha256,
      policy_sha256: policySha256, catalog_sha256: catalogSha256, issued_at: '2025-01-01T00:00:00.000Z',
      expires_at: '2027-01-01T00:00:00.000Z', revocation_ref: ref };
    const bytes = Buffer.from(JSON.stringify(dossier));
    if (['owner_operation', 'security', 'audit_operation'].includes(kind)) operationalDossiers[ref] = bytes;
    return { ref, kind, repo_id: repoId, full_name: fullName,
      subject_sha256: ['owner_operation', 'security', 'audit_operation'].includes(kind)
        ? `sha256:${createHash('sha256').update(bytes).digest('hex')}` : sourceManifestSha256,
      issued_at: '2025-01-01T00:00:00.000Z', expires_at: '2027-01-01T00:00:00.000Z' };
  });
  const registry = { schema_version: '1', approvals, revoked_refs: [], activations: [{ repo_id: repoId, full_name: fullName, mode,
    issued_at: '2025-01-01T00:00:00.000Z', expires_at: '2027-01-01T00:00:00.000Z', policy_sha256: policySha256,
    catalog_sha256: catalogSha256, approval_refs: approvals.map(item => item.ref) }] };
  return { registry, operationalDossiers, policySha256, catalogSha256, sourceManifestSha256,
    index: {}, catalog: { schema_version: '1', catalog_version: '1', models: [], strategies: {}, unknown_risk_strategy: 'deep' },
    riskPolicy: JSON.parse(readFileSync(new URL('../config/review-risk-policy.json', import.meta.url), 'utf8')),
    egressPolicy: { schema_version: '1', destination: 'openrouter-decisions', policy_version: '1', approval_reference_format: 'OWNER-<approval-id>', allowed_repositories: [] },
    readEvidence: () => { throw new Error('unexpected evidence read'); }, readCliIdentity: () => { throw new Error('unexpected CLI read'); } };
}

function snapshotBytes(directory, prefix = '') {
  return readdirSync(directory).sort().flatMap(name => {
    const path = join(directory, name);
    const relativeName = prefix ? `${prefix}/${name}` : name;
    if (statSync(path).isDirectory()) return snapshotBytes(path, relativeName);
    return [[relativeName, readFileSync(path).toString('base64')]];
  });
}

function snapshotSealedFiles(runTemp) {
  return snapshotBytes(join(runTemp, 'ocr-routing'));
}

async function uploadSealedFiles(runTemp, callLog) {
  const args = { runTemp, directory: join(runTemp, 'ocr-routing') };
  callLog.push({ kind: 'upload', args });
  try {
    const decision = JSON.parse(readFileSync(join(args.directory, 'decision.json'), 'utf8'));
    const attemptBytes = readFileSync(join(args.directory, 'attempts.ndjson'), 'utf8');
    const attempts = attemptBytes.trim() ? attemptBytes.trim().split(/\r?\n/).map(line => JSON.parse(line)) : [];
    const finalAudit = JSON.parse(readFileSync(join(args.directory, 'final.json'), 'utf8'));
    if (decision.workflow_run_id !== finalAudit.workflow_run_id || decision.run_attempt !== finalAudit.run_attempt
      || attempts.some(event => event.schema_version !== '1')) {
      return { outcome: 'failure', artifactId: null, reason: 'SEALED_FILE_BINDING_MISMATCH' };
    }
    return { outcome: 'success', artifactId: 'fake-artifact-id', runId: decision.workflow_run_id, runAttempt: decision.run_attempt };
  } catch (error) {
    return { outcome: 'failure', artifactId: null, reason: error.code ?? 'SEALED_FILE_INVALID' };
  }
}

async function publishAndAssertSealed(args) {
  const before = snapshotSealedFiles(args.runTemp);
  const result = await publishRoutingReview(args);
  assert.deepEqual(snapshotSealedFiles(args.runTemp), before, 'publisher must not modify sealed routing files');
  return result;
}

function evaluateGateAndAssertSealed(runTemp, input) {
  const before = snapshotSealedFiles(runTemp);
  const result = evaluatePublishEligibility(input);
  assert.deepEqual(snapshotSealedFiles(runTemp), before, 'Gate must not modify sealed routing files');
  return result;
}

async function runOfflinePipeline({ runReviewArgs, runTemp, callLog, publisherArgs = {}, host = async () => ({ status: 'success', output: '{}' }) }) {
  const review = await runRoutingReview({ ...runReviewArgs,
    runHost: async args => { callLog.push({ kind: 'host', args }); return host(args); } });
  if (!['success', 'skipped'].includes(review.status)) return { review, delivery: null, publication: null };
  const delivery = await uploadSealedFiles(runTemp, callLog);
  if (delivery.outcome !== 'success') return { review, delivery, publication: null };
  const publication = await publishAndAssertSealed({ ...publisherArgs, delivery,
    postReview: async args => { callLog.push({ kind: 'post', args }); return 0; } });
  if (publication.published) callLog.push({ kind: 'thread-resolver' });
  return { review, delivery, publication };
}

async function runPreparedOfflinePipeline({ prepareArgs, callLog, runReviewArgs, publisherArgs }) {
  let preparation;
  try {
    preparation = await prepareRoutingStep(prepareArgs);
  } catch (error) {
    callLog.push({ kind: 'prepare-denied', reason: error.code ?? error.message });
    return { preparation: null, denial: error, downstream: null };
  }
  const downstream = await runOfflinePipeline({ runReviewArgs: runReviewArgs(preparation),
    runTemp: prepareArgs.env.RUNNER_TEMP, callLog, publisherArgs });
  return { preparation, denial: null, downstream };
}

function responseForJson(value, status = 200) {
  const bytes = Buffer.from(JSON.stringify(value));
  let emitted = false;
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, body: { getReader: () => ({ read: async () => {
    if (emitted) return { done: true };
    emitted = true;
    return { done: false, value: bytes };
  } }) } };
}

function centralRestFetch(live, { failStatus = null } = {}) {
  const calls = [];
  const fetchImpl = async url => {
    const requestUrl = String(url);
    calls.push(requestUrl);
    if (failStatus !== null) return responseForJson({}, failStatus);
    if (requestUrl.endsWith('/repos/central/repo')) return responseForJson({ id: 1, full_name: 'central/repo' });
    if (requestUrl.includes('/contents/.github/workflows/config/routing-authorization.json')) {
      const path = '.github/workflows/config/routing-authorization.json';
      return responseForJson({ type: 'file', path, encoding: 'base64', content: Buffer.from(JSON.stringify(live.registry)).toString('base64') });
    }
    const ref = decodeURIComponent(requestUrl.split('/').at(-1).split('?')[0].replace(/\.json$/, ''));
    const path = `.github/workflows/config/routing-approvals/${ref}.json`;
    const bytes = Buffer.from(live.operationalDossiers[ref]);
    return responseForJson({ type: 'file', path, encoding: 'base64', content: bytes.toString('base64') });
  };
  return { fetchImpl, calls };
}

function emptyReviewRecords(runBinding, auditOverrides = {}) {
  const decisionRecord = createRoutingDecisionRecord({ runBinding,
    features: { classification_status: 'allowlisted_docs_only', risk_floor: 'deep', reviewable_file_count: 0 }, decision: {},
    egressStatus: 'denied', route: { proposedStrategy: 'deep', selectedStrategy: 'deep', routeSource: 'not_requested', decisionStatus: 'not_requested' },
    policyVersions: { policyVersion: '1', modelCatalogVersion: '1' } });
  const finalAudit = finalizeRoutingAudit({ decision: decisionRecord, attempts: [],
    reviewResult: { status: 'skipped' }, validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding,
    policy: { repoId: 7, repo: 'owner/repo', prNumber: 4, review_scope_gap: false, features_incomplete: false },
    catalog: { models: [] } });
  return { decisionRecord, finalAudit: { ...finalAudit, ...auditOverrides } };
}

test('startup denial and central REST failures stop all downstream effects', async () => {
  const selfRepo = tempDir();
  commitRepo(selfRepo, {
    '.github/workflows/ocr-engine.yml': 'name: trusted\n',
    '.github/workflows/package.json': '{}\n',
    '.github/workflows/package-lock.json': '{}\n',
    '.github/workflows/config/review-risk-policy.json': '{}\n',
    '.github/workflows/config/decision-egress-policy.json': '{}\n',
    '.github/workflows/config/review-model-catalog.json': '{}\n',
    '.github/workflows/config/review-model-catalog.schema.json': '{}\n',
  });
  const baseEnv = { DECISION_ROUTING_MODE: 'enforce', GITHUB_TOKEN: 'central-token', TARGET_TOKEN: 'target-token',
    GITHUB_REPOSITORY: 'central/repo', TARGET_REPO: 'owner/repo', SELF_REPO_PATH: selfRepo, GITHUB_OUTPUT: 'unused' };
  const trust = trustedCentralCheckout();
  const validAuthority = authorizedTrust('enforce', 7, 'owner/repo', trust);
  const invalidCases = [
    ['unapproved', authority(), { repo_id: 7, full_name: 'owner/repo' }],
    ['wrong repository', validAuthority, { repo_id: 7, full_name: 'wrong/repo' }],
    ['revoked registry', { ...validAuthority, registry: { ...validAuthority.registry,
      revoked_refs: [validAuthority.registry.activations[0].approval_refs[0]] } }, { repo_id: 7, full_name: 'owner/repo' }],
  ];
  const tracked = [];
  const writeOutput = value => tracked.push(['output', value]);
  for (const [name, current, targetIdentity] of invalidCases) {
    const outputs = [];
    await assert.rejects(authorizeRoutingStart({ env: baseEnv, now: () => timestamp,
      readTrustedConfig: async () => ({ centralRepo: 'central/repo', protectedRef: 'master' }),
      fetchRepoIdentity: async ({ owner, repo }) => owner === 'central'
        ? { id: 1, full_name: 'central/repo' } : targetIdentity,
      fetchCurrentAuthorization: async params => {
        assert.equal(params.centralRepoId, 1);
        assert.equal(params.centralRepoFullName, 'central/repo');
        assert.equal(params.protectedRef, 'master');
        assert.equal(params.token, 'central-token');
        return current;
      }, writeOutput: value => outputs.push(value) }), { message: 'ROUTING_ACTIVATION_DENIED' }, name);
    assert.deepEqual(outputs, ['false'], `${name} must deny startup authorization`);
  }
  for (const status of [403, 429]) {
    await assert.rejects(authorizeRoutingStart({ env: baseEnv, fetchCurrentAuthorization: async () => {
      throw Object.assign(new Error(`HTTP ${status}`), { status });
    }, fetchRepoIdentity: async ({ owner, repo }) => ({ id: owner === 'central' ? 1 : 7, full_name: `${owner}/${repo}` }),
    readTrustedConfig: async () => ({ centralRepo: 'central/repo', protectedRef: 'master' }), writeOutput }));
  }
  await assert.rejects(authorizeRoutingStart({ env: baseEnv, fetchCurrentAuthorization: async () => { throw new Error('timeout'); },
    fetchRepoIdentity: async ({ owner, repo }) => ({ id: owner === 'central' ? 1 : 7, full_name: `${owner}/${repo}` }),
    readTrustedConfig: async () => ({ centralRepo: 'central/repo', protectedRef: 'master' }), writeOutput }));
  await assert.rejects(authorizeRoutingStart({ env: { ...baseEnv, TARGET_TOKEN: '' }, writeOutput }));
  assert.ok(tracked.some(([, value]) => value === 'false'));
});

test('dossier digest, issuer, expired approval, and revoked approval are denied by production startup evaluation', async () => {
  const checkout = trustedCentralCheckout();
  const baseline = authorizedTrust('enforce', 7, 'owner/repo', checkout);
  const startupInput = trust => ({ mode: 'enforce', repoIdentity: { repo_id: 7, full_name: 'owner/repo' },
    registry: trust.registry, operationalDossiers: trust.operationalDossiers, policySha256: trust.policySha256,
    catalogSha256: trust.catalogSha256, sourceManifestSha256: trust.sourceManifestSha256, now: timestamp });
  assert.equal(evaluateRoutingStartup(startupInput(baseline)).authorized, true);
  const cases = [
    ['altered dossier digest', trust => {
      const ref = trust.registry.approvals.find(item => item.kind === 'owner_operation').ref;
      trust.operationalDossiers[ref] = Buffer.from(JSON.stringify({ ...JSON.parse(trust.operationalDossiers[ref]), owner_decision: 'reject' }));
    }],
    ['altered dossier issuer', trust => {
      const approval = trust.registry.approvals.find(item => item.kind === 'owner_operation');
      const dossier = { ...JSON.parse(trust.operationalDossiers[approval.ref]), issuer: 'untrusted' };
      const bytes = Buffer.from(JSON.stringify(dossier));
      trust.operationalDossiers[approval.ref] = bytes;
      approval.subject_sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    }],
    ['expired approval', trust => {
      trust.registry.approvals.find(item => item.kind === 'g1').expires_at = '2026-01-01T00:00:00.000Z';
    }],
    ['revoked approval reference', trust => {
      trust.registry.revoked_refs.push(trust.registry.approvals.find(item => item.kind === 'security').ref);
    }],
  ];
  for (const [reason, mutate] of cases) {
    const trust = authorizedTrust('enforce', 7, 'owner/repo', checkout);
    mutate(trust);
    const counters = effects();
    assert.deepEqual(evaluateRoutingStartup(startupInput(trust)), { authorized: false, reason: 'ROUTING_ACTIVATION_DENIED', approvalRefs: [] }, reason);
    assert.deepEqual(counters.snapshot(), { decisionPosts: 0, hostSpawns: 0, uploads: 0, posts: 0, threads: 0 }, reason);
  }
});

test('production central-authority reader consumes mutable fake REST responses on each live read', async () => {
  const live = { schema_version: '1', approvals: [], activations: [], revoked_refs: [] };
  const calls = [];
  const fetchImpl = async url => {
    const requestUrl = String(url);
    calls.push(requestUrl);
    let value;
    let path;
    if (requestUrl.endsWith('/repos/central/repo')) value = { id: 1, full_name: 'central/repo' };
    else {
      path = '.github/workflows/config/routing-authorization.json';
      value = { type: 'file', path, encoding: 'base64', content: Buffer.from(JSON.stringify(live)).toString('base64') };
    }
    const bytes = Buffer.from(JSON.stringify(value));
    let emitted = false;
    return { ok: true, headers: { get: () => null }, body: { getReader: () => ({ read: async () => {
      if (emitted) return { done: true };
      emitted = true;
      return { done: false, value: bytes };
    } }) } };
  };
  const args = { centralRepoId: 1, centralRepoFullName: 'central/repo', protectedRef: 'master', token: 'central-token', fetchImpl, now: timestamp };
  const first = await fetchCurrentRoutingAuthorization(args);
  assert.deepEqual(first.registry, live);
  live.revoked_refs.push('OWNER-REVOKED');
  const second = await fetchCurrentRoutingAuthorization(args);
  assert.deepEqual(second.registry.revoked_refs, ['OWNER-REVOKED']);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(url => url.includes('/repos/central/repo')));
});

test('startup denial stops the complete offline pipeline before Host, upload, post, or thread effects', async () => {
  const runTemp = tempDir();
  const binding = { workflowRunId: '123', runAttempt: 1, headSha: head, mode: 'enforce' };
  const log = effects();
  const callLog = log.calls;
  const sealed = { schema_version: '1', binding, cli_binary_sha256: null };
  const result = await runOfflinePipeline({ runTemp, callLog, publisherArgs: {}, runReviewArgs: {
    env: { DECISION_ROUTING_MODE: 'enforce', RUNNER_TEMP: runTemp }, expectedBinding: binding,
    readExecutionContext: async () => sealed, readRoute: async () => ({ reviewable_file_count: 0 }), readDecision: async () => ({}),
    fetchCurrentAuthorization: async () => { callLog.push({ kind: 'authority-read' }); return { registry: {}, operationalDossiers: {} }; },
    evaluateStartup: () => { callLog.push({ kind: 'startup-denied', reason: 'ROUTING_ACTIVATION_DENIED' }); return { authorized: false }; },
    trustedInputs: {}, repoIdentity: { repo_id: 7, full_name: 'owner/repo' }, writeResult: async () => {},
  } });
  assert.equal(result.review.status, 'failed');
  assert.equal(result.review.message, 'ROUTING_ACTIVATION_DENIED');
  assert.equal(result.delivery, null);
  assert.equal(result.publication, null);
  assert.deepEqual(callLog, [{ kind: 'authority-read' }, { kind: 'startup-denied', reason: 'ROUTING_ACTIVATION_DENIED' }]);
  assert.deepEqual(log.snapshot(), { decisionPosts: 0, hostSpawns: 0, uploads: 0, posts: 0, threads: 0 });
});

test('off mode has no new routing effects and preserves exact legacy Host options', async () => {
  const log = effects();
  const routingReads = { configReads: 0, contextReads: 0, repoGets: 0, uploads: 0 };
  const progress = () => {};
  const legacyOptions = { model: 'legacy-model', fallbackModels: ['legacy-fallback'], maxRetries: 2,
    onProgress: progress };
  const legacyResult = { status: 'success', output: 'legacy' };
  const result = await runRoutingReview({ env: { DECISION_ROUTING_MODE: 'off' }, ...legacyOptions,
    readExecutionContext: async () => { routingReads.contextReads++; },
    readRoute: async () => { routingReads.configReads++; },
    fetchCurrentAuthorization: async () => { routingReads.repoGets++; },
    writeOutput: async () => { routingReads.configReads++; },
    runHost: async options => {
      log.calls.push({ kind: 'host', model: options.model, fallbackModels: options.fallbackModels,
        maxRetries: options.maxRetries, onProgress: options.onProgress });
      return legacyResult;
    } });
  assert.deepEqual(result, legacyResult);
  assert.deepEqual(log.calls, [{ kind: 'host', ...legacyOptions }]);
  assert.deepEqual(routingReads, { configReads: 0, contextReads: 0, repoGets: 0, uploads: 0 });
});

test('shadow absent route continues legacy review only after fresh startup authorization', async () => {
  const output = [];
  const review = { status: 'success', output: '{}' };
  const result = await runRoutingReview({ env: { DECISION_ROUTING_MODE: 'shadow', RUNNER_TEMP: '/unused' },
    readExecutionContext: async () => ({ binding: {} }), readRoute: async () => null,
    readDecision: async () => null, writeOutput: async value => output.push(value),
    runHost: async () => review,
    fetchCurrentAuthorization: async () => ({ registry: {} }), evaluateStartup: () => ({ authorized: true }) });
  assert.deepEqual(result, review);
  assert.deepEqual(output, []);
});

test('shadow existing-route binding mismatch sets guard and blocks Host and downstream mutations', async () => {
  const log = effects();
  const outputs = [];
  const runTemp = tempDir();
  const runBinding = { workflowRunId: '123', runAttempt: 1, headSha: head, mode: 'shadow' };
  const result = await runOfflinePipeline({ runTemp, callLog: log.calls, runReviewArgs: {
    env: { DECISION_ROUTING_MODE: 'shadow', RUNNER_TEMP: runTemp },
    expectedBinding: runBinding,
    readExecutionContext: async () => ({ binding: { mode: 'shadow' } }),
    readRoute: async () => ({ selected_model_id: 'proposal', reviewable_file_count: 1 }),
    readDecision: async () => routingDecision(runBinding),
    fetchCurrentAuthorization: async () => ({ registry: {} }), evaluateStartup: () => ({ authorized: true }),
    revalidateExecutionContext: async () => { throw Object.assign(new Error('mismatch'), { code: 'ROUTING_EXECUTION_CONTEXT_INVALID' }); },
    writeOutput: async value => outputs.push(value), runHost: async () => { log.calls.push({ kind: 'host' }); return { status: 'success' }; },
  } });
  assert.equal(result.review.message, 'ROUTING_EXECUTION_CONTEXT_INVALID');
  assert.deepEqual(outputs, ['ROUTE_GUARD_FAILED=true']);
  assert.deepEqual(result.delivery, null);
  assert.deepEqual(log.snapshot(), { decisionPosts: 0, hostSpawns: 0, uploads: 0, posts: 0, threads: 0 });
});

test('shadow audit upload failure preserves legacy review and Check result with a fixed diagnostic', async () => {
  const log = effects();
  const runTemp = tempDir();
  const runBinding = { workflowRunId: '123', runAttempt: 1, headSha: head, mode: 'shadow' };
  mkdirSync(join(runTemp, 'ocr-routing'));
  writeFileSync(join(runTemp, 'ocr-routing', 'decision.json'), JSON.stringify(routingDecision(runBinding)));
  const review = { status: 'success', output: '{}' };
  const result = await runOfflinePipeline({ runTemp, callLog: log.calls, host: async () => {
    writeFileSync(join(runTemp, 'ocr-routing', 'decision.json'), '{ malformed');
    return review;
  }, runReviewArgs: {
    env: { DECISION_ROUTING_MODE: 'shadow', RUNNER_TEMP: runTemp },
    expectedBinding: runBinding,
    readExecutionContext: async () => ({ binding: { mode: 'shadow' } }),
    readRoute: async () => ({ selected_model_id: 'proposal', reviewable_file_count: 1 }),
    readDecision: async () => routingDecision(runBinding),
    fetchCurrentAuthorization: async () => ({ registry: {} }), evaluateStartup: () => ({ authorized: true }),
    revalidateExecutionContext: async () => ({ certifiedBundle: null }),
    createRecorder: async () => { throw new Error('observer unavailable'); },
  } });
  assert.deepEqual(result.review, review);
  assert.equal(result.delivery.outcome, 'failure');
  assert.equal(result.delivery.reason, 'SEALED_FILE_INVALID');
  assert.ok(['SEALED_FILE_INVALID', 'SEALED_FILE_BINDING_MISMATCH'].includes(result.delivery.reason));
  assert.equal(result.publication, null);
  const checkConclusion = result.review.status === 'success' ? 'success' : 'failure';
  assert.equal(checkConclusion, 'success');
  assert.deepEqual(log.calls.map(call => call.kind), ['host', 'upload']);
});

test('authorized shadow observer failure preserves legacy review result and model options', async () => {
  const log = effects();
  const legacyResult = { schema_version: '1.0', mode: 'review', status: 'success', coverage: 1, findings: [], message: 'legacy' };
  const legacyHostOptions = { model: 'legacy-host-model', fallbackModels: ['legacy-host-fallback'], maxRetries: 3 };
  const progress = () => {};
  const runBinding = { workflowRunId: '123', runAttempt: 1, headSha: head, mode: 'shadow' };
  const result = await runRoutingReview({ env: { DECISION_ROUTING_MODE: 'shadow', RUNNER_TEMP: '/unused' },
    expectedBinding: runBinding,
    ...legacyHostOptions, onProgress: progress,
    readExecutionContext: async () => { log.calls.push({ kind: 'context-read' }); return { binding: { mode: 'shadow' } }; },
    readRoute: async () => { log.calls.push({ kind: 'route-read' }); return { selected_model_id: 'proposal-model',
      fallback_models: ['proposal-fallback'], reviewable_file_count: 1 }; },
    readDecision: async () => routingDecision(runBinding),
    fetchCurrentAuthorization: async () => ({ registry: {}, operationalDossiers: {} }),
    evaluateStartup: () => ({ authorized: true }),
    revalidateExecutionContext: async () => ({ certifiedBundle: null }),
    createRecorder: async () => { throw new Error('observer write failed'); },
    runHost: async options => {
      log.calls.push({ kind: 'host', model: options.model, fallbackModels: options.fallbackModels });
      assert.equal(options.onProgress, progress);
      return legacyResult;
    } });
  assert.deepEqual(result, legacyResult);
  assert.deepEqual(log.calls.filter(call => call.kind === 'host'), [{ kind: 'host', model: 'legacy-host-model', fallbackModels: ['legacy-host-fallback'] }]);
  assert.deepEqual(log.snapshot(), { decisionPosts: 0, hostSpawns: 1, uploads: 0, posts: 0, threads: 0 });
});

test('missing sealed context is rejected by the real context reader before any downstream adapter', async () => {
  const runTemp = tempDir();
  const binding = { workflowRunId: '123', runAttempt: 1, headSha: head, mode: 'enforce' };
  const log = effects();
  const result = await runOfflinePipeline({ runTemp, callLog: log.calls, runReviewArgs: {
    env: { DECISION_ROUTING_MODE: 'enforce', RUNNER_TEMP: runTemp }, expectedBinding: binding,
    readExecutionContext: args => readRoutingExecutionContext(args),
    readRoute: async () => { log.calls.push({ kind: 'route-read' }); return { reviewable_file_count: 0 }; },
    readDecision: async () => ({}), fetchCurrentAuthorization: async () => { log.calls.push({ kind: 'authority-read' }); return { registry: {}, operationalDossiers: {} }; },
    trustedInputs: {}, repoIdentity: { repo_id: 7, full_name: 'owner/repo' }, writeResult: async () => {},
    evaluateStartup: () => ({ authorized: true }),
  } });
  assert.equal(result.review.status, 'failed');
  assert.equal(result.review.message, 'ROUTING_EXECUTION_CONTEXT_INVALID');
  assert.deepEqual(log.calls.map(call => call.kind), ['route-read', 'authority-read']);
  assert.deepEqual(log.snapshot(), { decisionPosts: 0, hostSpawns: 0, uploads: 0, posts: 0, threads: 0 });
});

test('wrong checkout identity and valid activation for another repository both deny preparation', async () => {
  const runTemp = tempDir();
  const targetRoot = tempDir();
  const env = { DECISION_ROUTING_MODE: 'shadow', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', COMMIT_SHA: head,
    TARGET_REPO: 'owner/repo', GITHUB_TOKEN: 'target-token', RUNNER_TEMP: runTemp, TARGET_REPO_PATH: targetRoot,
    OCR_PREVIEW_PATH: join(runTemp, 'preview.json'), BASE_REF: 'main' };
  writeFileSync(env.OCR_PREVIEW_PATH, JSON.stringify({ reviewable_files: [] }));
  const trust = authorizedTrust('shadow');
  const log = effects();
  const checkoutCalls = [];
  const wrongCheckout = await runPreparedOfflinePipeline({ callLog: log.calls,
    prepareArgs: { env, trustedInputs: trust, now: () => timestamp,
      fetchRepoIdentity: async () => ({ id: 7, full_name: 'owner/repo' }), fetchImpl: async () => ({ ok: false, status: 403 }),
      runGit: async (_command, args) => {
        checkoutCalls.push([...args]);
        if (args[0] === 'config') return Buffer.from('https://evil/repo.git\n');
        if (args[0] === 'rev-parse') return Buffer.from(`${head}\n`);
        return Buffer.alloc(0);
      } },
    runReviewArgs: () => ({ env, expectedBinding: createRunBindingFromEnv(env), readRoute: async () => null,
      readDecision: async () => null, fetchCurrentAuthorization: async () => ({ registry: trust.registry, operationalDossiers: trust.operationalDossiers }),
      trustedInputs: trust, repoIdentity: { repo_id: 7, full_name: 'owner/repo' } }) });
  assert.equal(wrongCheckout.denial.message, 'CHECKOUT_IDENTITY_MISMATCH');
  assert.equal(wrongCheckout.downstream, null);
  assert.ok(checkoutCalls.some(args => args[0] === 'config'), 'checkout identity boundary was reached');
  assert.deepEqual(log.snapshot(), { decisionPosts: 0, hostSpawns: 0, uploads: 0, posts: 0, threads: 0 });
  assert.deepEqual(log.calls.map(call => call.kind), ['prepare-denied']);

  const otherRepoRunTemp = tempDir();
  const otherEnv = { ...env, RUNNER_TEMP: otherRepoRunTemp, OCR_PREVIEW_PATH: join(otherRepoRunTemp, 'preview.json') };
  writeFileSync(otherEnv.OCR_PREVIEW_PATH, JSON.stringify({ reviewable_files: [] }));
  const differentRepoTrust = authorizedTrust('shadow', 7, 'other/repo');
  let checkoutReached = false;
  const wrongRepo = await runPreparedOfflinePipeline({ callLog: log.calls,
    prepareArgs: { env: otherEnv, trustedInputs: differentRepoTrust, now: () => timestamp,
      fetchRepoIdentity: async () => ({ id: 7, full_name: 'owner/repo' }),
      runGit: async () => { checkoutReached = true; return Buffer.alloc(0); } },
    runReviewArgs: () => ({ env: otherEnv, expectedBinding: createRunBindingFromEnv(otherEnv), readRoute: async () => null,
      readDecision: async () => null, trustedInputs: differentRepoTrust, repoIdentity: { repo_id: 7, full_name: 'owner/repo' } }) });
  assert.equal(wrongRepo.denial.code, 'ROUTING_ACTIVATION_DENIED');
  assert.equal(wrongRepo.downstream, null);
  assert.equal(differentRepoTrust.registry.activations.length, 1);
  assert.equal(differentRepoTrust.registry.activations[0].full_name, 'other/repo');
  assert.equal(checkoutReached, false);
  assert.deepEqual(log.snapshot(), { decisionPosts: 0, hostSpawns: 0, uploads: 0, posts: 0, threads: 0 });
});

test('wrong run attempt and missing model certification deny before Host spawn', async () => {
  const runTemp = tempDir();
  const log = effects();
  const trust = authorizedTrust('enforce');
  const binding = { workflowRunId: '123', runAttempt: 1, headSha: head, mode: 'enforce' };
  const context = { schema_version: '1', binding, repo_identity: { repoId: 7, fullName: 'owner/repo', headSha: head },
    authorization: { policy_sha256: trust.policySha256.slice(7), catalog_sha256: trust.catalogSha256.slice(7),
      source_manifest_sha256: trust.sourceManifestSha256.slice(7), approval_refs: trust.registry.activations[0].approval_refs },
    certification_refs: [], cli_inventory_sha256: 'e'.repeat(64), cli_binary_sha256: 'f'.repeat(64) };
  writeRoutingExecutionContext({ runTemp, context });
  const wrongBinding = { ...binding, runAttempt: 2 };
  const wrongAttempt = await runRoutingReview({ env: { DECISION_ROUTING_MODE: 'enforce', RUNNER_TEMP: runTemp }, expectedBinding: wrongBinding,
    readExecutionContext: args => readRoutingExecutionContext(args), readRoute: async () => ({ reviewable_file_count: 0 }), readDecision: async () => ({}),
    fetchCurrentAuthorization: async () => ({ registry: trust.registry, operationalDossiers: trust.operationalDossiers }), trustedInputs: trust,
    repoIdentity: { repo_id: 7, full_name: 'owner/repo' }, runHost: async () => { log.calls.push({ kind: 'host' }); return {}; } });
  assert.equal(wrongAttempt.status, 'failed');
  assert.equal(wrongAttempt.message, 'ROUTING_EXECUTION_CONTEXT_INVALID');
  assert.deepEqual(log.snapshot(), { decisionPosts: 0, hostSpawns: 0, uploads: 0, posts: 0, threads: 0 });

  const certificationFailure = await runRoutingReview({ env: { DECISION_ROUTING_MODE: 'enforce', RUNNER_TEMP: runTemp }, expectedBinding: binding,
    readExecutionContext: async () => context,
    readRoute: async () => ({ reviewable_file_count: 1, selected_strategy: 'deep', selected_model_id: 'missing-certified-model', fallback_models: [] }),
    readDecision: async () => routingDecision(binding), fetchCurrentAuthorization: async () => ({ registry: trust.registry, operationalDossiers: trust.operationalDossiers }),
    trustedInputs: trust, repoIdentity: { repo_id: 7, full_name: 'owner/repo' }, readInstalledCliIdentity: async () => ({
      resolvedPath: '/attested/agy', binarySha256: context.cli_binary_sha256 }), runHost: async () => { log.calls.push({ kind: 'host' }); return {}; } });
  assert.equal(certificationFailure.status, 'failed');
  assert.equal(certificationFailure.message, 'ROUTING_ACTIVATION_DENIED');
  assert.deepEqual(log.snapshot(), { decisionPosts: 0, hostSpawns: 0, uploads: 0, posts: 0, threads: 0 });
});

test('CLI substitution and changed trusted digests are denied before the Host boundary', async () => {
  const runTemp = tempDir();
  const log = effects();
  const runBinding = { workflowRunId: '123', runAttempt: 1, headSha: head, mode: 'enforce' };
  const trust = authorizedTrust('enforce');
  const context = { schema_version: '1', binding: runBinding,
    repo_identity: { repoId: 7, fullName: 'owner/repo', headSha: head },
    authorization: { policy_sha256: trust.policySha256.slice(7), catalog_sha256: trust.catalogSha256.slice(7),
      source_manifest_sha256: trust.sourceManifestSha256.slice(7), approval_refs: trust.registry.activations[0].approval_refs },
    certification_refs: [], cli_inventory_sha256: 'e'.repeat(64), cli_binary_sha256: 'f'.repeat(64) };
  const route = { reviewable_file_count: 1, selected_strategy: 'deep', selected_model_id: 'certified-primary', fallback_models: ['certified-fallback'] };
  const home = tempDir();
  const targetRoot = tempDir();
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  writeFileSync(join(home, '.local', 'bin', 'agy'), 'substituted executable', { mode: 0o755 });
  const installedIdentity = readInstalledCliIdentity({ env: { HOME: home, PATH: `${targetRoot}/shadow-bin` }, targetRoot });
  async function run(trustedInputs, installedSha) {
    return runRoutingReview({ env: { DECISION_ROUTING_MODE: 'enforce', RUNNER_TEMP: runTemp }, expectedBinding: runBinding,
      readExecutionContext: async () => context, readRoute: async () => route, readDecision: async () => routingDecision(runBinding),
      fetchCurrentAuthorization: async () => ({ registry: trust.registry, operationalDossiers: trust.operationalDossiers }),
      evaluateStartup: () => ({ authorized: true }), trustedInputs, repoIdentity: { repo_id: 7, full_name: 'owner/repo' },
      readInstalledCliIdentity: async () => ({ ...installedIdentity, binarySha256: installedSha }),
      revalidateExecutionContext: input => revalidateRoutingExecutionContext({ ...input,
        trustedInputs: { ...input.trustedInputs, ...trustedInputs }, now: timestamp }),
      resolveModels: () => ({ primaryModelId: 'certified-primary', allowedFallbackModels: ['certified-fallback'] }),
      runHost: async () => { log.calls.push({ kind: 'host' }); return { status: 'success', output: '{}' }; }, writeResult: async () => {} });
  }
  const baseTrust = { ...trust, index: { cli_inventory: { sha256: 'e'.repeat(64) } }, catalog: { models: [] },
    readEvidence: () => { throw new Error('must fail before evidence read'); } };
  const cliResult = await run(baseTrust, installedIdentity.binarySha256);
  assert.notEqual(installedIdentity.binarySha256, context.cli_binary_sha256);
  assert.equal(cliResult.status, 'failed');
  assert.equal(log.snapshot().hostSpawns, 0);
  const digestResult = await run({ ...baseTrust, policySha256: `sha256:${'0'.repeat(64)}` }, 'f'.repeat(64));
  assert.equal(digestResult.status, 'failed');
  assert.equal(log.snapshot().hostSpawns, 0);
});

test('CLI symlink resolves to its attested realpath and a PATH shadow is never passed to Host', async () => {
  const home = tempDir();
  const targetRoot = tempDir();
  const realBin = tempDir();
  const pathBin = join(targetRoot, 'fake-path');
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  mkdirSync(pathBin, { recursive: true });
  const actualCli = join(realBin, 'agy-real');
  const pathShadow = join(pathBin, 'agy');
  writeFileSync(actualCli, 'attested CLI bytes', { mode: 0o755 });
  writeFileSync(pathShadow, 'PATH shadow bytes', { mode: 0o755 });
  symlinkSync(actualCli, join(home, '.local', 'bin', 'agy'));
  const identity = readInstalledCliIdentity({ env: { HOME: home, PATH: pathBin }, targetRoot });
  assert.equal(identity.resolvedPath, actualCli);
  assert.notEqual(identity.resolvedPath, pathShadow);

  const runTemp = tempDir();
  const runBinding = { workflowRunId: '123', runAttempt: 1, headSha: head, mode: 'enforce' };
  const trustedInputs = { policySha256: `sha256:${'b'.repeat(64)}`, catalogSha256: `sha256:${'c'.repeat(64)}`,
    sourceManifestSha256: `sha256:${'d'.repeat(64)}`, index: {}, catalog: { models: [
      { model_id: 'certified-primary', certification_status: 'certified', capability_tier: 'deep' },
    ] }, readEvidence: () => Buffer.alloc(0) };
  let hostExecutable;
  const result = await runRoutingReview({ env: { DECISION_ROUTING_MODE: 'enforce', RUNNER_TEMP: runTemp, HOME: home, PATH: pathBin,
      TARGET_REPO_PATH: targetRoot }, expectedBinding: runBinding,
    readExecutionContext: async () => ({ cli_binary_sha256: identity.binarySha256 }),
    readRoute: async () => ({ reviewable_file_count: 1, selected_strategy: 'deep', selected_model_id: 'certified-primary', fallback_models: [] }),
    readDecision: async () => routingDecision(runBinding), fetchCurrentAuthorization: async () => ({ registry: {}, operationalDossiers: {} }),
    evaluateStartup: () => ({ authorized: true }), trustedInputs, repoIdentity: { repo_id: 7, full_name: 'owner/repo' },
    readInstalledCliIdentity: async args => readInstalledCliIdentity({ ...args, env: { HOME: home, PATH: pathBin }, targetRoot }),
    revalidateExecutionContext: async ({ cliBinarySha256 }) => {
      assert.equal(cliBinarySha256, identity.binarySha256);
      return { certifiedBundle: { catalog: trustedInputs.catalog, evidence: {
        certification_refs: [], cli_available_models: ['certified-primary'] } } };
    }, resolveModels: () => ({ primaryModelId: 'certified-primary', allowedFallbackModels: [] }),
    runHost: async args => { hostExecutable = args.executablePath; return { status: 'success', output: '{}' }; },
    writeResult: async () => {} });
  assert.equal(result.status, 'success');
  assert.equal(hostExecutable, identity.resolvedPath);
  assert.notEqual(hostExecutable, pathShadow);
  assert.equal(hostExecutable.startsWith('/'), true);
});

test('preparation evaluates the supplied live registry before writing route or decision seals', async () => {
  const runTemp = tempDir();
  const log = effects();
  const env = { DECISION_ROUTING_MODE: 'shadow', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1',
    COMMIT_SHA: head, TARGET_REPO: 'owner/repo', GITHUB_TOKEN: 'target-token', RUNNER_TEMP: runTemp };
  const inputs = { registry: authority().registry, operationalDossiers: {}, policySha256: `sha256:${'b'.repeat(64)}`,
    catalogSha256: `sha256:${'c'.repeat(64)}`, sourceManifestSha256: `sha256:${'d'.repeat(64)}`,
    readEvidence: () => { throw new Error('evidence must not be read'); }, readCliIdentity: () => { throw new Error('CLI must not be read'); },
    index: {}, catalog: { catalog_version: '1', models: [] }, riskPolicy: {},
    egressPolicy: { schema_version: '1', destination: 'openrouter-decisions', policy_version: '1', approval_reference_format: 'OWNER-<approval-id>', allowed_repositories: [] } };
  await assert.rejects(prepareRoutingStep({ env, trustedInputs: inputs, now: () => timestamp,
    fetchRepoIdentity: async () => ({ id: 7, full_name: 'owner/repo' }),
    fetchImpl: async (_url, options) => { if (options.method === 'POST') log.calls.push({ kind: 'decision-post' }); return { ok: false, status: 403 }; },
    runGit: async () => { throw new Error('checkout must not be read'); } }), { message: 'ROUTING_ACTIVATION_DENIED' });
  assert.deepEqual(log.snapshot(), { decisionPosts: 0, hostSpawns: 0, uploads: 0, posts: 0, threads: 0 });
});

test('zero-review enforce seals execution context without model or certification proof', async () => {
  const runTemp = tempDir();
  const targetRoot = tempDir();
  const env = { DECISION_ROUTING_MODE: 'enforce', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', COMMIT_SHA: head,
    TARGET_REPO: 'owner/repo', GITHUB_TOKEN: 'target-token', RUNNER_TEMP: runTemp, TARGET_REPO_PATH: targetRoot,
    OCR_PREVIEW_PATH: join(runTemp, 'preview.json'), BASE_REF: 'main' };
  writeFileSync(env.OCR_PREVIEW_PATH, JSON.stringify({ reviewable_files: [] }));
  const result = await prepareRoutingStep({ env, trustedInputs: authorizedTrust('enforce'), now: () => timestamp,
    fetchRepoIdentity: async () => ({ id: 7, full_name: 'owner/repo' }),
    fetchImpl: async () => ({ ok: false, status: 403 }),
    runGit: async (_command, args) => {
      if (args[0] === 'config') return Buffer.from('https://github.com/owner/repo.git\n');
      if (args[0] === 'rev-parse') return Buffer.from(`${head}\n`);
      if (args[0] === 'merge-base') return Buffer.from(`${'b'.repeat(40)}\n`);
      return Buffer.alloc(0);
    } });
  assert.equal(result.route.reviewable_file_count, 0);
  assert.equal(readFileSync(join(runTemp, 'ocr-routing-execution-context.json'), 'utf8').length > 0, true);
});

test('primary failure falls back, seals audit, passes Gate, checks HEAD, uploads, and posts once', async () => {
  const runTemp = tempDir();
  mkdirSync(join(runTemp, 'ocr-routing'));
  const runBinding = { workflowRunId: '123', runAttempt: 1, headSha: head, mode: 'enforce' };
  const log = effects();
  const runAttemptId = 'a'.repeat(32);
  const catalog = { catalog_version: '1', models: [
    { model_id: 'certified-primary', certification_status: 'certified', capability_tier: 'deep' },
    { model_id: 'certified-fallback', certification_status: 'certified', capability_tier: 'deep' },
  ] };
  const trustedInputs = { policySha256: `sha256:${'b'.repeat(64)}`, catalogSha256: `sha256:${'c'.repeat(64)}`,
    sourceManifestSha256: `sha256:${'d'.repeat(64)}`, index: {}, catalog, readEvidence: () => Buffer.alloc(0),
    repoIdentity: { repo_id: 7, full_name: 'owner/repo' } };
  const route = { schema_version: '1', workflow_run_id: '123', run_attempt: 1, head_sha: head, effective_mode: 'enforce',
    status: 'prepared', reviewable_file_count: 1, proposed_strategy: 'deep', selected_strategy: 'deep',
    selected_model_id: 'certified-primary', fallback_models: ['certified-fallback'], route_source: 'deterministic_fallback',
    decision_status: 'unavailable', policy_version: '1', model_catalog_version: '1' };
  const attempts = [];
  const event = (fields) => ({ schema_version: '1', run_attempt_id: runAttemptId,
    attempt_index: 1, event: 'attempt_started', model: 'certified-primary', result: null,
    timestamp, duration_ms: null, host_status: null, ...fields });
  const reviewResult = await runRoutingReview({ env: { DECISION_ROUTING_MODE: 'enforce', RUNNER_TEMP: runTemp }, expectedBinding: runBinding,
    readExecutionContext: async () => ({ cli_binary_sha256: 'e'.repeat(64) }), readRoute: async () => route, readDecision: async () => routingDecision(runBinding),
    fetchCurrentAuthorization: async () => ({ registry: {}, operationalDossiers: {} }), evaluateStartup: () => ({ authorized: true }),
    trustedInputs, repoIdentity: trustedInputs.repoIdentity, readInstalledCliIdentity: async () => ({ resolvedPath: '/trusted/agy', binarySha256: 'e'.repeat(64) }),
    revalidateExecutionContext: async () => ({ certifiedBundle: { catalog, evidence: { certification_refs: [], cli_available_models: ['certified-primary', 'certified-fallback'] } } }),
    resolveModels: () => ({ primaryModelId: 'certified-primary', allowedFallbackModels: ['certified-fallback'] }),
    createRecorder: async () => ({ runAttemptId, onAttemptEvent: value => attempts.push(value), seal() {} }),
    runHost: async input => {
      log.calls.push({ kind: 'host', selected: input.model, fallbackModels: input.fallbackModels });
      input.onAttemptEvent(event({ event: 'attempt_started' }));
      input.onAttemptEvent(event({ event: 'attempt_completed', result: 'model_reported_failure', duration_ms: 1 }));
      input.onAttemptEvent(event({ attempt_index: 2, event: 'attempt_started', model: 'certified-fallback' }));
      input.onAttemptEvent(event({ attempt_index: 2, event: 'attempt_completed', model: 'certified-fallback', result: 'host_validated_success', duration_ms: 1 }));
      input.onAttemptEvent(event({ attempt_index: null, event: 'host_completed', model: null, result: null, duration_ms: 2, host_status: 'success' }));
      return { schema_version: '1.0', mode: 'review', status: 'success', coverage: 1, findings: [], message: 'complete' };
    }, writeResult: async () => {} });
  writeFileSync(join(runTemp, 'ocr-routing', 'attempts.ndjson'), attempts.map(item => JSON.stringify(item)).join('\n') + '\n');
  const decisionRecord = createRoutingDecisionRecord({ runBinding,
    features: { classification_status: 'unclassified_code', risk_floor: 'deep', reviewable_file_count: 1 },
    decision: {}, egressStatus: 'denied',
    route: { proposedStrategy: 'deep', selectedStrategy: 'deep', routeSource: 'deterministic_fallback', decisionStatus: 'unavailable' },
    policyVersions: { policyVersion: '1', modelCatalogVersion: '1' } });
  const finalAudit = finalizeRoutingAudit({ decision: decisionRecord, attempts, reviewResult, validation: { status: 'passed' },
    headCheck: { status: 'passed' }, runBinding, policy: { repoId: 7, repo: 'owner/repo', prNumber: 4,
      review_scope_gap: false, features_incomplete: false, selectedReviewModel: 'certified-primary' }, catalog, selectedRoute: route,
    certifiedBundle: { catalog, evidence: { cli_available_models: ['certified-primary', 'certified-fallback'] } }, runTemp });
  writeRoutingAudit({ runTemp, record: finalAudit, expectedBinding: runBinding });
  writeFileSync(join(runTemp, 'ocr-routing', 'decision.json'), JSON.stringify(decisionRecord));
  const delivery = await uploadSealedFiles(runTemp, log.calls);
  const published = await publishAndAssertSealed({ env: { GITHUB_TOKEN: 'token', TARGET_REPO: 'owner/repo', PR_NUMBER: '4',
      TARGET_REPO_PATH: '/target', GITHUB_OUTPUT: 'unused' }, runBinding, runTemp, selectedRoute: route, attemptRecord: attempts,
    finalAudit, delivery, checkRunId: 'check-1', trustedInputs,
    readExecutionContext: async () => ({ cli_binary_sha256: 'e'.repeat(64) }), fetchAuthorization: async () => ({ registry: {}, operationalDossiers: {} }),
    readCliIdentity: async () => ({ binarySha256: 'e'.repeat(64) }),
    revalidateExecutionContext: async () => ({ startupAuthorization: { authorized: true, approvalRefs: [] }, certifiedBundle: { catalog,
      evidence: { cli_available_models: ['certified-primary', 'certified-fallback'] } } }),
    evaluateGate: input => {
      log.calls.push({ kind: 'gate' });
      return evaluateGateAndAssertSealed(runTemp, input);
    }, checkHead: async () => { log.calls.push({ kind: 'head' }); return head; },
    postReview: async () => { log.calls.push({ kind: 'post' }); return 0; }, writeOutput: async () => {} });
  assert.equal(reviewResult.status, 'success');
  assert.equal(finalAudit.executed_review_model, 'certified-fallback');
  assert.notEqual(route.selected_model_id, finalAudit.executed_review_model);
  assert.equal(published.published, true, published.reason);
  assert.equal(log.snapshot().posts, 1);
  assert.deepEqual(log.calls.map(call => call.kind), ['host', 'upload', 'gate', 'head', 'post']);
});

test('zero-review enforce is a neutral skip with no decision post, model attempt, or Host spawn', async () => {
  const runTemp = tempDir();
  const targetRoot = tempDir();
  const env = { DECISION_ROUTING_MODE: 'enforce', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', COMMIT_SHA: head,
    TARGET_REPO: 'owner/repo', GITHUB_TOKEN: 'target-token', RUNNER_TEMP: runTemp, TARGET_REPO_PATH: targetRoot,
    OCR_PREVIEW_PATH: join(runTemp, 'preview.json'), BASE_REF: 'main' };
  writeFileSync(env.OCR_PREVIEW_PATH, JSON.stringify({ reviewable_files: [] }));
  const trust = authorizedTrust('enforce');
  const prepared = await prepareRoutingStep({ env, trustedInputs: trust, now: () => timestamp,
    fetchRepoIdentity: async () => ({ id: 7, full_name: 'owner/repo' }), fetchImpl: async () => ({ ok: false, status: 403 }),
    runGit: async (_command, args) => {
      if (args[0] === 'config') return Buffer.from('https://github.com/owner/repo.git\n');
      if (args[0] === 'rev-parse') return Buffer.from(`${head}\n`);
      if (args[0] === 'merge-base') return Buffer.from(`${'b'.repeat(40)}\n`);
      return Buffer.alloc(0);
    } });
  const runBinding = createRunBindingFromEnv(env);
  const route = readSelectedReviewRoute({ runBinding, runTemp });
  const sealedContext = readRoutingExecutionContext({ runTemp, expectedBinding: runBinding });
  const startupCheck = evaluateRoutingStartup({ mode: 'enforce', repoIdentity: { repo_id: 7, full_name: 'owner/repo' },
    registry: trust.registry, operationalDossiers: trust.operationalDossiers, policySha256: trust.policySha256,
    catalogSha256: trust.catalogSha256, sourceManifestSha256: trust.sourceManifestSha256, now: timestamp });
  assert.equal(startupCheck.authorized, true);
  assert.doesNotThrow(() => revalidateRoutingExecutionContext({ context: sealedContext, expectedBinding: runBinding,
    trustedInputs: { ...trust, needsModel: false }, repoIdentity: { repo_id: 7, full_name: 'owner/repo' }, now: timestamp,
    cliBinarySha256: null }));
  const log = effects();
  const decisionRecord = prepared.decisionRecord;
  const reviewResult = await runRoutingReview({ env, expectedBinding: runBinding,
    readRoute: async () => readSelectedReviewRoute({ runBinding, runTemp }), readDecision: async () => decisionRecord,
    fetchCurrentAuthorization: async () => ({ registry: trust.registry, operationalDossiers: trust.operationalDossiers }),
    trustedInputs: trust, repoIdentity: { repo_id: 7, full_name: 'owner/repo' }, now: () => timestamp,
    createRecorder: async ({ catalog }) => {
      log.calls.push({ kind: 'recorder-create' });
      let recorder;
      try {
        recorder = createAttemptRecorder({ runTemp, mode: 'enforce', catalog, runAttempt: runBinding.runAttempt });
      } catch (error) {
        log.calls.push({ kind: 'recorder-error', reason: error.message });
        throw error;
      }
      return { ...recorder, seal: () => { log.calls.push({ kind: 'recorder-seal' }); return recorder.seal(); } };
    },
    runHost: async () => { log.calls.push({ kind: 'host' }); return {}; }, writeResult: async () => { log.calls.push({ kind: 'write-result' }); } });
  assert.equal(reviewResult.status, 'skipped', reviewResult.message);
  assert.deepEqual(log.calls.map(call => call.kind), ['recorder-create', 'recorder-seal', 'write-result']);
  const finalAudit = finalizeRoutingAudit({ decision: decisionRecord, attempts: [], reviewResult, validation: { status: 'passed' },
    headCheck: { status: 'passed' }, runBinding, policy: { repoId: 7, repo: 'owner/repo', prNumber: 4,
      review_scope_gap: false, features_incomplete: false }, catalog: { models: [] } });
  writeRoutingAudit({ runTemp, record: finalAudit, expectedBinding: runBinding });
  const delivery = await uploadSealedFiles(runTemp, log.calls);
  const gate = evaluateGateAndAssertSealed(runTemp, { mode: 'enforce', expectedBinding: runBinding, decisionRecord, finalAudit, delivery,
    checkRunId: 'check-1', startupAuthorization: { authorized: true, approvalRefs: [] }, headSha: head, selectedRoute: route,
    attempts: [], certifiedBundle: null });
  assert.equal(gate.authorized, true, gate.reason);
  assert.deepEqual(log.calls.map(call => call.kind), ['recorder-create', 'recorder-seal', 'write-result', 'upload']);
  assert.deepEqual(log.snapshot(), { decisionPosts: 0, hostSpawns: 0, uploads: 1, posts: 0, threads: 0 });
  assert.deepEqual(finalAudit.attempted_review_models, []);
  assert.equal(finalAudit.executed_review_model, null);
  assert.notEqual(reviewResult.status, 'success');
});

test('failed audit sealing followed by a pre-failed delivery cannot post through publisher', async () => {
  const runTemp = tempDir();
  mkdirSync(join(runTemp, 'ocr-routing'));
  const runBinding = { workflowRunId: '123', runAttempt: 1, headSha: head, mode: 'enforce' };
  const records = emptyReviewRecords(runBinding);
  writeFileSync(join(runTemp, 'ocr-routing', 'decision.json'), JSON.stringify(records.decisionRecord));
  assert.throws(() => finalizeRoutingAudit({}), { message: 'AUDIT_SCHEMA_INVALID' });
  const log = effects();
  const result = await publishAndAssertSealed({ env: { GITHUB_TOKEN: 'token', TARGET_REPO: 'owner/repo', PR_NUMBER: '4' },
    runBinding, runTemp, selectedRoute: { selected_model_id: null, fallback_models: [], reviewable_file_count: 0 },
    attemptRecord: [], finalAudit: records.finalAudit,
    delivery: { outcome: 'failure', artifactId: null, runId: '123', runAttempt: 1 }, checkRunId: 'check-1',
    trustedInputs: { repoIdentity: { repo_id: 7, full_name: 'owner/repo' } }, readExecutionContext: async () => ({}),
    fetchAuthorization: async () => ({ registry: {}, operationalDossiers: {} }),
    revalidateExecutionContext: async () => ({ startupAuthorization: { authorized: true, approvalRefs: [] } }),
    evaluateGate: input => evaluateGateAndAssertSealed(runTemp, input),
    checkHead: async () => { log.calls.push({ kind: 'head' }); return head; },
    postReview: async () => { log.calls.push({ kind: 'post' }); return 0; }, writeOutput: async () => {} });
  assert.equal(result.published, false);
  assert.equal(result.reason, 'ARTIFACT_UPLOAD_FAILED');
  assert.deepEqual(log.calls.map(call => call.kind), []);
});

test('publisher re-reads live authority and never posts after central failure or revocation', async () => {
  const runTemp = tempDir();
  mkdirSync(join(runTemp, 'ocr-routing'));
  writeFileSync(join(runTemp, 'ocr-routing', 'decision.json'), '{}');
  const log = effects();
  const runBinding = { workflowRunId: '123', runAttempt: 1, headSha: head, mode: 'shadow' };
  const common = { env: { GITHUB_TOKEN: 'token', TARGET_REPO: 'owner/repo', PR_NUMBER: '4', GITHUB_OUTPUT: 'unused' },
    runBinding, runTemp, selectedRoute: { reviewable_file_count: 0 }, attemptRecord: [], finalAudit: { repo_id: 7, repo: 'owner/repo' },
    delivery: { outcome: 'success', artifactId: 'artifact' }, checkRunId: 'check-1',
    readExecutionContext: async () => ({}), readCliIdentity: async () => ({ binarySha256: 'a'.repeat(64) }),
    revalidateExecutionContext: async () => ({ startupAuthorization: { authorized: true } }),
    evaluateGate: async () => { log.calls.push({ kind: 'gate' }); return { authorized: true }; },
    checkHead: async () => head, postReview: async () => { log.calls.push({ kind: 'post' }); return 0; }, writeOutput: async () => {} };
  const unavailable = await publishAndAssertSealed({ ...common, fetchAuthorization: async () => { throw new Error('offline'); } });
  assert.equal(unavailable.published, false);
  assert.equal(log.snapshot().posts, 0);
  const revoked = await publishAndAssertSealed({ ...common, fetchAuthorization: async () => ({ registry: {}, operationalDossiers: {} }),
    revalidateExecutionContext: async () => { throw Object.assign(new Error('revoked'), { code: 'ROUTING_ACTIVATION_DENIED' }); } });
  assert.equal(revoked.published, false);
  assert.equal(log.snapshot().posts, 0);
});

test('fresh registry revocation and central REST failures stop upload or post at their live-read boundary', async () => {
  const trust = authorizedTrust('enforce');
  const live = { registry: structuredClone(trust.registry), operationalDossiers: { ...trust.operationalDossiers } };
  const params = { centralRepoId: 1, centralRepoFullName: 'central/repo', protectedRef: 'master', token: 'central-token', now: timestamp };
  const initial = evaluateRoutingStartup({ mode: 'enforce', repoIdentity: { repo_id: 7, full_name: 'owner/repo' },
    registry: live.registry, operationalDossiers: live.operationalDossiers, policySha256: trust.policySha256,
    catalogSha256: trust.catalogSha256, sourceManifestSha256: trust.sourceManifestSha256, now: timestamp });
  assert.equal(initial.authorized, true);
  const uploadLog = effects();
  const uploadApproval = live.registry.approvals.find(item => item.kind === 'security').ref;
  live.registry.revoked_refs.push(uploadApproval);
  const uploadRest = centralRestFetch(live);
  const uploadRead = await fetchCurrentRoutingAuthorization({ ...params, fetchImpl: uploadRest.fetchImpl });
  uploadLog.calls.push({ kind: 'fresh-read', boundary: 'upload' });
  const uploadAuthorization = evaluateRoutingStartup({ mode: 'enforce', repoIdentity: { repo_id: 7, full_name: 'owner/repo' },
    registry: uploadRead.registry, operationalDossiers: uploadRead.operationalDossiers, policySha256: trust.policySha256,
    catalogSha256: trust.catalogSha256, sourceManifestSha256: trust.sourceManifestSha256, now: timestamp });
  assert.equal(uploadAuthorization.reason, 'ROUTING_ACTIVATION_DENIED');
  assert.equal(uploadAuthorization.authorized, false);
  assert.equal(uploadRest.calls.length, 5);
  assert.deepEqual(uploadLog.snapshot(), { decisionPosts: 0, hostSpawns: 0, uploads: 0, posts: 0, threads: 0 });

  const failedUploadRead = await fetchCurrentRoutingAuthorization({ ...params, fetchImpl: centralRestFetch(live, { failStatus: 403 }).fetchImpl });
  assert.equal(failedUploadRead.reason, 'ROUTING_AUTHORITY_UNAVAILABLE');
  assert.equal(uploadLog.calls[0].boundary, 'upload');

  const runTemp = tempDir();
  mkdirSync(join(runTemp, 'ocr-routing'));
  const runBinding = { workflowRunId: '123', runAttempt: 1, headSha: head, mode: 'enforce' };
  const records = emptyReviewRecords(runBinding);
  writeFileSync(join(runTemp, 'ocr-routing', 'decision.json'), JSON.stringify(records.decisionRecord));
  writeRoutingExecutionContext({ runTemp, context: { schema_version: '1', binding: runBinding,
    repo_identity: { repoId: 7, fullName: 'owner/repo', headSha: head }, authorization: {
      policy_sha256: trust.policySha256.slice(7), catalog_sha256: trust.catalogSha256.slice(7),
      source_manifest_sha256: trust.sourceManifestSha256.slice(7), approval_refs: trust.registry.activations[0].approval_refs },
    certification_refs: [], cli_inventory_sha256: null, cli_binary_sha256: null } });
  const postLog = effects();
  postLog.calls.push({ kind: 'upload', outcome: 'success' });
  live.registry.revoked_refs.length = 0;
  const postTrust = { ...trust, centralRepoId: 1, centralRepoFullName: 'central/repo', protectedRef: 'master',
    repoIdentity: { repo_id: 7, full_name: 'owner/repo' } };
  const postRest = centralRestFetch(live);
  const authorizationAfterUpload = await fetchCurrentRoutingAuthorization({ ...params, fetchImpl: postRest.fetchImpl });
  assert.equal(evaluateRoutingStartup({ mode: 'enforce', repoIdentity: { repo_id: 7, full_name: 'owner/repo' },
    registry: authorizationAfterUpload.registry, operationalDossiers: authorizationAfterUpload.operationalDossiers,
    policySha256: trust.policySha256, catalogSha256: trust.catalogSha256,
    sourceManifestSha256: trust.sourceManifestSha256, now: timestamp }).authorized, true);
  live.registry.revoked_refs.push(live.registry.approvals.find(item => item.kind === 'owner_operation').ref);
  const revocationRest = centralRestFetch(live);
  const publishResult = await publishAndAssertSealed({ env: { GITHUB_TOKEN: 'central-token', CENTRAL_GITHUB_TOKEN: 'central-token',
      CENTRAL_REPO_ID: '1', CENTRAL_REPO_FULL_NAME: 'central/repo', TARGET_REPO: 'owner/repo', PR_NUMBER: '4', GITHUB_OUTPUT: 'unused' },
    runBinding, runTemp, selectedRoute: { selected_model_id: null, fallback_models: [], reviewable_file_count: 0 }, attemptRecord: [],
    finalAudit: records.finalAudit, delivery: { outcome: 'success', artifactId: 'artifact', runId: '123', runAttempt: 1 },
    checkRunId: 'check-1', trustedInputs: { ...postTrust, fetchImpl: revocationRest.fetchImpl },
    readExecutionContext: async input => readRoutingExecutionContext({ ...input }),
    now: () => timestamp,
    postReview: async () => { postLog.calls.push({ kind: 'post' }); return 0; }, writeOutput: async () => {} });
  postLog.calls.push({ kind: 'fresh-read', boundary: 'post' });
  assert.equal(publishResult.published, false);
  assert.equal(publishResult.reason, 'ROUTING_ACTIVATION_DENIED');
  assert.equal(postRest.calls.length, 5);
  assert.deepEqual(postLog.calls.map(call => call.kind), ['upload', 'fresh-read']);
  assert.equal(postLog.snapshot().posts, 0);

  const failedPost = await publishAndAssertSealed({ env: { GITHUB_TOKEN: 'token', TARGET_REPO: 'owner/repo', PR_NUMBER: '4' },
    runBinding, runTemp, selectedRoute: { selected_model_id: null, fallback_models: [], reviewable_file_count: 0 }, attemptRecord: [],
    finalAudit: records.finalAudit, delivery: { outcome: 'success', artifactId: 'artifact', runId: '123', runAttempt: 1 },
    checkRunId: 'check-1', trustedInputs: { ...postTrust, fetchImpl: centralRestFetch(live, { failStatus: 429 }).fetchImpl },
    readExecutionContext: async () => readRoutingExecutionContext({ runTemp, expectedBinding: runBinding }),
    postReview: async () => { postLog.calls.push({ kind: 'post' }); return 0; }, writeOutput: async () => {} });
  assert.equal(failedPost.published, false);
  assert.equal(failedPost.reason, 'ROUTING_AUTHORITY_UNAVAILABLE');
  assert.equal(postLog.snapshot().posts, 0);
});

test('upload, missing artifact, malformed result, scope, check-ID, and changed-HEAD failures do not post', async () => {
  const runTemp = tempDir();
  mkdirSync(join(runTemp, 'ocr-routing'));
  const runBinding = { workflowRunId: '123', runAttempt: 1, headSha: head, mode: 'enforce' };
  const { decisionRecord, finalAudit } = emptyReviewRecords(runBinding);
  writeFileSync(join(runTemp, 'ocr-routing', 'decision.json'), JSON.stringify(decisionRecord));
  writeFileSync(join(runTemp, 'ocr-routing', 'final.json'), JSON.stringify(finalAudit));
  writeFileSync(join(runTemp, 'ocr-routing', 'attempts.ndjson'), '');
  const route = { selected_model_id: null, fallback_models: [], reviewable_file_count: 0 };
  const log = effects();
  const base = { env: { GITHUB_TOKEN: 'token', TARGET_REPO: 'owner/repo', PR_NUMBER: '4', GITHUB_OUTPUT: 'unused',
      OCR_RESULT_PATH: join(runTemp, 'review.json') }, runBinding, runTemp, selectedRoute: route, attemptRecord: [], finalAudit,
    delivery: { outcome: 'success', artifactId: 'artifact', runId: '123', runAttempt: 1 }, checkRunId: 'check-1',
    trustedInputs: { repoIdentity: { repo_id: 7, full_name: 'owner/repo' } }, readExecutionContext: async () => ({}),
    fetchAuthorization: async () => ({ registry: {}, operationalDossiers: {} }),
    revalidateExecutionContext: async () => ({ startupAuthorization: { authorized: true, approvalRefs: [] } }),
    evaluateGate: evaluatePublishEligibility, writeOutput: async () => {},
    checkHead: async () => { log.calls.push({ kind: 'head' }); return head; },
    postReview: async () => { log.calls.push({ kind: 'post' }); return 0; } };
  const cases = [
    ['upload failure', { delivery: { outcome: 'failure', artifactId: null, runId: '123', runAttempt: 1 } }, finalAudit, 'check-1', 'ARTIFACT_UPLOAD_FAILED'],
    ['missing upload file', { delivery: { outcome: 'failure', artifactId: null, runId: '123', runAttempt: 1 } }, finalAudit, 'check-1', 'ARTIFACT_UPLOAD_FAILED'],
    ['missing artifact', { delivery: { outcome: 'success', artifactId: '', runId: '123', runAttempt: 1 } }, finalAudit, 'check-1', 'MISSING_ARTIFACT_ID'],
    ['malformed result file', { delivery: { outcome: 'success', artifactId: 'fake-artifact-id', runId: '123', runAttempt: 1 } }, finalAudit, 'check-1', 'PUBLISH_FAILED'],
    ['scope gap', {}, { ...finalAudit, review_scope_gap: true }, 'check-1', 'REVIEW_SCOPE_GAP_BLOCKED'],
    ['missing check id', {}, finalAudit, null, 'CHECK_RUN_MISSING'],
  ];
  for (const [name, override, audit, checkRunId, reason] of cases) {
    let publicationInput = override;
    if (name === 'missing upload file') {
      const fakeUploader = path => {
        try {
          readFileSync(path);
          log.calls.push({ kind: 'upload', outcome: 'success' });
          return { outcome: 'success', artifactId: 'artifact', runId: '123', runAttempt: 1 };
        } catch (error) {
          log.calls.push({ kind: 'upload', outcome: 'failure', reason: error.code });
          return { outcome: 'failure', artifactId: null, runId: '123', runAttempt: 1 };
        }
      };
      publicationInput = { delivery: fakeUploader(join(runTemp, 'missing-review.json')) };
    }
    if (name === 'malformed result file') {
      writeFileSync(base.env.OCR_RESULT_PATH, '{invalid');
      publicationInput = { delivery: { ...await uploadSealedFiles(runTemp, log.calls), artifactId: 'fake-artifact-id' },
        postReview: async input => {
          log.calls.push({ kind: 'post-adapter', args: input.args });
          return postOcrComments({ args: input.args, token: 'offline-token' });
        } };
    }
    const outcome = await publishAndAssertSealed({ ...base, ...publicationInput, finalAudit: audit, checkRunId });
    assert.equal(outcome.published, false, name);
    assert.equal(outcome.reason, reason, `${name} boundary reason`);
  }
  const changedHead = await publishAndAssertSealed({ ...base, checkHead: async () => { log.calls.push({ kind: 'head' }); return 'f'.repeat(40); } });
  assert.equal(changedHead.published, false);
  assert.equal(changedHead.reason, 'HEAD_MISMATCH');
  assert.equal(log.snapshot().posts, 0);
});

test('Gate evaluation is read-only and rejects absent check identity and failed delivery', () => {
  const runTemp = tempDir();
  mkdirSync(join(runTemp, 'ocr-routing'));
  const expectedBinding = { workflowRunId: '123', runAttempt: 1, headSha: head, mode: 'enforce' };
  const { decisionRecord, finalAudit } = emptyReviewRecords(expectedBinding);
  const base = { mode: 'enforce', expectedBinding, decisionRecord, finalAudit, checkRunId: 'check-1',
    startupAuthorization: { authorized: true, approvalRefs: ['OWNER-VALID'] }, headSha: head,
    selectedRoute: { selected_model_id: null, fallback_models: [], reviewable_file_count: 0 }, attempts: [], certifiedBundle: null };
  const failedDelivery = evaluateGateAndAssertSealed(runTemp, { ...base,
    delivery: { outcome: 'failure', artifactId: null, runId: '123', runAttempt: 1 } });
  assert.equal(failedDelivery.authorized, false);
  assert.equal(failedDelivery.reason, 'ARTIFACT_UPLOAD_FAILED');
  const missingCheck = evaluateGateAndAssertSealed(runTemp, { ...base,
    delivery: { outcome: 'success', artifactId: 'artifact', runId: '123', runAttempt: 1 }, checkRunId: null });
  assert.equal(missingCheck.authorized, false);
  assert.equal(missingCheck.reason, 'CHECK_RUN_MISSING');
});

test('readCheckoutIdentity rejects an isolated checkout with a different HEAD', async () => {
  const root = tempDir();
  const actualHead = commitRepo(root);
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', 'https://github.com/owner/repo.git']);
  assert.match(actualHead, /^[0-9a-f]{40}$/);
  assert.notEqual(actualHead, head);
  assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '# repo\n');
  await assert.rejects(readCheckoutIdentity({ cwd: root, expectedRepo: 'owner/repo', expectedHeadSha: head }),
    { message: 'CHECKOUT_IDENTITY_MISMATCH' });
});
