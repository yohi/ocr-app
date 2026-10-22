import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const DENIED = () => ({ authorized: false, reason: 'ROUTING_ACTIVATION_DENIED', approvalRefs: [] });
const AUTHORITY_UNAVAILABLE = Object.freeze({ authorized: false, reason: 'ROUTING_AUTHORITY_UNAVAILABLE' });
const KINDS = new Set(['owner_operation', 'security', 'audit_operation', 'g1', 'g2', 'g3', 'g4', 'model', 'cli_inventory']);
const OPERATIONAL_KINDS = new Set(['owner_operation', 'security', 'audit_operation']);
const STAGE_KINDS = {
  shadow: ['owner_operation', 'security', 'audit_operation', 'g1'],
  enforce: ['owner_operation', 'security', 'audit_operation', 'g1', 'g2', 'g3', 'g4'],
};
const REGISTRY_KEYS = ['schema_version', 'approvals', 'activations', 'revoked_refs'];
const APPROVAL_KEYS = ['ref', 'kind', 'repo_id', 'full_name', 'subject_sha256', 'issued_at', 'expires_at'];
const ACTIVATION_KEYS = ['repo_id', 'full_name', 'mode', 'issued_at', 'expires_at', 'policy_sha256', 'catalog_sha256', 'approval_refs'];
const DOSSIER_KEYS = [
  'schema_version', 'ref', 'kind', 'issuer', 'owner_decision', 'repo_id', 'full_name', 'allowed_modes',
  'allowed_effects', 'source_manifest_sha256', 'policy_sha256', 'catalog_sha256', 'issued_at', 'expires_at', 'revocation_ref',
];
const HASH = /^sha256:[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const REFERENCE = /^OWNER-[A-Z0-9][A-Z0-9._-]{0,95}$/;
const REPO_FULL_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function exactObject(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key) && value[key] !== undefined);
}

function validDate(value) {
  return typeof value === 'string' && DATE.test(value) && new Date(value).toISOString() === value;
}

function activeWindow(record, now) {
  return validDate(record.issued_at) && validDate(record.expires_at)
    && Date.parse(record.issued_at) <= Date.parse(now) && Date.parse(now) < Date.parse(record.expires_at);
}

function uniqueStrings(values) {
  return Array.isArray(values) && values.every((value) => typeof value === 'string') && new Set(values).size === values.length;
}

