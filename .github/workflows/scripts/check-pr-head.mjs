import { appendFileSync } from 'node:fs';

export async function fetchCurrentHead({ token, targetRepo, prNumber, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://api.github.com/repos/${targetRepo}/pulls/${prNumber}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'OpenCodeReview-CI',
    },
  });
  if (!response.ok) throw new Error(`Unable to revalidate PR head (HTTP ${response.status})`);
  const data = await response.json();
  const sha = data?.head?.sha;
  if (typeof sha !== 'string' || sha.length === 0) throw new Error('PR head SHA is missing');
  return sha;
}

export async function run({ env = process.env, fetchImpl = fetch } = {}) {
  const actualSha = await fetchCurrentHead({
    token: env.GITHUB_TOKEN,
    targetRepo: env.TARGET_REPO,
    prNumber: env.PR_NUMBER,
    fetchImpl,
  });
  if (actualSha !== env.EXPECTED_SHA) {
    throw Object.assign(new Error('PR head changed while the review was running; refusing to publish stale results'), { code: 'HEAD_CHANGED' });
  }
  return actualSha;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((error) => {
    process.exitCode = 1;
    if (process.env.DECISION_ROUTING_MODE === 'enforce') {
      const reason = error?.code === 'HEAD_CHANGED' ? 'HEAD_CHANGED' : 'HEAD_VALIDATION_FAILED';
      console.error(reason);
      try {
        appendFileSync(process.env.GITHUB_OUTPUT, `HEAD_FAILURE_REASON=${reason}\n`);
      } catch {
        // The failed step outcome remains authoritative if output delivery fails.
      }
    } else {
      console.error(error.message);
    }
  });
}
