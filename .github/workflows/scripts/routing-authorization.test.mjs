import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  evaluateRoutingStartup,
  fetchCurrentRoutingAuthorization,
  hashRoutingSourceManifest,
} from './routing-authorization.mjs';

const digest = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const repoIdentity = { repo_id: 42, full_name: 'owner/repo' };
const now = '2026-10-21T12:00:00.000Z';
const context = { policySha256: digest('policy'), catalogSha256: digest('catalog'), sourceManifestSha256: digest('source') };
const requiredShadow = ['owner_operation', 'security', 'audit_operation', 'g1'];

function fixture(kinds = requiredShadow) {
  const approvals = [];
  const operationalDossiers = {};
  for (const [index, kind] of kinds.entries()) {
    const ref = `OWNER-${kind.toUpperCase().replaceAll('_', '-')}`;
    const dossier = {
      schema_version: '1', ref, kind, issuer: 'owner', owner_decision: 'approve',
      repo_id: repoIdentity.repo_id, full_name: repoIdentity.full_name,
      allowed_modes: ['shadow', 'enforce'], allowed_effects: ['routing'],
      source_manifest_sha256: context.sourceManifestSha256,
      policy_sha256: context.policySha256, catalog_sha256: context.catalogSha256,
      issued_at: '2026-10-21T11:00:00.000Z', expires_at: '2026-10-21T13:00:00.000Z',
      revocation_ref: ref,
    };
    const dossierBytes = Buffer.from(JSON.stringify(dossier));
    operationalDossiers[ref] = dossierBytes;
    approvals.push({
      ref, kind, repo_id: repoIdentity.repo_id, full_name: repoIdentity.full_name,
      subject_sha256: kind === 'g1' || /^g[234]$/.test(kind) ? context.sourceManifestSha256 : digest(dossierBytes),
      issued_at: dossier.issued_at, expires_at: dossier.expires_at,
    });
  }
  const activation = {
    repo_id: repoIdentity.repo_id, full_name: repoIdentity.full_name, mode: 'shadow',
    issued_at: '2026-10-21T11:00:00.000Z', expires_at: '2026-10-21T13:00:00.000Z',
    policy_sha256: context.policySha256, catalog_sha256: context.catalogSha256,
    approval_refs: approvals.map((approval) => approval.ref),
  };
  return {
    input: { mode: 'shadow', repoIdentity, registry: { schema_version: '1', approvals, activations: [activation], revoked_refs: [] }, operationalDossiers, ...context, now },
    approvals, operationalDossiers, activation,
  };
}

test('valid shadow grants only shadow and enforce requires all stage approvals', () => {
  const { input } = fixture();
  assert.deepEqual(evaluateRoutingStartup(input), {
    authorized: true, reason: 'ROUTING_ACTIVATION_AUTHORIZED',
    approvalRefs: input.registry.activations[0].approval_refs,
  });
  assert.equal(evaluateRoutingStartup({ ...input, mode: 'enforce' }).authorized, false);
  const enforceKinds = [...requiredShadow, 'g2', 'g3', 'g4'];
  assert.equal(evaluateRoutingStartup({ ...fixture(enforceKinds).input, mode: 'enforce', registry: {
    ...fixture(enforceKinds).input.registry,
    activations: [{ ...fixture(enforceKinds).activation, mode: 'enforce' }],
  } }).authorized, true);
});

test('empty default registry and basic policy approval do not authorize startup', async () => {
  const defaultRegistry = JSON.parse(readFileSync(new URL('../config/routing-authorization.json', import.meta.url), 'utf8'));
  const empty = evaluateRoutingStartup({ ...fixture().input, registry: defaultRegistry });
  assert.equal(empty.authorized, false);
  assert.equal(empty.reason, 'ROUTING_ACTIVATION_DENIED');

  const basic = fixture();
  basic.approvals[3].kind = 'basic_policy_approved';
  assert.equal(evaluateRoutingStartup(basic.input).authorized, false);
});

