import { randomBytes } from 'node:crypto';
import { linkSync, lstatSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertRunBindingValid, assertRunBindingEquals } from './ocr-run-binding.mjs';
import { evaluateRoutingStartup } from './routing-authorization.mjs';
import { loadVerifiedCertification } from './load-review-certification.mjs';

const INVALID = 'ROUTING_EXECUTION_CONTEXT_INVALID';
const DENIED = 'ROUTING_ACTIVATION_DENIED';
const LIMIT = 64 * 1024;
const KEYS = ['schema_version', 'binding', 'repo_identity', 'authorization', 'certification_refs', 'cli_inventory_sha256', 'cli_binary_sha256'];

function failure(code) {
  throw Object.assign(new Error(code), { code });
}

function exact(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function digestMatches(contextDigest, trustedDigest) {
  return typeof trustedDigest === 'string' && contextDigest === trustedDigest.replace(/^sha256:/, '');
}

function validContext(context) {
  if (!exact(context, KEYS) || context.schema_version !== '1' || !exact(context.binding, ['workflowRunId', 'runAttempt', 'headSha', 'mode'])
    || !exact(context.repo_identity, ['repoId', 'fullName', 'headSha'])
    || !exact(context.authorization, ['policy_sha256', 'catalog_sha256', 'source_manifest_sha256', 'approval_refs'])
    || !Array.isArray(context.authorization.approval_refs) || !context.authorization.approval_refs.every(v => typeof v === 'string')
    || !Array.isArray(context.certification_refs) || !context.certification_refs.every(v => typeof v === 'string')
    || ![context.authorization.policy_sha256, context.authorization.catalog_sha256, context.authorization.source_manifest_sha256]
      .every(v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v))
    || ![context.cli_inventory_sha256, context.cli_binary_sha256].every(v => v === null || (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)))) return false;
  try { assertRunBindingValid(context.binding); } catch { return false; }
  return Number.isSafeInteger(context.repo_identity.repoId) && context.repo_identity.repoId > 0
    && typeof context.repo_identity.fullName === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(context.repo_identity.fullName)
    && context.repo_identity.headSha === context.binding.headSha;
}

export function writeRoutingExecutionContext({ runTemp, context, fileSystem = { ...{ writeFileSync, linkSync, unlinkSync } } }) {
  let temp;
  try {
    if (typeof runTemp !== 'string' || !runTemp || !validContext(context)) return failure(INVALID);
    const destination = join(runTemp, 'ocr-routing-execution-context.json');
    temp = join(runTemp, `.ocr-routing-execution-context-${randomBytes(12).toString('hex')}.tmp`);
    fileSystem.writeFileSync(temp, `${JSON.stringify(context)}\n`, { flag: 'wx', mode: 0o600 });
    fileSystem.linkSync(temp, destination);
    fileSystem.unlinkSync(temp);
    temp = undefined;
  } catch { failure(INVALID); }
  finally {
    if (temp) {
      try { fileSystem.unlinkSync(temp); } catch (cleanupError) { void cleanupError; }
    }
  }
}

export function readRoutingExecutionContext({ runTemp, expectedBinding, fileSystem = { lstatSync, readFileSync } }) {
  try {
    assertRunBindingValid(expectedBinding);
    const path = join(runTemp, 'ocr-routing-execution-context.json');
    const stat = fileSystem.lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMIT) return failure(INVALID);
    const bytes = fileSystem.readFileSync(path);
    if (bytes.byteLength > LIMIT) return failure(INVALID);
    const context = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!validContext(context)) return failure(INVALID);
    assertRunBindingEquals(expectedBinding, context.binding);
    return context;
  } catch { failure(INVALID); }
}

export function revalidateRoutingExecutionContext({ context, expectedBinding, trustedInputs, repoIdentity, now, cliBinarySha256 }) {
  try {
    if (!validContext(context)) return failure(INVALID);
    assertRunBindingEquals(expectedBinding, context.binding);
    if (context.repo_identity.repoId !== repoIdentity.repo_id || context.repo_identity.fullName !== repoIdentity.full_name
      || context.repo_identity.headSha !== expectedBinding.headSha
      || !digestMatches(context.authorization.policy_sha256, trustedInputs.policySha256)
      || !digestMatches(context.authorization.catalog_sha256, trustedInputs.catalogSha256)
      || !digestMatches(context.authorization.source_manifest_sha256, trustedInputs.sourceManifestSha256)) return failure(INVALID);
    const startupAuthorization = evaluateRoutingStartup({
      mode: expectedBinding.mode, repoIdentity: { repo_id: repoIdentity.repo_id, full_name: repoIdentity.full_name },
      registry: trustedInputs.registry, operationalDossiers: trustedInputs.operationalDossiers,
      policySha256: trustedInputs.policySha256, catalogSha256: trustedInputs.catalogSha256,
      sourceManifestSha256: trustedInputs.sourceManifestSha256, now,
    });
    if (!startupAuthorization.authorized || startupAuthorization.approvalRefs.join('\0') !== context.authorization.approval_refs.join('\0')) return failure(DENIED);
    if (trustedInputs.needsModel && (context.cli_binary_sha256 === null || context.cli_inventory_sha256 === null
      || context.cli_binary_sha256 !== cliBinarySha256)) return failure(INVALID);
    let certifiedBundle = null;
    if (trustedInputs.needsModel) {
      const verified = loadVerifiedCertification({ catalog: trustedInputs.catalog, index: trustedInputs.index,
        registry: trustedInputs.registry, repoIdentity, now, readEvidence: trustedInputs.readEvidence, cliBinarySha256 });
      if (verified.cliAvailableModels.length === 0 || trustedInputs.index?.cli_inventory?.sha256 !== context.cli_inventory_sha256) return failure(DENIED);
      if (context.certification_refs.some(ref => !verified.verifiedCertificationRefs.some(item => item.certification_reference === ref))) return failure(DENIED);
      certifiedBundle = {
        catalog: trustedInputs.catalog,
        evidence: {
          certification_refs: verified.verifiedCertificationRefs,
          cli_available_models: verified.cliAvailableModels,
        },
      };
    } else if (context.certification_refs.length !== 0 || context.cli_inventory_sha256 !== null || context.cli_binary_sha256 !== null) return failure(INVALID);
    return { startupAuthorization, certifiedBundle };
  } catch (error) {
    if (error?.code === INVALID || error?.code === DENIED) throw error;
    failure(DENIED);
  }
}
