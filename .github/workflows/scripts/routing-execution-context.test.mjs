import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, lstatSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readRoutingExecutionContext, revalidateRoutingExecutionContext, writeRoutingExecutionContext } from './routing-execution-context.mjs';

const binding = { workflowRunId: '9007199254740993', runAttempt: 2, headSha: 'a'.repeat(40), mode: 'shadow' };
const hash = 'b'.repeat(64);
const context = { schema_version: '1', binding, repo_identity: { repoId: 10, fullName: 'org/repo', headSha: binding.headSha },
  authorization: { policy_sha256: hash, catalog_sha256: hash, source_manifest_sha256: hash, approval_refs: [] },
  certification_refs: [], cli_inventory_sha256: hash, cli_binary_sha256: hash };
const now = '2026-01-01T00:00:00.000Z';

function authorizedInputs(needsModel = false) {
  const expires = '2027-01-01T00:00:00.000Z';
  const kinds = ['owner_operation', 'security', 'audit_operation', 'g1'];
  const dossiers = {};
  const approvals = kinds.map((kind, index) => {
    const ref = `OWNER-TEST-${index}`;
    let subject = `sha256:${hash}`;
    if (index < 3) {
      const dossier = { schema_version: '1', ref, kind, issuer: 'owner', owner_decision: 'approve', repo_id: 10,
        full_name: 'org/repo', allowed_modes: ['shadow', 'enforce'], allowed_effects: ['routing'],
        source_manifest_sha256: `sha256:${hash}`, policy_sha256: `sha256:${hash}`, catalog_sha256: `sha256:${hash}`,
        issued_at: '2025-01-01T00:00:00.000Z', expires_at: expires, revocation_ref: ref };
      const bytes = Buffer.from(JSON.stringify(dossier));
      subject = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      dossiers[ref] = bytes;
    }
    return { ref, kind, repo_id: 10, full_name: 'org/repo', subject_sha256: subject,
      issued_at: '2025-01-01T00:00:00.000Z', expires_at: expires };
  });
  return { needsModel, policySha256: `sha256:${hash}`, catalogSha256: `sha256:${hash}`,
    sourceManifestSha256: `sha256:${hash}`, registry: { schema_version: '1', approvals, revoked_refs: [],
      activations: [{ repo_id: 10, full_name: 'org/repo', mode: 'shadow', issued_at: '2025-01-01T00:00:00.000Z',
        expires_at: expires, policy_sha256: `sha256:${hash}`, catalog_sha256: `sha256:${hash}`, approval_refs: approvals.map(item => item.ref) }] },
    operationalDossiers: dossiers };
}

function contextFor(inputs, nullCli = true) {
  return { ...context, authorization: { policy_sha256: inputs.policySha256.slice(7), catalog_sha256: inputs.catalogSha256.slice(7),
    source_manifest_sha256: inputs.sourceManifestSha256.slice(7), approval_refs: inputs.registry.activations[0].approval_refs },
    cli_inventory_sha256: nullCli ? null : hash, cli_binary_sha256: nullCli ? null : hash };
}

