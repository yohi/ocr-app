import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  evaluateRoutingStartup,
  fetchCurrentRoutingAuthorization,
  hashRoutingSourceManifest,
} from './routing-authorization.mjs';

const ERROR_DENIED = 'ROUTING_ACTIVATION_DENIED';

async function defaultReadTrustedConfig(env) {
  const [owner, repo] = (env.GITHUB_REPOSITORY ?? '').split('/');
  if (!owner || !repo) throw new Error(ERROR_DENIED);
  return { centralRepo: `${owner}/${repo}`, protectedRef: 'master' };
}

async function defaultFetchRepoIdentity({ owner, repo, token, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!response.ok) throw new Error(ERROR_DENIED);
  return response.json();
}

function repoParts(fullName) {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(fullName ?? '');
  if (!match) throw new Error(ERROR_DENIED);
  return { owner: match[1], repo: match[2] };
}

function sha256File(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function writeGithubOutput(env, value) {
  if (!env.GITHUB_OUTPUT) throw new Error(ERROR_DENIED);
  writeFileSync(env.GITHUB_OUTPUT,
    `ROUTING_START_AUTHORIZED=${value}\nROUTING_START_FAILURE_REASON=${value === 'false' ? ERROR_DENIED : ''}\n`,
    { flag: 'a' });
}

export async function authorizeRoutingStart({
  env = process.env,
  readTrustedConfig = defaultReadTrustedConfig,
  fetchRepoIdentity = defaultFetchRepoIdentity,
  fetchCurrentAuthorization = fetchCurrentRoutingAuthorization,
  now = () => new Date().toISOString(),
  writeOutput = value => writeGithubOutput(env, value),
  log = message => console.error(message),
} = {}) {
  const mode = env.DECISION_ROUTING_MODE;
  if (mode === 'off') return;
  if (mode !== 'shadow' && mode !== 'enforce') {
    log(JSON.stringify({ event: 'routing_start_denied', stage: 'mode_validation', reason: 'invalid_mode' }));
    throw new Error(ERROR_DENIED);
  }

  let authorized = false;
  let stage = 'trusted_config_read';
  try {
    const config = await readTrustedConfig(env);
    stage = 'repository_identity_validation';
    const central = repoParts(config.centralRepo);
    const target = repoParts(env.TARGET_REPO);
    const checkedAt = now();
    stage = 'credentials_validation';
    if (config.protectedRef !== 'master' || typeof env.GITHUB_TOKEN !== 'string' || !env.GITHUB_TOKEN
      || typeof env.TARGET_TOKEN !== 'string' || !env.TARGET_TOKEN) throw new Error(ERROR_DENIED);
    stage = 'central_repository_identity_fetch';
    const centralIdentity = await fetchRepoIdentity({ ...central, token: env.GITHUB_TOKEN });
    stage = 'target_repository_identity_fetch';
    const repoIdentity = await fetchRepoIdentity({ ...target, token: env.TARGET_TOKEN });
    stage = 'trusted_source_integrity_check';
    const root = resolve(env.SELF_REPO_PATH || 'self-repo');
    const fileSystem = { readFileSync: path => readFileSync(resolve(root, path)) };
    const sourceManifestSha256 = hashRoutingSourceManifest({
      trustedRoot: root,
      readFile: path => fileSystem.readFileSync(path),
      listTrackedPaths: trustedRoot => execFileSync('/usr/bin/git', ['-C', trustedRoot, 'ls-files', '-z'], {
        encoding: 'utf8',
      }).split('\0').filter(Boolean),
    });
    const policySha256 = sha256File(resolve(root, '.github/workflows/config/decision-egress-policy.json'));
    const catalogSha256 = sha256File(resolve(root, '.github/workflows/config/review-model-catalog.json'));
    stage = 'authorization_fetch';
    const authority = await fetchCurrentAuthorization({
      centralRepoId: centralIdentity.id,
      centralRepoFullName: centralIdentity.full_name,
      protectedRef: config.protectedRef,
      token: env.GITHUB_TOKEN,
      fetchImpl: fetch,
      now: checkedAt,
    });
    if (!authority?.registry) {
      log(JSON.stringify({
        event: 'routing_start_denied',
        stage: 'authorization_registry_unavailable',
        reason: authority?.reason ?? 'registry_missing',
      }));
    }
    stage = 'authorization_evaluation';
    if (authority?.registry) {
      authorized = evaluateRoutingStartup({
        mode,
        repoIdentity: { repo_id: repoIdentity.id, full_name: repoIdentity.full_name },
        registry: authority.registry,
        operationalDossiers: authority.operationalDossiers,
        policySha256,
        catalogSha256,
        sourceManifestSha256,
        now: checkedAt,
      }, diagnostic => log(JSON.stringify({
        event: 'routing_start_denied',
        stage: 'authorization_evaluation',
        reason: diagnostic,
      }))).authorized;
    }
  } catch (error) {
    authorized = false;
    const errorType = error instanceof Error ? error.name : 'UnknownError';
    log(JSON.stringify({ event: 'routing_start_denied', stage: `${stage}_failed`, error_type: errorType }));
  }
  if (!authorized) log(JSON.stringify({ event: 'routing_start_denied', stage: 'authorization_evaluation_denied', reason: 'ROUTING_ACTIVATION_DENIED' }));
  writeOutput(authorized ? 'true' : 'false');
  if (!authorized) throw new Error(ERROR_DENIED);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await authorizeRoutingStart();
}
