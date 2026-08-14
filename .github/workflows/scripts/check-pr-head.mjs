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
    throw new Error('PR head changed while the review was running; refusing to publish stale results');
  }
  return actualSha;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
