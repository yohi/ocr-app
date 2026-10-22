import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';

const EVIDENCE_LIMIT = 65_536;
const CLI_LIMIT = 256 * 1024 * 1024;
const HASH = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const INDEX_KEYS = ['schema_version', 'certifications', 'cli_inventory'];
const REF_KEYS = ['path', 'sha256', 'approval_ref'];
const CERTIFICATION_KEYS = ['schema_version', 'model_id', 'capability_tier', 'catalog_version', 'issued_at', 'expires_at', 'capability_evidence_sha256', 'cli_evidence_sha256'];
const INVENTORY_KEYS = ['schema_version', 'cli_version', 'cli_binary_sha256', 'models', 'observed_at', 'expires_at'];
const APPROVAL_KEYS = ['ref', 'kind', 'repo_id', 'full_name', 'subject_sha256', 'issued_at', 'expires_at'];

function certificationFailure() {
  throw new Error('REVIEW_CERTIFICATION_INVALID');
}

function cliFailure() {
  throw new Error('REVIEW_CLI_UNAVAILABLE');
}

function exactObject(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key) && value[key] !== undefined);
}

function validDate(value) {
  return typeof value === 'string' && DATE.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function active(issuedAt, expiresAt, now) {
  return validDate(issuedAt) && validDate(expiresAt) && Date.parse(issuedAt) <= Date.parse(now)
    && Date.parse(now) < Date.parse(expiresAt);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseJson(bytes) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return certificationFailure();
  }
}

function validateEvidencePath(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\')
    || path.split('/').some(part => !part || part === '.' || part === '..')
    || normalize(path) !== path || path.startsWith('/')) return certificationFailure();
  return path;
}

function readEvidenceBytes(path, expectedHash, readEvidence) {
  validateEvidencePath(path);
  if (typeof expectedHash !== 'string' || !HASH.test(expectedHash)) return certificationFailure();
  const bytes = readEvidence(path);
  if (!(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array) || bytes.byteLength > EVIDENCE_LIMIT
    || sha256(bytes) !== expectedHash) return certificationFailure();
  return Buffer.from(bytes);
}

function findApproval(registry, reference, kind, subjectDigest, repoIdentity, now) {
  if (!exactObject(registry, ['schema_version', 'approvals', 'activations', 'revoked_refs'])
    || registry.schema_version !== '1' || !Array.isArray(registry.approvals) || !Array.isArray(registry.revoked_refs)
    || !registry.revoked_refs.every(ref => typeof ref === 'string')) return certificationFailure();
  const validApprovals = registry.approvals.filter(approval => exactObject(approval, APPROVAL_KEYS)
    && !registry.revoked_refs.includes(approval.ref)
    && approval.repo_id === repoIdentity.repo_id && approval.full_name === repoIdentity.full_name
    && active(approval.issued_at, approval.expires_at, now)
    && approval.kind === kind && approval.subject_sha256 === `sha256:${subjectDigest}`
    && (reference === null || approval.ref === reference));
  if (validApprovals.length !== 1) return certificationFailure();
  return validApprovals[0];
}

export function loadVerifiedCertification({ catalog, index, registry, repoIdentity, now, readEvidence, cliBinarySha256 }) {
  try {
    if (!exactObject(index, INDEX_KEYS) || index.schema_version !== '1' || !Array.isArray(index.certifications)
      || !index.certifications.every(entry => exactObject(entry, REF_KEYS))
      || !exactObject(index.cli_inventory, REF_KEYS) || !exactObject(repoIdentity, ['repo_id', 'full_name'])
      || !Number.isSafeInteger(repoIdentity.repo_id) || repoIdentity.repo_id < 1
      || typeof repoIdentity.full_name !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoIdentity.full_name)
      || !validDate(now) || typeof readEvidence !== 'function'
      || !Array.isArray(catalog?.models) || typeof catalog.catalog_version !== 'string'
      || typeof cliBinarySha256 !== 'string' || !HASH.test(cliBinarySha256)) return certificationFailure();

    const cliRef = index.cli_inventory;
    const inventoryBytes = readEvidenceBytes(cliRef.path, cliRef.sha256, readEvidence);
    const inventory = parseJson(inventoryBytes);
    if (!exactObject(inventory, INVENTORY_KEYS) || inventory.schema_version !== '1'
      || typeof inventory.cli_version !== 'string' || !inventory.cli_version
      || typeof inventory.cli_binary_sha256 !== 'string' || !HASH.test(inventory.cli_binary_sha256)
      || inventory.cli_binary_sha256 !== cliBinarySha256
      || !Array.isArray(inventory.models) || !inventory.models.every(model => typeof model === 'string' && model.length > 0)
      || new Set(inventory.models).size !== inventory.models.length
      || !active(inventory.observed_at, inventory.expires_at, now)) return certificationFailure();
    findApproval(registry, cliRef.approval_ref, 'cli_inventory', sha256(inventoryBytes), repoIdentity, now);

    const verifiedCertificationRefs = index.certifications.map(entry => {
      const bytes = readEvidenceBytes(entry.path, entry.sha256, readEvidence);
      const certification = parseJson(bytes);
      if (!exactObject(certification, CERTIFICATION_KEYS) || certification.schema_version !== '1'
        || typeof certification.model_id !== 'string' || !certification.model_id
        || !['fast', 'deep'].includes(certification.capability_tier)
        || typeof certification.catalog_version !== 'string' || !certification.catalog_version
        || !HASH.test(certification.capability_evidence_sha256) || !HASH.test(certification.cli_evidence_sha256)
        || !active(certification.issued_at, certification.expires_at, now)
        || !inventory.models.includes(certification.model_id)) return certificationFailure();
      findApproval(registry, entry.approval_ref, 'model', sha256(bytes), repoIdentity, now);
      findApproval(registry, null, 'model', certification.capability_evidence_sha256, repoIdentity, now);
      const model = catalog.models.find(item => item.model_id === certification.model_id);
      if (!model || model.capability_tier !== certification.capability_tier
        || certification.catalog_version !== catalog.catalog_version || model.catalog_version !== certification.catalog_version
        || model.certification_status !== 'certified' || model.certification_reference !== `sha256:${sha256(bytes)}`) return certificationFailure();
      return {
        certification_reference: `sha256:${sha256(bytes)}`,
        model_id: certification.model_id,
        capability_tier: certification.capability_tier,
        catalog_version: certification.catalog_version,
      };
    });
    return { verifiedCertificationRefs, cliAvailableModels: inventory.models.slice() };
  } catch {
    return certificationFailure();
  }
}

export function readInstalledCliIdentity({ env = process.env, targetRoot, resolveExecutable, readFile = readFileSync } = {}) {
  try {
    const home = env.HOME;
    if (typeof home !== 'string' || !home || typeof targetRoot !== 'string' || !targetRoot) return cliFailure();
    const expected = resolve(home, '.local/bin/agy');
    const resolvedPath = (resolveExecutable ?? realpathSync)(expected);
    const checkoutRoot = resolve(targetRoot);
    if (typeof resolvedPath !== 'string' || resolvedPath !== realpathSync(expected)
      || resolvedPath.startsWith(`${checkoutRoot}${sep}`)) return cliFailure();
    const stat = lstatSync(resolvedPath);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111) === 0 || stat.size > CLI_LIMIT) return cliFailure();
    const bytes = readFile(resolvedPath);
    if (!(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array) || bytes.byteLength > CLI_LIMIT) return cliFailure();
    return { resolvedPath, binarySha256: sha256(bytes) };
  } catch {
    return cliFailure();
  }
}