test('writes private context atomically without overwrite and reads exact run binding', () => {
  const dir = mkdtempSync(join(tmpdir(), 'routing-context-'));
  try {
    writeRoutingExecutionContext({ runTemp: dir, context });
    const path = join(dir, 'ocr-routing-execution-context.json');
    assert.equal(lstatSync(path).mode & 0o777, 0o600);
    assert.equal(readRoutingExecutionContext({ runTemp: dir, expectedBinding: binding }).binding.workflowRunId, '9007199254740993');
    assert.throws(() => writeRoutingExecutionContext({ runTemp: dir, context }), { code: 'ROUTING_EXECUTION_CONTEXT_INVALID' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rejects malformed, linked, oversized and run-mismatched context before consumer activity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'routing-context-'));
  const path = join(dir, 'ocr-routing-execution-context.json');
  try {
    writeFileSync(path, '{');
    assert.throws(() => readRoutingExecutionContext({ runTemp: dir, expectedBinding: binding }), { code: 'ROUTING_EXECUTION_CONTEXT_INVALID' });
    rmSync(path);
    writeFileSync(join(dir, 'elsewhere'), JSON.stringify(context));
    symlinkSync(join(dir, 'elsewhere'), path);
    assert.throws(() => readRoutingExecutionContext({ runTemp: dir, expectedBinding: binding }), { code: 'ROUTING_EXECUTION_CONTEXT_INVALID' });
    rmSync(path);
    writeFileSync(path, ' '.repeat(65 * 1024));
    assert.throws(() => readRoutingExecutionContext({ runTemp: dir, expectedBinding: binding }), { code: 'ROUTING_EXECUTION_CONTEXT_INVALID' });
    assert.throws(() => readRoutingExecutionContext({ runTemp: dir, expectedBinding: { ...binding, runAttempt: 3 } }), { code: 'ROUTING_EXECUTION_CONTEXT_INVALID' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rejects altered hashes, unexpected keys and authorization without invoking consumer callbacks', () => {
  const calls = { evidence: 0 };
  const inputs = { needsModel: false, policySha256: hash, catalogSha256: hash, sourceManifestSha256: hash,
    registry: {}, operationalDossiers: {}, readEvidence: () => { calls.evidence += 1; } };
  const args = { context, expectedBinding: binding, trustedInputs: inputs,
    repoIdentity: { repo_id: 10, full_name: 'org/repo' }, now: '2026-01-01T00:00:00.000Z', cliBinarySha256: hash };
  assert.throws(() => revalidateRoutingExecutionContext({ ...args, context: { ...context, extra: true } }), { code: 'ROUTING_EXECUTION_CONTEXT_INVALID' });
  assert.throws(() => revalidateRoutingExecutionContext({ ...args, context: { ...context, authorization: { ...context.authorization, catalog_sha256: 'c'.repeat(64) } } }), { code: 'ROUTING_EXECUTION_CONTEXT_INVALID' });
  assert.throws(() => revalidateRoutingExecutionContext(args), { code: 'ROUTING_ACTIVATION_DENIED' });
  assert.equal(calls.evidence, 0);
});

test('rejects changed CLI digest before loading certification', () => {
  const trustedInputs = authorizedInputs(true);
  let loadCertificationCalls = 0;
  trustedInputs.readEvidence = () => { loadCertificationCalls += 1; throw new Error('unexpected evidence read'); };
  const args = { context: contextFor(trustedInputs, false), expectedBinding: binding,
    trustedInputs, repoIdentity: { repo_id: 10, full_name: 'org/repo' }, now, cliBinarySha256: 'c'.repeat(64) };
  assert.throws(() => revalidateRoutingExecutionContext(args), { code: 'ROUTING_EXECUTION_CONTEXT_INVALID' });
  assert.equal(loadCertificationCalls, 0);
});

test('rejects incorrect binding types and each retry, head and mode mismatch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'routing-context-'));
  const path = join(dir, 'ocr-routing-execution-context.json');
  try {
    for (const [key, value] of [['workflowRunId', 9007199254740993], ['runAttempt', '2']]) {
      writeFileSync(path, JSON.stringify({ ...context, binding: { ...binding, [key]: value } }));
      assert.throws(() => readRoutingExecutionContext({ runTemp: dir, expectedBinding: binding }), { code: 'ROUTING_EXECUTION_CONTEXT_INVALID' });
    }
    for (const changed of [{ runAttempt: 3 }, { headSha: 'd'.repeat(40) }, { mode: 'enforce' }]) {
      assert.throws(() => readRoutingExecutionContext({ runTemp: dir, expectedBinding: { ...binding, ...changed } }), { code: 'ROUTING_EXECUTION_CONTEXT_INVALID' });
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('fresh startup validation denies stale/expired or revoked approval inputs', () => {
  const args = { context, expectedBinding: binding,
    trustedInputs: { needsModel: false, policySha256: hash, catalogSha256: hash, sourceManifestSha256: hash,
      registry: {}, operationalDossiers: {} }, repoIdentity: { repo_id: 10, full_name: 'org/repo' },
    now: '2026-01-01T00:00:00.000Z', cliBinarySha256: hash };
  assert.throws(() => revalidateRoutingExecutionContext({ ...args,
    trustedInputs: { ...args.trustedInputs, sourceManifestSha256: 'c'.repeat(64) } }), { code: 'ROUTING_EXECUTION_CONTEXT_INVALID' });
  assert.throws(() => revalidateRoutingExecutionContext(args), { code: 'ROUTING_ACTIVATION_DENIED' });
});

test('writes, reads and revalidates a null-CLI shadow context without certification', () => {
  const dir = mkdtempSync(join(tmpdir(), 'routing-context-'));
  const trustedInputs = authorizedInputs(false);
  const nullCliContext = contextFor(trustedInputs);
  try {
    writeRoutingExecutionContext({ runTemp: dir, context: nullCliContext });
    const read = readRoutingExecutionContext({ runTemp: dir, expectedBinding: binding });
    const result = revalidateRoutingExecutionContext({ context: read, expectedBinding: binding,
      trustedInputs, repoIdentity: { repo_id: 10, full_name: 'org/repo' }, now, cliBinarySha256: null });
    assert.deepEqual(Object.keys(result).sort(), ['certifiedBundle', 'startupAuthorization']);
    assert.equal(result.certifiedBundle, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('requires non-null CLI fields for model proof', () => {
  const trustedInputs = authorizedInputs(true);
  const nullCliContext = contextFor(trustedInputs);
  assert.throws(() => revalidateRoutingExecutionContext({ context: nullCliContext, expectedBinding: binding,
    trustedInputs, repoIdentity: { repo_id: 10, full_name: 'org/repo' }, now, cliBinarySha256: null }),
  { code: 'ROUTING_EXECUTION_CONTEXT_INVALID' });
});

test('returns the trusted catalog and verified model evidence as the certified bundle', () => {
  const trustedInputs = authorizedInputs(true);
  const evidence = new Map();
  const modelId = 'model-a';
  const capabilityBytes = Buffer.from('approved capability evidence');
  const capabilityHash = createHash('sha256').update(capabilityBytes).digest('hex');
  const certification = {
    schema_version: '1', model_id: modelId, capability_tier: 'deep', catalog_version: '2.0.0',
    issued_at: '2026-01-01T00:00:00.000Z', expires_at: '2027-01-01T00:00:00.000Z',
    capability_evidence_sha256: capabilityHash, cli_evidence_sha256: 'c'.repeat(64),
  };
  const certificationBytes = Buffer.from(JSON.stringify(certification));
  const certificationHash = createHash('sha256').update(certificationBytes).digest('hex');
  const inventoryBytes = Buffer.from(JSON.stringify({
    schema_version: '1', cli_version: '9.0.0', cli_binary_sha256: hash, models: [modelId],
    observed_at: '2026-01-01T00:00:00.000Z', expires_at: '2027-01-01T00:00:00.000Z',
  }));
  const inventoryHash = createHash('sha256').update(inventoryBytes).digest('hex');
  const catalog = { catalog_version: '2.0.0', models: [{ model_id: modelId, capability_tier: 'deep', catalog_version: '2.0.0', certification_status: 'certified', certification_reference: `sha256:${certificationHash}` }] };
  trustedInputs.catalog = catalog;
  trustedInputs.index = { schema_version: '1', certifications: [{ path: 'certification.json', sha256: certificationHash, approval_ref: 'OWNER-CERT' }], cli_inventory: { path: 'inventory.json', sha256: inventoryHash, approval_ref: 'OWNER-CLI' } };
  for (const [path, bytes] of [['certification.json', certificationBytes], ['inventory.json', inventoryBytes]]) evidence.set(path, bytes);
  trustedInputs.readEvidence = path => evidence.get(path);
  trustedInputs.registry.approvals.push(
    { ref: 'OWNER-CERT', kind: 'model', repo_id: 10, full_name: 'org/repo', subject_sha256: `sha256:${certificationHash}`, issued_at: '2026-01-01T00:00:00.000Z', expires_at: '2027-01-01T00:00:00.000Z' },
    { ref: 'OWNER-CAPABILITY', kind: 'model', repo_id: 10, full_name: 'org/repo', subject_sha256: `sha256:${capabilityHash}`, issued_at: '2026-01-01T00:00:00.000Z', expires_at: '2027-01-01T00:00:00.000Z' },
    { ref: 'OWNER-CLI', kind: 'cli_inventory', repo_id: 10, full_name: 'org/repo', subject_sha256: `sha256:${inventoryHash}`, issued_at: '2026-01-01T00:00:00.000Z', expires_at: '2027-01-01T00:00:00.000Z' },
  );
  const authorizedContext = { ...contextFor(trustedInputs, false), certification_refs: [`sha256:${certificationHash}`], cli_inventory_sha256: inventoryHash };
  const result = revalidateRoutingExecutionContext({ context: authorizedContext, expectedBinding: binding,
    trustedInputs, repoIdentity: { repo_id: 10, full_name: 'org/repo' }, now, cliBinarySha256: hash });
  assert.deepEqual(result.certifiedBundle, {
    catalog,
    evidence: {
      certification_refs: [{ certification_reference: `sha256:${certificationHash}`, model_id: modelId, capability_tier: 'deep', catalog_version: '2.0.0' }],
      cli_available_models: [modelId],
    },
  });
});

test('rejects an expired approval during fresh revalidation', () => {
  const trustedInputs = authorizedInputs(false);
  trustedInputs.registry.approvals[0].expires_at = '2025-12-31T23:59:59.000Z';
  assert.throws(() => revalidateRoutingExecutionContext({ context: contextFor(trustedInputs),
    expectedBinding: binding, trustedInputs, repoIdentity: { repo_id: 10, full_name: 'org/repo' }, now, cliBinarySha256: null }),
  { code: 'ROUTING_ACTIVATION_DENIED' });
});

test('rejects a freshly revoked startup approval', () => {
  const trustedInputs = authorizedInputs(false);
  const approvedContext = contextFor(trustedInputs);
  trustedInputs.registry.revoked_refs.push(approvedContext.authorization.approval_refs[0]);
  assert.throws(() => revalidateRoutingExecutionContext({ context: approvedContext, expectedBinding: binding,
    trustedInputs, repoIdentity: { repo_id: 10, full_name: 'org/repo' }, now, cliBinarySha256: null }),
  { code: 'ROUTING_ACTIVATION_DENIED' });
});

test('cleanup failure does not replace normalized write failure', () => {
  const fileSystem = {
    writeFileSync() { throw new Error('write failed'); },
    linkSync() { throw new Error('must not link'); },
    unlinkSync() { throw new Error('cleanup failed'); },
  };
  assert.throws(() => writeRoutingExecutionContext({ runTemp: '/tmp/run', context, fileSystem }),
    { code: 'ROUTING_EXECUTION_CONTEXT_INVALID' });
});
