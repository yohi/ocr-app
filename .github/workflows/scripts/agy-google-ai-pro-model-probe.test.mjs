import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildGoogleAiProProbeReport, formatGoogleAiProProbeSummary,
  parseAgyModelsEnvelope, validateGoogleAiProProbeConfig,
} from './agy-google-ai-pro-model-probe.mjs';

const config = JSON.parse(readFileSync(new URL('../config/google-ai-pro-hydrogen-probe.json', import.meta.url), 'utf8'));
const sha = 'a'.repeat(64);
const encode = (...ids) => JSON.stringify({
  status: 'SUCCESS', command: { name: 'models',
    data: { models: ids.map(id => ({ id, label: 'Bearer ghp_PRIVATE_TOKEN' })) } },
  response: 'Bearer ghp_PRIVATE_TOKEN',
});

test('Google AI Pro candidate policy is fixed and excludes Carbon', () => {
  assert.equal(validateGoogleAiProProbeConfig(config), config);
  assert.equal(config.candidate_models.length, 4);
  assert.deepEqual(config.excluded_for_plan, [
    'gemini-4-carbon-low', 'gemini-4-carbon-medium', 'gemini-4-carbon-high',
  ]);
});

test('lists Hydrogen candidates with binary identity and never reports raw CLI fields', () => {
  const source = encode('gemini-4-hydrogen-medium', 'gemini-4-hydrogen-high',
    'gemini-3.8-flash-medium', 'claude-opus-5-5-high', 'gpt-oss-120b-medium',
    'gemini-4-carbon-high');
  const report = buildGoogleAiProProbeReport({
    source, config, cliVersion: '1.5.8', binarySha256: sha,
  });
  assert.deepEqual(report.hydrogen_listed, ['gemini-4-hydrogen-medium', 'gemini-4-hydrogen-high']);
  assert.deepEqual(report.hydrogen_not_listed, ['gemini-4-hydrogen-low', 'gemini-4-hydrogen-xhigh']);
  assert.deepEqual(report.legacy_default_listed, ['gemini-3.8-flash-medium', 'claude-opus-5-5-high']);
  assert.deepEqual(report.carbon_listed_but_plan_excluded, ['gemini-4-carbon-high']);
  assert.equal(report.hydrogen_runtime_execution_verified, false);
  assert.equal(report.production_routing_changed, false);
  assert.equal(report.gpt_oss_listed, true);
  assert.equal(report.gpt_oss_sunset_date, '2026-11-18');
  const output = formatGoogleAiProProbeSummary(report);
  assert.match(output, /gemini-4-hydrogen-medium.*LISTED/);
  assert.match(output, /LISTEDは利用枠/);
  assert.doesNotMatch(output, /PRIVATE_TOKEN|Bearer|short_error|response/);
});

test('success status and structured models command are both required', () => {
  assert.throws(() => parseAgyModelsEnvelope(JSON.stringify({ status: 'ERROR',
    error: 'Bearer private', command: { name: 'models', data: { models: [{ id: 'gemini-4-hydrogen-high' }] } },
  })), /AGY_OAUTH_MODEL_PROBE_INVALID/);
  assert.throws(() => parseAgyModelsEnvelope(JSON.stringify({ status: 'SUCCESS',
    command: { name: 'chat', data: { models: [{ id: 'gemini-4-hydrogen-high' }] } },
  })), /AGY_OAUTH_MODEL_PROBE_INVALID/);
  assert.throws(() => parseAgyModelsEnvelope(JSON.stringify({ status: 'SUCCESS',
    command: { name: 'models', data: { models: [{ id: 123 }] } },
  })), /AGY_OAUTH_MODEL_PROBE_INVALID/);
});

test('does not confuse listing with availability or silently accept duplicates', () => {
  const source = encode('gemini-4-hydrogen-high');
  const report = buildGoogleAiProProbeReport({
    source, config, cliVersion: '1.5.8', binarySha256: sha,
  });
  assert.deepEqual(report.hydrogen_listed, ['gemini-4-hydrogen-high']);
  assert.equal(report.hydrogen_runtime_execution_verified, false);
  assert.throws(() => parseAgyModelsEnvelope(encode('gemini-4-hydrogen-high', 'gemini-4-hydrogen-high')),
    /AGY_OAUTH_MODEL_PROBE_INVALID/);
  assert.throws(() => buildGoogleAiProProbeReport({
    source, config, cliVersion: '1.5.7', binarySha256: sha,
  }), /AGY_OAUTH_MODEL_PROBE_INVALID/);
  assert.throws(() => buildGoogleAiProProbeReport({
    source, config, cliVersion: '1.5.8', binarySha256: 'not-a-digest',
  }), /AGY_OAUTH_MODEL_PROBE_INVALID/);
});

test('config cannot activate Carbon or substitute an arbitrary Hydrogen candidate', () => {
  assert.throws(() => validateGoogleAiProProbeConfig({
    ...config, candidate_models: [{ id: 'gemini-4-carbon-high', proposed_tier: 'deep' },
      ...config.candidate_models.slice(1)],
  }), /AGY_OAUTH_MODEL_PROBE_INVALID/);
  assert.throws(() => validateGoogleAiProProbeConfig({
    ...config, linux_x64_archive_sha256: 'wrong',
  }), /AGY_OAUTH_MODEL_PROBE_INVALID/);
});

test('ignores non-candidate IDs including Orchestrator labels or custom aliases', () => {
  const source = encode('Orchestrator (Argon)', 'custom/vendor:model-name',
    'gemini-4-hydrogen-high');
  const report = buildGoogleAiProProbeReport({
    source, config, cliVersion: '1.5.8', binarySha256: sha,
  });
  assert.deepEqual(report.hydrogen_listed, ['gemini-4-hydrogen-high']);
  assert.doesNotMatch(formatGoogleAiProProbeSummary(report), /Orchestrator|custom\/vendor/);
});
