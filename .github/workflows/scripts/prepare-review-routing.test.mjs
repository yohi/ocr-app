import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createRunBindingFromEnv, loadRouteFromFile, readSelectedReviewRoute,
  writeSelectedReviewRoute, prepareRoutingStep,
} from './prepare-review-routing.mjs';

const env = mode => ({ GITHUB_RUN_ID: '9007199254740993', GITHUB_RUN_ATTEMPT: '2', COMMIT_SHA: 'a'.repeat(40), DECISION_ROUTING_MODE: mode });
const route = () => ({ schema_version: '1', effective_mode: 'shadow', workflow_run_id: '9007199254740993', run_attempt: 2, head_sha: 'a'.repeat(40), selected_strategy: null, proposed_strategy: 'deep', selected_review_model: null, proposed_review_model: 'claude-opus-4-6-thinking', fallback_models: [], route_source: 'deterministic_fallback', decision_status: 'unavailable', decision_latency_ms: null, decision_api_cost: null });

test('run binding keeps canonical run ID and freezes runner identity', () => {
  const binding = createRunBindingFromEnv(env('shadow'));
  assert.equal(binding.workflowRunId, '9007199254740993');
  assert.equal(binding.runAttempt, 2);
  assert.equal(Object.isFrozen(binding), true);
});

test('route writer and reader enforce exact schema, binding, and private permissions', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-routing-'));
  try {
    writeSelectedReviewRoute({ runTemp, route: route(), runBinding: createRunBindingFromEnv(env('shadow')) });
    const path = join(runTemp, 'ocr-routing', 'route.json');
    assert.equal(statSync(join(runTemp, 'ocr-routing')).mode & 0o777, 0o700);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(readSelectedReviewRoute({ runBinding: createRunBindingFromEnv(env('shadow')), runTemp }), route());
    assert.throws(() => writeSelectedReviewRoute({ runTemp, route: route(), runBinding: createRunBindingFromEnv(env('shadow')) }));
    const invalid = { ...route(), extra: 'no' };
    assert.throws(() => loadRouteFromFile(path, { readFileSync: () => JSON.stringify(invalid) }));
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('saved route binding mismatch fails before a caller can spawn Host', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-routing-mismatch-'));
  let spawnCount = 0;
  try {
    writeSelectedReviewRoute({ runTemp, route: route(), runBinding: createRunBindingFromEnv(env('shadow')) });
    assert.throws(() => {
      readSelectedReviewRoute({ runBinding: createRunBindingFromEnv({ ...env('shadow'), GITHUB_RUN_ATTEMPT: '3' }), runTemp });
      spawnCount++;
    }, { message: 'RUN_BINDING_MISMATCH' });
    assert.equal(spawnCount, 0);
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('off mode performs no routing I/O or network request', async () => {
  let networkCalls = 0;
  const result = await prepareRoutingStep({ runBinding: null, env: env('off'), fetchImpl: async () => { networkCalls++; } });
  assert.deepEqual(result, { route: null, decisionRecord: null, egressStatus: 'not_checked' });
  assert.equal(networkCalls, 0);
});

for (const mode of ['shadow', 'enforce']) {
  test(`${mode} prepares a run-bound route and decision without a Decision API call when nothing is reviewable`, async () => {
    const runTemp = mkdtempSync(join(tmpdir(), `ocr-routing-${mode}-`));
    let networkCalls = 0;
    try {
      const environment = { ...env(mode), RUNNER_TEMP: runTemp, OCR_PREVIEW_PATH: join(runTemp, 'preview.json'), BASE_REF: 'main', TARGET_REPO: 'owner/repo', CHECKOUT_REPO: 'https://github.com/owner/repo.git', GITHUB_TOKEN: 'test-token' };
      writeFileSync(environment.OCR_PREVIEW_PATH, JSON.stringify({ reviewable_files: [] }));
      const result = await prepareRoutingStep({
        env: environment,
        fetchImpl: async (_url, options) => {
          networkCalls++;
          assert.equal(options.method, 'GET');
          return { ok: true, json: async () => ({ id: 1, full_name: 'owner/repo', private: true, visibility: 'private' }) };
        },
        runGit: async (_command, args) => {
          if (args[0] === 'rev-parse') return Buffer.from(`${'a'.repeat(40)}\n`);
          if (args[0] === 'merge-base') return Buffer.from(`${'b'.repeat(40)}\n`);
          return Buffer.alloc(0);
        },
      });
      assert.equal(networkCalls, 1);
      assert.equal(result.route.decision_status, 'not_requested');
      assert.equal(result.decisionRecord.effective_mode, mode);
      assert.equal(existsSync(join(runTemp, 'ocr-routing', 'route.json')), true);
      assert.equal(existsSync(join(runTemp, 'ocr-routing', 'decision.json')), true);
      assert.equal(statSync(join(runTemp, 'ocr-routing', 'route.json')).mode & 0o777, 0o600);
      assert.equal(statSync(join(runTemp, 'ocr-routing', 'decision.json')).mode & 0o777, 0o600);
    } finally { rmSync(runTemp, { recursive: true, force: true }); }
  });
}
