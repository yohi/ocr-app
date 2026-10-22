import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadVerifiedCertification, readInstalledCliIdentity } from './load-review-certification.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const NOW = '2026-01-01T00:00:00.000Z';
const EXPIRY = '2027-01-01T00:00:00.000Z';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'certification-'));
  const home = mkdtempSync(join(tmpdir(), 'agy-home-'));
  mkdirSync(join(home, '.local/bin'), { recursive: true });
  const evidence = new Map();
  const binary = Buffer.from('binary');
  const certification = {
    schema_version: '1', model_id: 'model-a', capability_tier: 'fast', catalog_version: '2.0.0',
    issued_at: NOW, expires_at: EXPIRY, capability_evidence_sha256: hash(Buffer.from('capability dossier')),
    cli_evidence_sha256: hash(Buffer.from('cli evidence')),
  };
  const certBytes = Buffer.from(JSON.stringify(certification));
  const inventory = {
    schema_version: '1', cli_version: '9.0.0', cli_binary_sha256: hash(binary),
    models: ['model-a'], observed_at: NOW, expires_at: EXPIRY,
  };
  const inventoryBytes = Buffer.from(JSON.stringify(inventory));
  evidence.set('cert.json', certBytes);
  evidence.set('inventory.json', inventoryBytes);
  evidence.set('capability.json', Buffer.from('capability dossier'));
  writeFileSync(join(root, 'cert.json'), certBytes);
  writeFileSync(join(root, 'inventory.json'), inventoryBytes);
  writeFileSync(join(root, 'capability.json'), evidence.get('capability.json'));
  writeFileSync(join(home, '.local/bin/agy'), binary, { mode: 0o755 });
  chmodSync(join(home, '.local/bin/agy'), 0o755);
  const registry = {
    schema_version: '1', revoked_refs: [], activations: [],
    approvals: [
      { ref: 'OWNER-CERT', kind: 'model', repo_id: 1, full_name: 'org/repo', subject_sha256: `sha256:${hash(certBytes)}`, issued_at: NOW, expires_at: EXPIRY },
      { ref: 'OWNER-CAPABILITY', kind: 'model', repo_id: 1, full_name: 'org/repo', subject_sha256: `sha256:${certification.capability_evidence_sha256}`, issued_at: NOW, expires_at: EXPIRY },
      { ref: 'OWNER-CLI', kind: 'cli_inventory', repo_id: 1, full_name: 'org/repo', subject_sha256: `sha256:${hash(inventoryBytes)}`, issued_at: NOW, expires_at: EXPIRY },
    ],
  };
  const index = {
    schema_version: '1',
    certifications: [{ path: 'cert.json', sha256: hash(certBytes), approval_ref: 'OWNER-CERT' }],
    cli_inventory: { path: 'inventory.json', sha256: hash(inventoryBytes), approval_ref: 'OWNER-CLI' },
  };
  const catalog = { catalog_version: '2.0.0', models: [{ model_id: 'model-a', capability_tier: 'fast', catalog_version: '2.0.0', certification_status: 'certified', certification_reference: `sha256:${hash(certBytes)}` }] };
  const readEvidence = path => {
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular evidence file');
    return evidence.get(path) ?? readFileSync(absolute);
  };
  return { root, home, binary, evidence, certification, inventory, registry, index, catalog, readEvidence };
}

function refreshCertification(f) {
  const bytes = Buffer.from(JSON.stringify(f.certification));
  f.evidence.set('cert.json', bytes);
  writeFileSync(join(f.root, 'cert.json'), bytes);
  f.index.certifications[0].sha256 = hash(bytes);
  f.registry.approvals.find(item => item.ref === 'OWNER-CERT').subject_sha256 = `sha256:${hash(bytes)}`;
  f.catalog.models[0] = {
    ...f.catalog.models[0], certification_reference: `sha256:${hash(bytes)}`,
  };
  return bytes;
}

function refreshInventory(f) {
  const bytes = Buffer.from(JSON.stringify(f.inventory));
  f.evidence.set('inventory.json', bytes);
  writeFileSync(join(f.root, 'inventory.json'), bytes);
  f.index.cli_inventory.sha256 = hash(bytes);
  f.registry.approvals.find(item => item.ref === 'OWNER-CLI').subject_sha256 = `sha256:${hash(bytes)}`;
}

