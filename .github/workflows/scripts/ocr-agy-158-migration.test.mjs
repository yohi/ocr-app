import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../ocr-engine.yml', import.meta.url), 'utf8');
const catalog = JSON.parse(readFileSync(new URL('../config/review-model-catalog.json', import.meta.url), 'utf8'));
const candidate = JSON.parse(readFileSync(new URL('../config/google-ai-pro-hydrogen-probe.json', import.meta.url), 'utf8'));
const index = JSON.parse(readFileSync(new URL('../config/review-certification-index.json', import.meta.url), 'utf8'));

test('agy v1.5.8 and Hydrogen Medium are the explicit requested rollout target', () => {
  assert.equal(candidate.target_production.cli_version, '1.5.8');
  assert.equal(candidate.target_production.fast_default_model, 'gemini-4-hydrogen-medium');
  assert.equal(candidate.target_production.activation, 'requires_verified_binary_and_model_evidence');
  assert.match(workflow, /AGY_VERSION: \$\{\{ env\.OCR_AGY_158_ENABLE == 'true' && '1\.5\.8' \|\| '1\.5\.1' \}\}/);
  assert.match(workflow, /AGY_ARCHIVE_SHA256:.*905d4accfbd61bc00bee84bfaf24c59b85d334cabd786cf99237b66cfe06ab98/);
  assert.match(workflow, /OCR_LLM_MODEL:.*OCR_AGY_158_ENABLE == 'true'.*gemini-4-hydrogen-medium/);
});

test('unapproved upgrade is disabled by default, with strict hash and catalog safeguards', () => {
  assert.match(workflow, /OCR_AGY_158_ENABLE: \$\{\{ vars\.OCR_AGY_158_ENABLE \|\| 'false' \}\}/);
  assert.match(workflow, /AGY_158_BINARY_SHA256_REQUIRED/);
  assert.match(workflow, /AGY_158_PINNED_INVENTORY_REQUIRED/);
  assert.match(workflow, /AGY_HYDROGEN_MODEL_NOT_CERTIFIED/);
  assert.match(workflow, /AGY_158_CLI_INDEX_NOT_UPDATED/);
  assert.match(workflow, /AGY_VERSION_CERTIFICATION_MISMATCH/);
  assert.match(workflow, /AGY_CLI_DISABLE_AUTO_UPDATE: 'true'/);
});

test('legacy certification evidence is unchanged and never falsely applied to Hydrogen', () => {
  assert.equal(catalog.strategies.fast.preferred_model_id, 'gemini-3.8-flash-medium');
  assert.ok(!catalog.models.some(item => item.model_id === 'gemini-4-hydrogen-medium' &&
    item.certification_status === 'certified'));
  assert.equal(index.cli_inventory.path, 'routing-evidence/pro-cli-inventory-20261105.json');
  assert.equal(catalog.models.find(item => item.model_id === 'claude-opus-5-5-high')
    .allowed_fallbacks.includes('gpt-oss-120b-medium'), false);
});

test('agy 1.5.8 denies automatic edits and shell access on explicitly enabled route', () => {
  assert.match(workflow, /"agentMode": ""/);
  assert.match(workflow, /"toolPermission": "\$\{\{ env\.OCR_AGY_158_ENABLE == 'true' && 'strict'/);
  for (const denied of ['command(*)','unsandboxed(*)','read_file(*)','write_file(*)','read_url(*)','execute_url(*)','mcp(*)']) {
    assert.ok(workflow.includes('"' + denied + '"'), 'missing deny policy: ' + denied);
  }
});