function exactStringSet(values, expected) {
  return uniqueStrings(values) && values.length === expected.length && expected.every((value) => values.includes(value));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseRegistry(registry) {
  if (!exactObject(registry, REGISTRY_KEYS) || registry.schema_version !== '1'
    || !Array.isArray(registry.approvals) || !Array.isArray(registry.activations)
    || !uniqueStrings(registry.revoked_refs) || registry.revoked_refs.some((ref) => !REFERENCE.test(ref))) return null;
  const refs = new Set();
  for (const approval of registry.approvals) {
    if (!exactObject(approval, APPROVAL_KEYS) || !REFERENCE.test(approval.ref) || refs.has(approval.ref)
      || !KINDS.has(approval.kind) || !Number.isSafeInteger(approval.repo_id) || approval.repo_id < 1
      || typeof approval.full_name !== 'string' || !REPO_FULL_NAME.test(approval.full_name) || !HASH.test(approval.subject_sha256)
      || !validDate(approval.issued_at) || !validDate(approval.expires_at)) return null;
    refs.add(approval.ref);
  }
  for (const activation of registry.activations) {
    if (!exactObject(activation, ACTIVATION_KEYS) || !['shadow', 'enforce'].includes(activation.mode)
      || !Number.isSafeInteger(activation.repo_id) || activation.repo_id < 1
      || typeof activation.full_name !== 'string' || !REPO_FULL_NAME.test(activation.full_name)
      || !HASH.test(activation.policy_sha256) || !HASH.test(activation.catalog_sha256)
      || !validDate(activation.issued_at) || !validDate(activation.expires_at)
      || Date.parse(activation.issued_at) >= Date.parse(activation.expires_at) || !uniqueStrings(activation.approval_refs)
      || activation.approval_refs.some((ref) => !REFERENCE.test(ref))) return null;
  }
  return registry;
}

function validDossier(dossier, approval, activation, input, now) {
  let bytes;
  let value = dossier;
  if (typeof dossier === 'string' || Buffer.isBuffer(dossier) || dossier instanceof Uint8Array) {
    bytes = Buffer.from(dossier);
    try { value = JSON.parse(bytes.toString('utf8')); } catch { return false; }
  } else {
    try { bytes = Buffer.from(JSON.stringify(dossier)); } catch { return false; }
  }
  if (!exactObject(value, DOSSIER_KEYS) || value.schema_version !== '1' || value.ref !== approval.ref
    || value.kind !== approval.kind || value.issuer !== 'owner' || value.owner_decision !== 'approve'
    || value.revocation_ref !== approval.ref || value.repo_id !== activation.repo_id || value.full_name !== activation.full_name
    || !exactStringSet(value.allowed_modes, ['shadow', 'enforce']) || !value.allowed_modes.includes(activation.mode)
    || !exactStringSet(value.allowed_effects, ['routing'])
    || value.source_manifest_sha256 !== input.sourceManifestSha256 || value.policy_sha256 !== input.policySha256
    || value.catalog_sha256 !== input.catalogSha256 || !activeWindow(value, now)) return false;
  return approval.subject_sha256 === `sha256:${sha256(bytes)}`;
}

export function evaluateRoutingStartup(input) {
  try {
    if (!exactObject(input, ['mode', 'repoIdentity', 'registry', 'operationalDossiers', 'policySha256', 'catalogSha256', 'sourceManifestSha256', 'now'])
      || !['shadow', 'enforce'].includes(input.mode) || !exactObject(input.repoIdentity, ['repo_id', 'full_name'])
      || !Number.isSafeInteger(input.repoIdentity.repo_id) || input.repoIdentity.repo_id < 1
      || typeof input.repoIdentity.full_name !== 'string' || !REPO_FULL_NAME.test(input.repoIdentity.full_name)
      || !HASH.test(input.policySha256) || !HASH.test(input.catalogSha256) || !HASH.test(input.sourceManifestSha256)
      || !validDate(input.now) || !input.operationalDossiers || typeof input.operationalDossiers !== 'object'
      || Array.isArray(input.operationalDossiers) || Object.getPrototypeOf(input.operationalDossiers) !== Object.prototype) return DENIED();
    const registry = parseRegistry(input.registry);
    if (!registry) return DENIED();
    const activation = registry.activations.find((entry) => entry.mode === input.mode
      && entry.repo_id === input.repoIdentity.repo_id && entry.full_name === input.repoIdentity.full_name
      && entry.policy_sha256 === input.policySha256 && entry.catalog_sha256 === input.catalogSha256 && activeWindow(entry, input.now));
    if (!activation || !uniqueStrings(activation.approval_refs)) return DENIED();
    const needed = STAGE_KINDS[input.mode];
    const selected = activation.approval_refs.map((ref) => registry.approvals.find((item) => item.ref === ref));
    if (selected.some((item) => !item) || selected.length !== needed.length
      || needed.some((kind) => selected.filter((approval) => approval.kind === kind).length !== 1)
      || selected.some((approval) => !needed.includes(approval.kind) || approval.repo_id !== activation.repo_id
        || approval.full_name !== activation.full_name || registry.revoked_refs.includes(approval.ref) || !activeWindow(approval, input.now))) return DENIED();
    for (const approval of selected) {
      if (OPERATIONAL_KINDS.has(approval.kind)) {
        const dossier = input.operationalDossiers[approval.ref];
        if (!validDossier(dossier, approval, activation, input, input.now)) return DENIED();
      } else if (approval.kind === 'basic_policy_approved' || (/^g[1-4]$/.test(approval.kind) && approval.subject_sha256 !== input.sourceManifestSha256)) return DENIED();
    }
    return { authorized: true, reason: 'ROUTING_ACTIVATION_AUTHORIZED', approvalRefs: activation.approval_refs.slice() };
  } catch {
    return DENIED();
  }
}

const MANIFEST_FIXED = [
  '.github/workflows/ocr-engine.yml', '.github/workflows/package.json', '.github/workflows/package-lock.json',
  '.github/workflows/config/review-risk-policy.json', '.github/workflows/config/decision-egress-policy.json',
  '.github/workflows/config/review-model-catalog.json', '.github/workflows/config/review-model-catalog.schema.json',
];

export function hashRoutingSourceManifest({ trustedRoot, readFile, listTrackedPaths }) {
  if (typeof trustedRoot !== 'string' || typeof readFile !== 'function' || typeof listTrackedPaths !== 'function') throw new Error('ROUTING_SOURCE_MANIFEST_INVALID');
  const tracked = listTrackedPaths(trustedRoot);
  if (!Array.isArray(tracked) || !tracked.every((path) => typeof path === 'string')) throw new Error('ROUTING_SOURCE_MANIFEST_INVALID');
  const selected = new Set(MANIFEST_FIXED);
  for (const path of tracked) if (path.startsWith('.github/workflows/scripts/')) selected.add(path);
  const scriptPaths = tracked.filter((path) => path.startsWith('.github/workflows/scripts/'));
  if (new Set(tracked).size !== tracked.length || new Set(scriptPaths).size !== scriptPaths.length
    || MANIFEST_FIXED.some((path) => !tracked.includes(path))) throw new Error('ROUTING_SOURCE_MANIFEST_INVALID');
  const lines = [...selected].sort().map((path) => {
    const absolute = resolve(trustedRoot, path);
    const rel = relative(resolve(trustedRoot), absolute);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`) || rel !== path) throw new Error('ROUTING_SOURCE_MANIFEST_INVALID');
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('ROUTING_SOURCE_MANIFEST_INVALID');
    const data = readFile(path, trustedRoot);
    if (!(Buffer.isBuffer(data) || data instanceof Uint8Array)) throw new Error('ROUTING_SOURCE_MANIFEST_INVALID');
    if (typeof data.isSymbolicLink === 'function' && data.isSymbolicLink()) throw new Error('ROUTING_SOURCE_MANIFEST_INVALID');
    return `${path} ${sha256(data)}\n`;
  }).join('');
  return `sha256:${sha256(Buffer.from(lines, 'utf8'))}`;
}

async function getJson(url, token, fetchImpl, timeoutSignal, maxBytes = 65536) {
  const response = await fetchImpl(url, {
    method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: timeoutSignal,
  });
  if (!response?.ok) throw new Error('unavailable');
  const contentLength = response.headers?.get?.('content-length');
  if (contentLength !== null && contentLength !== undefined
    && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) throw new Error('unavailable');
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error('unavailable');
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!(value instanceof Uint8Array)) throw new Error('unavailable');
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new Error('unavailable');
    }
    chunks.push(Buffer.from(value));
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length));
  return JSON.parse(text);
}

function decodeContent(response, expectedPath) {
  if (response?.type !== 'file' || response.path !== expectedPath || typeof response.content !== 'string' || response.encoding !== 'base64') throw new Error('unavailable');
  const encoded = response.content.replace(/\n/g, '');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw new Error('unavailable');
  return bytes;
}

export async function fetchCurrentRoutingAuthorization({ centralRepoId, centralRepoFullName, protectedRef, token, fetchImpl, now }) {
  try {
    if (!Number.isSafeInteger(centralRepoId) || centralRepoId < 1 || typeof centralRepoFullName !== 'string'
      || !REPO_FULL_NAME.test(centralRepoFullName) || protectedRef !== 'master'
      || typeof token !== 'string' || !token || typeof fetchImpl !== 'function' || !validDate(now)) return AUTHORITY_UNAVAILABLE;
    const [owner, repo] = centralRepoFullName.split('/');
    const root = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const signal = AbortSignal.timeout(10000);
    const identity = await getJson(root, token, fetchImpl, signal);
    if (!identity || identity.id !== centralRepoId || identity.full_name !== centralRepoFullName
      || typeof identity.full_name !== 'string' || !REPO_FULL_NAME.test(identity.full_name)) return AUTHORITY_UNAVAILABLE;
    const base = `${root}/contents/.github/workflows/config`;
    const registryPath = '.github/workflows/config/routing-authorization.json';
    const registryBytes = decodeContent(await getJson(`${base}/routing-authorization.json?ref=master`, token, fetchImpl, signal, 262144), registryPath);
    if (registryBytes.length > 262144) return AUTHORITY_UNAVAILABLE;
    const registry = JSON.parse(registryBytes.toString('utf8'));
    if (!parseRegistry(registry) || registry.approvals.length > 128) return AUTHORITY_UNAVAILABLE;
    const refs = new Set(registry.approvals.filter((item) => OPERATIONAL_KINDS.has(item.kind)).map((item) => item.ref));
    const operationalDossiers = {};
    for (const ref of refs) {
      const path = `.github/workflows/config/routing-approvals/${ref}.json`;
      const dossier = decodeContent(await getJson(`${root}/contents/${path}?ref=master`, token, fetchImpl, signal), path);
      if (dossier.length > 65536) return AUTHORITY_UNAVAILABLE;
      const value = JSON.parse(dossier.toString('utf8'));
      const approval = registry.approvals.find((item) => item.ref === ref);
      if (!approval || !exactObject(value, DOSSIER_KEYS) || value.schema_version !== '1'
        || value.ref !== ref || value.kind !== approval.kind) return AUTHORITY_UNAVAILABLE;
      operationalDossiers[ref] = dossier;
    }
    return { registry, operationalDossiers };
  } catch {
    return AUTHORITY_UNAVAILABLE;
  }
}
