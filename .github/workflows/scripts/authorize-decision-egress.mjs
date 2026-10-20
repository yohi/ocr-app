import { assertRunBindingValid } from './ocr-run-binding.mjs';

const DESTINATION = 'openrouter-decisions';
const REASONS = { authorized: 'authorized', denied: 'egress_denied' };
const VISIBILITY = { public: 'public', restricted: 'restricted', unknown: 'visibility_unknown' };

function parseTarget(targetRepo) {
  if (typeof targetRepo === 'string') return targetRepo;
  if (targetRepo && typeof targetRepo === 'object' && typeof targetRepo.full_name === 'string') return targetRepo.full_name;
  if (targetRepo && typeof targetRepo === 'object' && typeof targetRepo.owner === 'string' && typeof targetRepo.repo === 'string') return `${targetRepo.owner}/${targetRepo.repo}`;
  return '';
}

function approvalValid(value, format) {
  if (typeof value !== 'string' || typeof format !== 'string' || !format.includes('<approval-id>')) return false;
  const escaped = format.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('<approval-id>', '[A-Z0-9][A-Z0-9._-]*');
  return new RegExp(`^${escaped}$`).test(value);
}

function policyEntries(policy) {
  return Array.isArray(policy?.allowed_repositories) ? policy.allowed_repositories : [];
}

function checkoutName(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export async function authorizeDecisionEgress({ targetRepo, headSha, checkoutRepo, runBinding, installationToken, policy, fetchImpl }) {
  let validBinding = true;
  try { assertRunBindingValid(runBinding); } catch { validBinding = false; }
  const target = parseTarget(targetRepo);
  const [owner, repoName, ...extra] = target.split('/');
  let body = null;
  let apiValid = false;
  try {
    if (owner && repoName && !extra.length && typeof fetchImpl === 'function' && typeof installationToken === 'string' && installationToken) {
      const response = await fetchImpl(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`, {
        method: 'GET', headers: { Authorization: `Bearer ${installationToken}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000),
      });
      if (response?.ok === true) {
        const value = await response.json();
        if (value && typeof value === 'object' && Number.isSafeInteger(value.id) && value.id > 0 && typeof value.full_name === 'string' && typeof value.private === 'boolean' && typeof value.visibility === 'string') {
          body = value;
          apiValid = true;
        }
      }
    }
  } catch {
    // Network and response errors are represented only by the fixed denial enum.
  }
  const visibility = !apiValid ? VISIBILITY.unknown : body.private === false && body.visibility === 'public' ? VISIBILITY.public : body.private === true && ['private', 'internal'].includes(body.visibility) ? VISIBILITY.restricted : VISIBILITY.unknown;
  const entry = policyEntries(policy).find(item => item && typeof item === 'object' && item.id === body?.id && item.full_name === body?.full_name && approvalValid(item.approval_ref, policy?.approval_reference_format));
  const allowed = Boolean(validBinding && apiValid && visibility !== VISIBILITY.unknown && entry && body.full_name.toLowerCase() === target.toLowerCase() && checkoutName(checkoutRepo) === target.toLowerCase() && headSha === runBinding.headSha && /^[0-9a-f]{40}$/.test(headSha ?? '') && policy?.destination === DESTINATION && typeof policy?.policy_version === 'string' && policy.policy_version.length > 0);
  return {
    schema_version: '1', allowed, reason: allowed ? REASONS.authorized : apiValid && visibility === VISIBILITY.unknown ? 'visibility_unknown' : REASONS.denied, visibility,
    repo_id: apiValid ? body.id : 0, full_name: apiValid ? body.full_name : target,
    head_sha: typeof headSha === 'string' ? headSha : '', workflow_run_id: typeof runBinding?.workflowRunId === 'string' ? runBinding.workflowRunId : '',
    run_attempt: typeof runBinding?.runAttempt === 'number' ? runBinding.runAttempt : 0, destination: DESTINATION,
    policy_version: typeof policy?.policy_version === 'string' ? policy.policy_version : 'invalid', approval_ref: allowed ? entry.approval_ref : null,
    checked_at: new Date().toISOString(),
  };
}
