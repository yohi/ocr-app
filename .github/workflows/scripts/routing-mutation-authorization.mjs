import { authorizeRoutingStart } from './authorize-routing-start.mjs';

export async function reauthorizeRoutingMutation({ env = process.env, authorize = authorizeRoutingStart } = {}) {
  const mode = env.DECISION_ROUTING_MODE ?? 'off';
  if (mode === 'off') return true;
  if (mode !== 'shadow' || typeof env.CENTRAL_GITHUB_TOKEN !== 'string' || !env.CENTRAL_GITHUB_TOKEN
    || typeof env.GITHUB_TOKEN !== 'string' || !env.GITHUB_TOKEN) return false;

  const authorizationEnv = {
    ...env,
    GITHUB_TOKEN: env.CENTRAL_GITHUB_TOKEN,
    TARGET_TOKEN: env.GITHUB_TOKEN,
  };
  try {
    await authorize({ env: authorizationEnv, writeOutput: () => {} });
    return true;
  } catch {
    return false;
  }
}