test('startup rejects missing stale revoked wrong-scope and wrong-stage approvals', () => {
  const { input } = fixture();
  const cases = [
    {},
    { ...input, now: input.registry.activations[0].expires_at },
    { ...input, registry: { ...input.registry, revoked_refs: [input.registry.approvals[0].ref] } },
    { ...input, repoIdentity: { repo_id: 43, full_name: 'owner/repo' } },
    { ...input, repoIdentity: { repo_id: 42, full_name: 'Owner/repo' } },
    { ...input, sourceManifestSha256: digest('changed') },
    { ...input, policySha256: digest('changed') },
    { ...input, catalogSha256: digest('changed') },
    { ...fixture(requiredShadow.filter((kind) => kind !== 'security')).input },
    { ...fixture(requiredShadow.filter((kind) => kind !== 'audit_operation')).input },
  ];
  const wrongIssuer = fixture();
  const issuerDossier = JSON.parse(wrongIssuer.operationalDossiers['OWNER-OWNER-OPERATION'].toString());
  issuerDossier.issuer = 'not-owner';
  wrongIssuer.operationalDossiers['OWNER-OWNER-OPERATION'] = Buffer.from(JSON.stringify(issuerDossier));
  wrongIssuer.approvals[0].subject_sha256 = digest(wrongIssuer.operationalDossiers['OWNER-OWNER-OPERATION']);
  cases.push({ ...wrongIssuer.input, operationalDossiers: wrongIssuer.operationalDossiers });
  const altered = fixture();
  const alteredDossier = JSON.parse(altered.operationalDossiers['OWNER-SECURITY'].toString());
  alteredDossier.repo_id = 43;
  altered.operationalDossiers['OWNER-SECURITY'] = Buffer.from(JSON.stringify(alteredDossier));
  altered.approvals[1].subject_sha256 = digest(altered.operationalDossiers['OWNER-SECURITY']);
  cases.push({ ...altered.input, operationalDossiers: altered.operationalDossiers });
  const changedSubject = fixture();
  changedSubject.approvals[0].subject_sha256 = digest('altered-dossier-bytes');
  cases.push({ ...changedSubject.input, registry: { ...changedSubject.input.registry, approvals: changedSubject.approvals } });
  cases.push({ ...input, registry: { ...input.registry, approvals: [...input.registry.approvals, input.registry.approvals[0]] } });
  cases.push({ ...input, registry: Object.assign(Object.create({ inherited: true }), input.registry) });
  cases.push({ ...input, registry: { ...input.registry, surprise: true } });
  cases.push({ ...input, policySha256: undefined });
  cases.push({ ...input, repoIdentity: { repo_id: 42, full_name: 'owner/repo/extra' } });
  assert.equal(evaluateRoutingStartup(cases[1]).reason, 'ROUTING_ACTIVATION_DENIED');
  for (const candidate of cases) assert.equal(evaluateRoutingStartup(candidate).authorized, false);
});

test('operational dossiers reject non-exact allowed mode and effect sets', () => {
  for (const [key, value] of [
    ['allowed_modes', ['shadow', 'enforce', 'off']],
    ['allowed_modes', ['shadow', 'shadow']],
    ['allowed_modes', ['shadow', 1]],
    ['allowed_effects', ['routing', 'publish']],
    ['allowed_effects', ['routing', 'routing']],
    ['allowed_effects', [1]],
  ]) {
    const candidate = fixture();
    const ref = 'OWNER-OWNER-OPERATION';
    const dossier = JSON.parse(candidate.operationalDossiers[ref].toString());
    dossier[key] = value;
    candidate.operationalDossiers[ref] = Buffer.from(JSON.stringify(dossier));
    candidate.approvals[0].subject_sha256 = digest(candidate.operationalDossiers[ref]);
    assert.equal(evaluateRoutingStartup(candidate.input).authorized, false);
  }
});

