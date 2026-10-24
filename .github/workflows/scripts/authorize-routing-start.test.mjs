import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { authorizeRoutingStart } from './authorize-routing-start.mjs';
import { hashRoutingSourceManifest } from './routing-authorization.mjs';

const timestamp = '2026-10-21T12:00:00.000Z';
const issuedAt = '2026-10-21T11:00:00.000Z';
const expiresAt = '2026-10-21T13:00:00.000Z';
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const root = process.cwd();

function currentHashes() {
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  return {
    sourceManifestSha256: hashRoutingSourceManifest({
      trustedRoot: root,
      readFile: path => readFileSync(resolve(root, path)),
      listTrackedPaths: () => tracked,
    }),
    policySha256: digest(readFileSync(resolve(root, '.github/workflows/config/decision-egress-policy.json'))),
    catalogSha256: digest(readFileSync(resolve(root, '.github/workflows/config/review-model-catalog.json'))),
  };
}

function authorizedAuthority(mode) {
  const repoIdentity = { repo_id: 2, full_name: 'target/repo' };
  const hashes = currentHashes();
  const kinds = ['owner_operation', 'security', 'audit_operation', 'g1'];
  if (mode === 'enforce') kinds.push('g2', 'g3', 'g4');
  const approvals = [];
  const operationalDossiers = {};
  for (const kind of kinds) {
    const ref = `OWNER-${kind.toUpperCase().replaceAll('_', '-')}`;
    const dossier = {
      schema_version: '1', ref, kind, issuer: 'owner', owner_decision: 'approve',
      repo_id: repoIdentity.repo_id, full_name: repoIdentity.full_name,
      allowed_modes: ['shadow', 'enforce'], allowed_effects: ['routing'],
      source_manifest_sha256: hashes.sourceManifestSha256,
      policy_sha256: hashes.policySha256, catalog_sha256: hashes.catalogSha256,
      issued_at: issuedAt, expires_at: expiresAt, revocation_ref: ref,
    };
    const dossierBytes = Buffer.from(JSON.stringify(dossier));
    approvals.push({
      ref, kind, repo_id: repoIdentity.repo_id, full_name: repoIdentity.full_name,
      subject_sha256: kind.startsWith('g') ? hashes.sourceManifestSha256 : digest(dossierBytes),
      issued_at: issuedAt, expires_at: expiresAt,
    });
    if (!kind.startsWith('g')) operationalDossiers[ref] = dossierBytes;
  }
  return {
    registry: {
      schema_version: '1', approvals, revoked_refs: [],
      activations: [{
        repo_id: repoIdentity.repo_id, full_name: repoIdentity.full_name, mode,
        issued_at: issuedAt, expires_at: expiresAt,
        policy_sha256: hashes.policySha256, catalog_sha256: hashes.catalogSha256,
        approval_refs: approvals.map(approval => approval.ref),
      }],
    },
    operationalDossiers,
  };
}

function baseInput(overrides = {}) {
  const outputs = [];
  const calls = [];
  const configReads = [];
  return {
    outputs, calls, configReads,
    input: {
      env: {
        DECISION_ROUTING_MODE: 'shadow', GITHUB_TOKEN: 'central-token', TARGET_TOKEN: 'target-app-token',
        GITHUB_REPOSITORY: 'central/repo', TARGET_REPO: 'target/repo', SELF_REPO_PATH: root,
        GITHUB_OUTPUT: '/tmp/output',
      },
      now: () => timestamp,
      writeOutput: value => outputs.push(`ROUTING_START_AUTHORIZED=${value}`),
      readTrustedConfig: async () => {
        configReads.push(true);
        return { centralRepo: 'central/repo', protectedRef: 'master' };
      },
      fetchRepoIdentity: async ({ owner, repo, token }) => {
        calls.push(['identity', owner, repo, token]);
        return { id: owner === 'central' ? 1 : 2, full_name: `${owner}/${repo}` };
      },
      fetchCurrentAuthorization: async args => {
        calls.push(['authorization', args]);
        return { registry: { schema_version: '1', approvals: [], activations: [], revoked_refs: [] }, operationalDossiers: {} };
      },
      ...overrides,
    },
  };
}

test('startup step denies absent approvals and writes the exact false output', async () => {
  const { input, outputs, calls } = baseInput();
  await assert.rejects(authorizeRoutingStart(input), { message: 'ROUTING_ACTIVATION_DENIED' });
  assert.deepEqual(outputs, ['ROUTING_START_AUTHORIZED=false']);
  assert.equal(calls.filter(([kind]) => kind === 'authorization').length, 1);
  assert.equal(calls.find(([kind]) => kind === 'authorization')[1].token, 'central-token');
});

test('shadow and enforce startup authorize populated registries and write true exactly', async () => {
  for (const mode of ['shadow', 'enforce']) {
    const { input, outputs } = baseInput({ fetchCurrentAuthorization: async () => authorizedAuthority(mode) });
    input.env.DECISION_ROUTING_MODE = mode;
    await authorizeRoutingStart(input);
    assert.deepEqual(outputs, ['ROUTING_START_AUTHORIZED=true']);
  }
});

test('central identity and authority reads use github token; target identity uses App token', async () => {
  const { input, calls } = baseInput();
  await assert.rejects(authorizeRoutingStart(input), { message: 'ROUTING_ACTIVATION_DENIED' });
  assert.deepEqual(calls.filter(([kind]) => kind === 'identity').map(([, owner, , token]) => [owner, token]), [
    ['central', 'central-token'], ['target', 'target-app-token'],
  ]);
  assert.equal(calls.find(([kind]) => kind === 'authorization')[1].token, 'central-token');
});

test('off skips config reads, both GitHub GETs, and output writes', async () => {
  const { input, outputs, calls, configReads } = baseInput();
  input.env.DECISION_ROUTING_MODE = 'off';
  await authorizeRoutingStart(input);
  assert.equal(configReads.length, 0);
  assert.equal(calls.length, 0);
  assert.deepEqual(outputs, []);
});

test('unknown mode rejects before config reads and output writes', async () => {
  const { input, outputs, calls, configReads } = baseInput();
  input.env.DECISION_ROUTING_MODE = 'invalid';
  await assert.rejects(authorizeRoutingStart(input), { message: 'ROUTING_ACTIVATION_DENIED' });
  assert.equal(configReads.length, 0);
  assert.equal(calls.length, 0);
  assert.deepEqual(outputs, []);
});

test('missing target App token denies before identity GET and still writes false once', async () => {
  const { input, outputs, calls } = baseInput();
  delete input.env.TARGET_TOKEN;
  await assert.rejects(authorizeRoutingStart(input), { message: 'ROUTING_ACTIVATION_DENIED' });
  assert.deepEqual(outputs, ['ROUTING_START_AUTHORIZED=false']);
  assert.equal(calls.length, 0);
});