function verify(f, overrides = {}) {
  return loadVerifiedCertification({
    catalog: f.catalog, index: f.index, registry: f.registry, repoIdentity: { repo_id: 1, full_name: 'org/repo' },
    now: NOW, readEvidence: f.readEvidence, cliBinarySha256: hash(f.binary), ...overrides,
  });
}

function cleanup(f) {
  rmSync(f.root, { recursive: true, force: true });
  rmSync(f.home, { recursive: true, force: true });
}

test('rejects catalog self-endorsement without approved index evidence', () => {
  assert.throws(() => loadVerifiedCertification({ catalog: { models: [{ certification_status: 'certified', certification_reference: 'sha256:fake' }] } }), { message: 'REVIEW_CERTIFICATION_INVALID' });
});

test('returns exactly resolver evidence for valid certification, capability dossier, and inventory approvals', () => {
  const f = fixture();
  try {
    assert.deepEqual(verify(f), {
      verifiedCertificationRefs: [{ certification_reference: f.catalog.models[0].certification_reference, model_id: 'model-a', capability_tier: 'fast', catalog_version: '2.0.0' }],
      cliAvailableModels: ['model-a'],
    });
  } finally { cleanup(f); }
});

test('rejects tampered bytes and expired or revoked owner approvals', () => {
  for (const mutate of [
    f => {
      const tampered = Buffer.concat([f.evidence.get('cert.json'), Buffer.from(' ')]);
      f.evidence.set('cert.json', tampered);
      writeFileSync(join(f.root, 'cert.json'), tampered);
    },
    f => { f.registry.approvals[0].expires_at = NOW; },
    f => { f.registry.revoked_refs.push('OWNER-CERT'); },
    f => { f.registry.revoked_refs.push('OWNER-CAPABILITY'); },
  ]) {
    const f = fixture();
    try { mutate(f); assert.throws(() => verify(f), { message: 'REVIEW_CERTIFICATION_INVALID' }); }
    finally { cleanup(f); }
  }
});

test('rejects wrong model, tier, and version after refreshed evidence and approval digests', () => {
  for (const field of ['model_id', 'capability_tier', 'catalog_version']) {
    const f = fixture();
    try {
      f.certification[field] = field === 'model_id' ? 'other-model' : field === 'capability_tier' ? 'deep' : '9.9.9';
      refreshCertification(f);
      if (field === 'model_id') {
        f.inventory.models = ['other-model'];
        refreshInventory(f);
      }
      assert.throws(() => verify(f), { message: 'REVIEW_CERTIFICATION_INVALID' });
    } finally { cleanup(f); }
  }
});

test('accepts the current repository approval when another repository shares the capability digest', () => {
  const f = fixture();
  try {
    const capabilityApproval = f.registry.approvals.find(approval => approval.ref === 'OWNER-CAPABILITY');
    f.registry.approvals.push({ ...capabilityApproval, ref: 'OWNER-CAPABILITY-OTHER', repo_id: 2, full_name: 'other/repo' });
    assert.doesNotThrow(() => verify(f));
  } finally { cleanup(f); }
});

test('accepts the active approval when an expired approval shares its repository and capability digest', () => {
  const f = fixture();
  try {
    const capabilityApproval = f.registry.approvals.find(approval => approval.ref === 'OWNER-CAPABILITY');
    f.registry.approvals.push({ ...capabilityApproval, ref: 'OWNER-CAPABILITY-OLD', expires_at: NOW });
    assert.doesNotThrow(() => verify(f));
  } finally { cleanup(f); }
});

test('rejects duplicate active approvals for the same capability digest and repository', () => {
  const f = fixture();
  try {
    const capabilityApproval = f.registry.approvals.find(approval => approval.ref === 'OWNER-CAPABILITY');
    f.registry.approvals.push({ ...capabilityApproval, ref: 'OWNER-CAPABILITY-DUPLICATE' });
    assert.throws(() => verify(f), { message: 'REVIEW_CERTIFICATION_INVALID' });
  } finally { cleanup(f); }
});

