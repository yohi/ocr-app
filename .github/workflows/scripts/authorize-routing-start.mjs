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
  writeFileSync(env.GITHUB_OUTPUT, `ROUTING_START_AUTHORIZED=${value}\n`, { flag: 'a' });
}

export async function authorizeRoutingStart({
  env = process.env,
  readTrustedConfig = defaultReadTrustedConfig,
  fetchRepoIdentity = defaultFetchRepoIdentity,
  fetchCurrentAuthorization = fetchCurrentRoutingAuthorization,
  now = () => new Date().toISOString(),
  writeOutput = value => writeGithubOutput(env, value),
} = {}) {
  const mode = env.DECISION_ROUTING_MODE;
  if (mode === 'off') return;
  if (mode !== 'shadow' && mode !== 'enforce') throw new Error(ERROR_DENIED);

  let authorized = false;
  try {
    const config = await readTrustedConfig(env);
    const central = repoParts(config.centralRepo);
    const target = repoParts(env.TARGET_REPO);
    const checkedAt = now();
    if (config.protectedRef !== 'master' || typeof env.GITHUB_TOKEN !== 'string' || !env.GITHUB_TOKEN
      || typeof env.TARGET_TOKEN !== 'string' || !env.TARGET_TOKEN) throw new Error(ERROR_DENIED);
    const centralIdentity = await fetchRepoIdentity({ ...central, token: env.GITHUB_TOKEN });
    const repoIdentity = await fetchRepoIdentity({ ...target, token: env.TARGET_TOKEN });
    const root = resolve(env.SELF_REPO_PATH || 'self-repo');
    const fileSystem = { readFileSync: path => readFileSync(resolve(root, path)) };
    const sourceManifestSha256 = hashRoutingSourceManifest({
      trustedRoot: root,
      readFile: path => fileSystem.readFileSync(path),
      listTrackedPaths: trustedRoot => execFileSync('git', ['-C', trustedRoot, 'ls-files', '-z'], {
        encoding: 'utf8',
        env: { ...process.env, PATH: '/usr/bin:/bin' },
      }).split('\0').filter(Boolean),
    });
    const policySha256 = sha256File(resolve(root, '.github/workflows/config/review-risk-policy.json'));
    const catalogSha256 = sha256File(resolve(root, '.github/workflows/config/review-model-catalog.json'));
    const authority = await fetchCurrentAuthorization({
      centralRepoId: centralIdentity.id,
      centralRepoFullName: centralIdentity.full_name,
      protectedRef: config.protectedRef,
      token: env.GITHUB_TOKEN,
      fetchImpl: fetch,
      now: checkedAt,
    });
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
      }).authorized;
    }
  } catch {
    authorized = false;
  }
  writeOutput(authorized ? 'true' : 'false');
  if (!authorized) throw new Error(ERROR_DENIED);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await authorizeRoutingStart();
}
