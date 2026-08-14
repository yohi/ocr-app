import fs from 'node:fs';

export function parseRepository(value) {
  if (typeof value !== 'string' || !/^[^/]+\/[^/]+$/.test(value)) {
    throw new Error('Repository must be in owner/repo format');
  }
  const [owner, repo] = value.split('/');
  return { owner, repo };
}

export function isInternalPullRequest({ baseRepo, headRepo }) {
  return typeof baseRepo === 'string' && baseRepo.length > 0 &&
    typeof headRepo === 'string' && headRepo.length > 0 && baseRepo === headRepo;
}

export function run({ env = process.env, outputPath = env.GITHUB_OUTPUT } = {}) {
  const baseRepo = env.BASE_REPO || env.TARGET_REPO;
  const headRepo = env.HEAD_REPO;
  const { owner, repo } = parseRepository(baseRepo);
  const internal = isInternalPullRequest({ baseRepo, headRepo });
  if (!outputPath) throw new Error('GITHUB_OUTPUT is required');
  fs.appendFileSync(outputPath, `owner=${owner}\nrepo=${repo}\ninternal=${internal}\n`);
  return { owner, repo, internal };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    run();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
