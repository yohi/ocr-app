import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This probe intentionally only publishes IDs pre-authorized in the static
// profile. The CLI response is untrusted and may contain sensitive error text.
const SHA256 = /^[a-f0-9]{64}$/;
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const MAX_MODELS = 256;
const MAX_BYTES = 256 * 1024;
const FAIL = 'AGY_OAUTH_MODEL_PROBE_INVALID';

function reject() {
  throw new Error(FAIL);
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

export function validateGoogleAiProProbeConfig(config) {
  if (!plainObject(config) || config.schema_version !== '1'
    || config.profile !== 'google_ai_pro_oauth'
    || config.probe_cli_version !== '1.5.8'
    || typeof config.linux_x64_archive_sha256 !== 'string'
    || !SHA256.test(config.linux_x64_archive_sha256)
    || !Array.isArray(config.candidate_models) || config.candidate_models.length !== 4
    || !Array.isArray(config.excluded_for_plan) || config.excluded_for_plan.length !== 3
    || !plainObject(config.production_defaults) || !plainObject(config.retired_soon)) reject();
  const expected = ['gemini-4-hydrogen-low', 'gemini-4-hydrogen-medium',
    'gemini-4-hydrogen-high', 'gemini-4-hydrogen-xhigh'];
  const proposedTiers = ['fast', 'fast', 'deep', 'deep'];
  for (let i = 0; i < expected.length; i++) {
    const item = config.candidate_models[i];
    if (!plainObject(item) || item.id !== expected[i] || item.proposed_tier !== proposedTiers[i]) reject();
  }
  if (config.excluded_for_plan.join(',') !== [
    'gemini-4-carbon-low', 'gemini-4-carbon-medium', 'gemini-4-carbon-high',
  ].join(',') || config.production_defaults.fast !== 'gemini-3.8-flash-medium'
    || config.production_defaults.deep !== 'claude-opus-5-5-high'
    || config.retired_soon.id !== 'gpt-oss-120b-medium'
    || config.retired_soon.effective_date !== '2026-11-18') reject();
  return config;
}

export function parseAgyModelsEnvelope(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > MAX_BYTES) reject();
  let value;
  try { value = JSON.parse(source); } catch { reject(); }
  if (!plainObject(value) || value.status !== 'SUCCESS'
    || !plainObject(value.command) || value.command.name !== 'models'
    || !plainObject(value.command.data) || !Array.isArray(value.command.data.models)
    || value.command.data.models.length > MAX_MODELS) reject();
  const ids = new Set();
  for (const model of value.command.data.models) {
    if (!plainObject(model) || typeof model.id !== 'string'
      || !MODEL_ID.test(model.id) || ids.has(model.id)) reject();
    ids.add(model.id);
  }
  if (ids.size === 0) reject();
  return ids;
}

export function buildGoogleAiProProbeReport({ source, config, cliVersion, binarySha256 }) {
  validateGoogleAiProProbeConfig(config);
  if (typeof cliVersion !== 'string' || cliVersion.trim() !== config.probe_cli_version
    || typeof binarySha256 !== 'string' || !SHA256.test(binarySha256)) reject();
  const found = parseAgyModelsEnvelope(source);
  const knownIds = config.candidate_models.map(item => item.id);
  const listed = knownIds.filter(id => found.has(id));
  const missing = knownIds.filter(id => !found.has(id));
  const legacy = Object.values(config.production_defaults).filter(id => found.has(id));
  return Object.freeze({
    schema_version: '1',
    profile: config.profile,
    cli_version: config.probe_cli_version,
    cli_binary_sha256: binarySha256,
    hydrogen_listed: Object.freeze(listed),
    hydrogen_not_listed: Object.freeze(missing),
    legacy_default_listed: Object.freeze(legacy),
    carbon_listed_but_plan_excluded: Object.freeze(config.excluded_for_plan.filter(id => found.has(id))),
    gpt_oss_listed: found.has(config.retired_soon.id),
    gpt_oss_sunset_date: config.retired_soon.effective_date,
    // Listing alone cannot prove OAuth inference, quality, or Owner approval.
    hydrogen_runtime_execution_verified: false,
    production_routing_changed: false,
  });
}

export function formatGoogleAiProProbeSummary(report) {
  if (!plainObject(report) || report.schema_version !== '1'
    || report.profile !== 'google_ai_pro_oauth') reject();
  const lines = [
    '## Google AI Pro / agy OAuth モデル一覧の検証',
    '',
    `- agy CLI: \`${report.cli_version}\``,
    `- 実行ファイル SHA-256: \`${report.cli_binary_sha256}\``,
    '- 調査対象: OAuthログイン済みの実行環境（推論は未実行）',
    '',
    '| Hydrogen候補 | CLIのモデル一覧 |',
    '| --- | --- |',
  ];
  for (const id of ['gemini-4-hydrogen-low', 'gemini-4-hydrogen-medium',
    'gemini-4-hydrogen-high', 'gemini-4-hydrogen-xhigh']) {
    lines.push(`| \`${id}\` | ${report.hydrogen_listed.includes(id) ? 'LISTED' : 'NOT_LISTED'} |`);
  }
  lines.push('', `- 現行のFast/Deep規定モデルの表示数: ${report.legacy_default_listed.length}/2`,
    `- GPT-OSS 120B: ${report.gpt_oss_listed ? 'LISTED（廃止予定）' : 'NOT_LISTED'} / 2026-11-18廃止予定`,
    '- **LISTEDは利用枠・実際の応答・レビュー品質を証明しません。**',
    '- **既存のレビュー選択、CLI pin、承認・監査設定は変更していません。**', '');
  return lines.join('\n');
}

async function main() {
  if (process.argv.length !== 6) reject();
  const [,, sourcePath, configPath, cliVersion, binarySha256] = process.argv;
  const source = readFileSync(resolve(sourcePath), 'utf8');
  const config = JSON.parse(readFileSync(resolve(configPath), 'utf8'));
  const report = buildGoogleAiProProbeReport({ source, config, cliVersion, binarySha256 });
  const summary = formatGoogleAiProProbeSummary(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  } else {
    process.stdout.write(summary);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(() => {
    console.error(FAIL);
    process.exitCode = 1;
  });
}
