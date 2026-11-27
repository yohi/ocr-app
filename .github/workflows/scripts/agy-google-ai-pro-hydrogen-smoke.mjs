import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODELS = Object.freeze(['gemini-4-hydrogen-medium', 'gemini-4-hydrogen-high']);
const HASH = /^[a-f0-9]{64}$/;
const FAIL = 'AGY_HYDROGEN_OAUTH_SMOKE_FAILED';

export function validateSmokeResult(output) {
  if (typeof output !== 'string' || Buffer.byteLength(output, 'utf8') > 1048576) return false;
  try {
    const result = JSON.parse(output);
    return result !== null && typeof result === 'object' && !Array.isArray(result)
      && result.status === 'SUCCESS' && typeof result.response === 'string'
      && result.response.trim().length > 0;
  } catch {
    return false;
  }
}

export function runHydrogenSmoke({ executable, cliSha256, exec = spawnSync, env = process.env }) {
  if (typeof executable !== 'string' || !executable.startsWith('/') ||
    typeof cliSha256 !== 'string' || !HASH.test(cliSha256)) throw new Error(FAIL);
  const outcomes = [];
  for (const model of MODELS) {
    // Fixed models and non-sensitive prompt only. No model-provided text is logged.
    const result = exec(executable, [
      '--mode', 'plan',
      '--model', model,
      '--output-format', 'json',
      '--print-timeout', '45s',
      '-p', 'Respond in one short sentence with the word OK. Do not use any tools.',
    ], {
      cwd: env.RUNNER_TEMP || '/tmp',
      env: { ...env, AGY_CLI_DISABLE_AUTO_UPDATE: 'true' },
      input: '',
      encoding: 'utf8',
      timeout: 70000,
      maxBuffer: 1048576,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const success = result?.status === 0 && !result?.error &&
      validateSmokeResult(result.stdout);
    outcomes.push(Object.freeze({ model, success }));
    if (!success) break; // Do not consume further quota after failure.
  }
  return Object.freeze({
    cli_sha256: cliSha256,
    outcomes: Object.freeze(outcomes),
    all_passed: outcomes.length === MODELS.length && outcomes.every(item => item.success),
    quality_verified: false,
  });
}

export function formatSmokeSummary(outcome) {
  if (!outcome || typeof outcome !== 'object' ||
    typeof outcome.cli_sha256 !== 'string' || !HASH.test(outcome.cli_sha256) ||
    !Array.isArray(outcome.outcomes)) throw new Error(FAIL);
  const lines = [
    '## Google AI Pro OAuth: Hydrogen inference smoke',
    '',
    '- Fixed CLI SHA-256: `' + outcome.cli_sha256 + '`',
    '- Headless mode: plan, tool actions denied',
    '- Only fixed prompts and model IDs were used; no model response or stderr is published.',
    '',
  ];
  for (const model of MODELS) {
    const status = outcome.outcomes.find(item => item.model === model);
    lines.push('- `' + model + '`: ' + (status ? status.success ? 'INFERENCE_PASS' : 'INFERENCE_FAILED'
      : 'NOT_RUN'));
  }
  lines.push('', outcome.all_passed ?
    '**Inference succeeded for both models; review quality / quota not established.**' :
    '**Inference did not pass for both models; keep production selection unchanged.**', '');
  return lines.join('\n');
}

function main() {
  if (process.argv.length !== 3) throw new Error(FAIL);
  const [,, executable] = process.argv;
  const sha = process.env.AGY_BINARY_SHA256;
  const report = runHydrogenSmoke({ executable: resolve(executable), cliSha256: sha });
  const summary = formatSmokeSummary(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  else process.stdout.write(summary);
  if (!report.all_passed) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { main(); } catch {
    console.error(FAIL);
    process.exitCode = 1;
  }
}