test('source manifest hashes sorted tracked paths and raw file bytes', () => {
  const tracked = [
    '.github/workflows/ocr-engine.yml', '.github/workflows/package.json', '.github/workflows/package-lock.json',
    '.github/workflows/config/review-risk-policy.json', '.github/workflows/config/decision-egress-policy.json',
    '.github/workflows/config/review-model-catalog.json', '.github/workflows/config/review-model-catalog.schema.json',
    '.github/workflows/scripts/z.mjs', '.github/workflows/scripts/a.mjs',
  ];
  const root = mkdtempSync(join(tmpdir(), 'routing-manifest-'));
  try {
    for (const path of tracked) {
      const absolute = join(root, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, path.endsWith('/z.mjs') ? 'z' : path.endsWith('/a.mjs') ? 'a' : path);
    }
    const readFile = (path) => readFileSync(join(root, path));
    const hash = hashRoutingSourceManifest({ trustedRoot: root, readFile, listTrackedPaths: () => tracked });
    const expected = createHash('sha256').update([...tracked].sort().map((path) => `${path} ${createHash('sha256').update(readFile(path)).digest('hex')}\n`).join('')).digest('hex');
    assert.equal(hash, `sha256:${expected}`);
    writeFileSync(join(root, '.github/workflows/scripts/a.mjs'), 'b');
    assert.notEqual(hashRoutingSourceManifest({ trustedRoot: root, readFile, listTrackedPaths: () => tracked }), hash);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('source manifest rejects duplicates, missing files, and symlinks', () => {
  const one = '.github/workflows/ocr-engine.yml';
  const tracked = [
    one, '.github/workflows/package.json', '.github/workflows/package-lock.json',
    '.github/workflows/config/review-risk-policy.json', '.github/workflows/config/decision-egress-policy.json',
    '.github/workflows/config/review-model-catalog.json', '.github/workflows/config/review-model-catalog.schema.json',
  ];
  assert.throws(() => hashRoutingSourceManifest({ trustedRoot: '/trusted', readFile: () => Buffer.from('x'), listTrackedPaths: () => [...tracked, one] }));
  assert.throws(() => hashRoutingSourceManifest({ trustedRoot: '/trusted', readFile: () => { throw new Error('missing'); }, listTrackedPaths: () => tracked }));
  const root = mkdtempSync(join(tmpdir(), 'routing-symlink-'));
  try {
    for (const path of tracked.slice(1)) {
      const absolute = join(root, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, 'x');
    }
    mkdirSync(dirname(join(root, one)), { recursive: true });
    const target = join(root, 'target');
    writeFileSync(target, 'x');
    symlinkSync(target, join(root, one));
    assert.throws(() => hashRoutingSourceManifest({ trustedRoot: root, readFile: (path) => readFileSync(join(root, path)), listTrackedPaths: () => tracked }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('central authorization fetch fails closed for HTTP errors, timeout, and identity mismatch', async () => {
  for (const status of [403, 404, 429, 500]) {
    const result = await fetchCurrentRoutingAuthorization({
      centralRepoId: 9, centralRepoFullName: 'central/repo', protectedRef: 'master', token: 'token',
      fetchImpl: async () => new Response('', { status }), now,
    });
    assert.deepEqual(result, { authorized: false, reason: 'ROUTING_AUTHORITY_UNAVAILABLE' });
  }
  const timeout = await fetchCurrentRoutingAuthorization({
    centralRepoId: 9, centralRepoFullName: 'central/repo', protectedRef: 'master', token: 'token',
    fetchImpl: async () => { throw new Error('timeout'); }, now,
  });
  assert.deepEqual(timeout, { authorized: false, reason: 'ROUTING_AUTHORITY_UNAVAILABLE' });
  let mismatchCalls = 0;
  const mismatch = await fetchCurrentRoutingAuthorization({
    centralRepoId: 9, centralRepoFullName: 'central/repo', protectedRef: 'master', token: 'token',
    fetchImpl: async () => { mismatchCalls += 1; return new Response(JSON.stringify({ id: 9, full_name: 'Central/repo' })); }, now,
  });
  assert.deepEqual(mismatch, { authorized: false, reason: 'ROUTING_AUTHORITY_UNAVAILABLE' });
  assert.equal(mismatchCalls, 1);
});

test('central authority rejects malformed JSON and oversized bodies before further requests', async () => {
  for (const response of [
    new Response('{'),
    new Response('x'.repeat(65537), { headers: { 'content-length': '65537' } }),
  ]) {
    let calls = 0;
    const result = await fetchCurrentRoutingAuthorization({
      centralRepoId: 9, centralRepoFullName: 'central/repo', protectedRef: 'master', token: 'token',
      fetchImpl: async () => { calls += 1; return response; }, now,
    });
    assert.deepEqual(result, { authorized: false, reason: 'ROUTING_AUTHORITY_UNAVAILABLE' });
    assert.equal(calls, 1);
  }
  let cancelled = false;
  let calls = 0;
  const result = await fetchCurrentRoutingAuthorization({
    centralRepoId: 9, centralRepoFullName: 'central/repo', protectedRef: 'master', token: 'token',
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        headers: new Headers(),
        body: new ReadableStream({
          start(controller) { controller.enqueue(new Uint8Array(65537)); },
          cancel() { cancelled = true; },
        }),
      };
    }, now,
  });
  assert.deepEqual(result, { authorized: false, reason: 'ROUTING_AUTHORITY_UNAVAILABLE' });
  assert.equal(calls, 1);
  assert.equal(cancelled, true);
});

test('central authority uses authenticated fixed-ref GETs and returns exact raw dossiers', async () => {
  const { input } = fixture();
  const registryBytes = Buffer.from(JSON.stringify(input.registry));
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === 'https://api.github.com/repos/central/repo') {
      return new Response(JSON.stringify({ id: 9, full_name: 'central/repo' }));
    }
    const dossierRef = url.endsWith('routing-approvals/OWNER-OWNER-OPERATION.json?ref=master')
      ? 'OWNER-OWNER-OPERATION'
      : url.endsWith('routing-approvals/OWNER-SECURITY.json?ref=master') ? 'OWNER-SECURITY' : 'OWNER-AUDIT-OPERATION';
    if (url.endsWith('routing-authorization.json?ref=master')) {
      return new Response(JSON.stringify({ type: 'file', path: '.github/workflows/config/routing-authorization.json', encoding: 'base64', content: registryBytes.toString('base64') }));
    }
    const bytes = input.operationalDossiers[dossierRef];
    return new Response(JSON.stringify({ type: 'file', path: `.github/workflows/config/routing-approvals/${dossierRef}.json`, encoding: 'base64', content: bytes.toString('base64') }));
  };
  const result = await fetchCurrentRoutingAuthorization({ centralRepoId: 9, centralRepoFullName: 'central/repo', protectedRef: 'master', token: 'token', fetchImpl, now });
  assert.equal(Object.hasOwn(result, 'authorized'), false);
  assert.equal(Object.hasOwn(result, 'reason'), false);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(({ options }) => options.method === 'GET' && options.headers.Authorization === 'Bearer token'));
  assert.ok(calls.every(({ url }) => url.includes('ref=master') || url === 'https://api.github.com/repos/central/repo'));
  assert.equal(Buffer.isBuffer(result.operationalDossiers['OWNER-OWNER-OPERATION']), true);
  const startup = evaluateRoutingStartup({ ...input, registry: result.registry, operationalDossiers: result.operationalDossiers });
  assert.equal(startup.authorized, true);
});