test('rejects cross-repository certification, capability, and inventory approvals', () => {
  for (const reference of ['OWNER-CERT', 'OWNER-CAPABILITY', 'OWNER-CLI']) {
    const f = fixture();
    try {
      f.registry.approvals.find(approval => approval.ref === reference).full_name = 'other/repo';
      assert.throws(() => verify(f), { message: 'REVIEW_CERTIFICATION_INVALID' });
    } finally { cleanup(f); }
  }
});

test('rejects path traversal, absolute paths, and symlink evidence', () => {
  const f = fixture();
  try {
    f.index.certifications[0].path = '../outside.json';
    assert.throws(() => verify(f), { message: 'REVIEW_CERTIFICATION_INVALID' });
    f.index.certifications[0].path = '/outside.json';
    assert.throws(() => verify(f), { message: 'REVIEW_CERTIFICATION_INVALID' });
    writeFileSync(join(f.root, 'link.json'), 'not evidence');
    symlinkSync(join(f.root, 'link.json'), join(f.root, 'alias.json'));
    f.index.certifications[0].path = 'alias.json';
    assert.throws(() => verify(f), { message: 'REVIEW_CERTIFICATION_INVALID' });
  } finally { cleanup(f); }
});

test('rejects evidence files larger than 64 KiB', () => {
  const f = fixture();
  try {
    f.evidence.set('cert.json', Buffer.alloc(65_537));
    writeFileSync(join(f.root, 'cert.json'), f.evidence.get('cert.json'));
    f.index.certifications[0].sha256 = hash(f.evidence.get('cert.json'));
    assert.throws(() => verify(f), { message: 'REVIEW_CERTIFICATION_INVALID' });
  } finally { cleanup(f); }
});

test('rejects duplicate inventory IDs after refreshing inventory and approval digests', () => {
  const f = fixture();
  try {
    f.inventory.models = ['model-a', 'model-a'];
    refreshInventory(f);
    assert.throws(() => verify(f), { message: 'REVIEW_CERTIFICATION_INVALID' });
  } finally { cleanup(f); }
});

test('rejects a wrong installed CLI binary digest', () => {
  const f = fixture();
  try { assert.throws(() => verify(f, { cliBinarySha256: '0'.repeat(64) }), { message: 'REVIEW_CERTIFICATION_INVALID' }); }
  finally { cleanup(f); }
});

test('reads the installed executable identity and rejects target-checkout and swapped PATH executables', () => {
  const f = fixture();
  try {
    const identity = readInstalledCliIdentity({ env: { HOME: f.home, PATH: join(f.root, 'path') }, targetRoot: f.root });
    assert.equal(identity.resolvedPath, realpathSync(join(f.home, '.local/bin/agy')));
    assert.equal(identity.binarySha256, hash(f.binary));
    assert.throws(() => readInstalledCliIdentity({ env: { HOME: f.root }, targetRoot: f.root }), { message: 'REVIEW_CLI_UNAVAILABLE' });
    assert.throws(() => readInstalledCliIdentity({ env: { HOME: f.home }, targetRoot: f.root, resolveExecutable: () => join(f.root, 'path/agy') }), { message: 'REVIEW_CLI_UNAVAILABLE' });
  } finally { cleanup(f); }
});

test('fails closed when CLI resolution or file reads fail', () => {
  const f = fixture();
  try {
    assert.throws(() => readInstalledCliIdentity({ env: { HOME: f.home }, targetRoot: f.root, resolveExecutable: () => { throw new Error('missing'); } }), { message: 'REVIEW_CLI_UNAVAILABLE' });
    assert.throws(() => readInstalledCliIdentity({ env: { HOME: f.home }, targetRoot: f.root, readFile: () => { throw new Error('unreadable'); } }), { message: 'REVIEW_CLI_UNAVAILABLE' });
  } finally { cleanup(f); }
});

test('CLI inventory reports approved model IDs and no live provider capacity claim', () => {
  const f = fixture();
  try {
    const result = verify(f);
    assert.deepEqual(result.cliAvailableModels, ['model-a']);
    assert.equal(Object.hasOwn(result, 'liveProviderCapacity'), false);
  } finally { cleanup(f); }
});
