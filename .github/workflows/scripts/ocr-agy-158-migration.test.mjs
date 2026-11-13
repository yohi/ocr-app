import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../ocr-engine.yml', import.meta.url), 'utf8');
const catalog = JSON.parse(readFileSync(new URL('../config/review-model-catalog.json', import.meta.url), 'utf8'));
const candidate = JSON.parse(readFileSync(new URL('../config/google-ai-pro-hydrogen-probe.json', import.meta.url), 'utf8'));
const index = JSON.parse(readFileSync(new URL('../config/review-certification-index.json', import.meta.url), 'utf8'));
const stagedInventory = JSON.parse(readFileSync(new URL('../config/routing-evidence/pro-cli-inventory-20261113.json', import.meta.url), 'utf8'));

test('agy v1.5.8 and Hydrogen Medium are the explicit requested rollout target', () => {
  assert.equal(candidate.target_production.cli_version, '1.5.8');
  assert.equal(candidate.target_production.fast_default_model, 'gemini-4-hydrogen-medium');
  assert.equal(candidate.target_production.activation, 'requires_verified_binary_and_model_evidence');
  assert.match(workflow, /AGY_VERSION: '1\.5\.8'/);
  assert.doesNotMatch(workflow, /AGY_VERSION:.*1\.5\.1/);
  assert.match(workflow, /AGY_ARCHIVE_SHA256:.*905d4accfbd61bc00bee84bfaf24c59b85d334cabd786cf99237b66cfe06ab98/);
  assert.match(workflow, /OCR_LLM_MODEL:.*vars\.OCR_LLM_MODEL \|\| 'gemini-3\.8-flash-medium'/);
});

test('agy 1.5.8 is fixed by Owner with strict hashes and inventory binding', () => {
  assert.match(workflow, /OCR_AGY_158_ENABLE: 'true'/);
  assert.match(workflow, /AGY_158_BINARY_SHA256_REQUIRED/);
  assert.match(workflow, /AGY_BINARY_SHA256: '9db59b6371107b939befa9c507c0a24989fda974e75d81d8529f3689ef7322e5'/);
  assert.match(workflow, /OCR_AGY_158_BINARY_SHA256: '9db59b6371107b939befa9c507c0a24989fda974e75d81d8529f3689ef7322e5'/);
  assert.match(workflow, /AGY_158_PINNED_INVENTORY_REQUIRED/);
  assert.doesNotMatch(workflow, /AGY_HYDROGEN_MODEL_NOT_CERTIFIED/);
  assert.match(workflow, /AGY_158_CLI_INDEX_NOT_UPDATED/);
  assert.match(workflow, /AGY_VERSION_CERTIFICATION_MISMATCH/);
  assert.match(workflow, /AGY_CLI_DISABLE_AUTO_UPDATE: 'true'/);
});

test('existing model certifications are unchanged and Hydrogen is not auto-certified', () => {
  assert.equal(catalog.strategies.fast.preferred_model_id, 'gemini-3.8-flash-medium');
  assert.ok(!catalog.models.some(item => item.model_id === 'gemini-4-hydrogen-medium' &&
    item.certification_status === 'certified'));
  assert.equal(index.cli_inventory.path, 'routing-evidence/pro-cli-inventory-20261113.json');
  assert.equal(index.cli_inventory.sha256, 'a136c087bd5fec2bfb4eb116c43bfa9a3fdb5bceb23738b823fc4d48aa1b288b');
  assert.equal(catalog.models.find(item => item.model_id === 'claude-opus-5-5-high')
    .allowed_fallbacks.includes('gpt-oss-120b-medium'), false);
});

test('agy 1.5.8 denies automatic edits and shell access on its pinned route', () => {
  assert.match(workflow, /"agentMode": ""/);
  assert.match(workflow, /"toolPermission": "\$\{\{ env\.OCR_AGY_158_ENABLE == 'true' && 'strict'/);
  for (const denied of ['command(*)','unsandboxed(*)','read_file(*)','write_file(*)','read_url(*)','execute_url(*)','mcp(*)']) {
    assert.ok(workflow.includes('"' + denied + '"'), 'missing deny policy: ' + denied);
  }
});

test('owner-observed agy 1.5.8 inventory is pinned separately from model certification', () => {
  assert.equal(stagedInventory.schema_version, '1');
  assert.equal(stagedInventory.cli_version, '1.5.8');
  assert.equal(stagedInventory.cli_binary_sha256, '9db59b6371107b939befa9c507c0a24989fda974e75d81d8529f3689ef7322e5');
  assert.equal(stagedInventory.models.length, 18);
  assert.equal(new Set(stagedInventory.models).size, 18);
  assert.ok(stagedInventory.models.includes('gemini-4-hydrogen-medium'));
  assert.ok(stagedInventory.models.includes('gemini-4-hydrogen-high'));
  assert.ok(stagedInventory.models.includes('gemini-pro-orchestrator-g1-pro'));
  assert.equal(stagedInventory.models.some(id => id.startsWith('gemini-4-carbon')), false);
  assert.equal(stagedInventory.observed_at, '2026-11-13T06:54:37.000Z');
  assert.equal(stagedInventory.expires_at, '2026-11-20T06:54:37.000Z');
  assert.equal(index.cli_inventory.path, 'routing-evidence/pro-cli-inventory-20261113.json');
  assert.equal(index.cli_inventory.sha256, 'a136c087bd5fec2bfb4eb116c43bfa9a3fdb5bceb23738b823fc4d48aa1b288b');
  assert.match(workflow, /AGY_158_CLI_INDEX_NOT_UPDATED/);
});
