import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createRunBindingFromEnv, loadRouteFromFile, readSelectedReviewRoute,
  serializeSelectedReviewRoute, writeSelectedReviewRoute, prepareRoutingStep,
} from './prepare-review-routing.mjs';

const env = mode => ({ GITHUB_RUN_ID: '9007199254740993', GITHUB_RUN_ATTEMPT: '2', COMMIT_SHA: 'a'.repeat(40), DECISION_ROUTING_MODE: mode });
const binding = () => createRunBindingFromEnv(env('shadow'));
const preparation = () => ({
  route: { status: 'degraded', reviewableCount: 2, selectedStrategy: null, proposedStrategy: 'deep', selectedReviewModel: null, fallbackModels: [], routeSource: 'deterministic_fallback', decisionStatus: 'unavailable' },
  runBinding: binding(),
  policyVersions: { policyVersion: '1.0.0', modelCatalogVersion: '1.2.0' },
});
const route = () => serializeSelectedReviewRoute(preparation());

test('run binding keeps canonical run ID and freezes runner identity', () => {
  const binding = createRunBindingFromEnv(env('shadow'));
  assert.equal(binding.workflowRunId, '9007199254740993');
  assert.equal(binding.runAttempt, 2);
  assert.equal(Object.isFrozen(binding), true);
});

test('route serializer emits the exact 15-key contract and writer seals the standalone route privately', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-routing-'));
  try {
    const serialized = route();
    assert.deepEqual(Object.keys(serialized), ['schema_version', 'workflow_run_id', 'run_attempt', 'head_sha', 'effective_mode', 'status', 'reviewable_file_count', 'proposed_strategy', 'selected_strategy', 'selected_model_id', 'fallback_models', 'route_source', 'decision_status', 'policy_version', 'model_catalog_version']);
    const path = join(runTemp, 'ocr-selected-route.json');
    writeSelectedReviewRoute({ runTemp, result: preparation() });
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(readSelectedReviewRoute({ runBinding: binding(), runTemp }), serialized);
    assert.throws(() => writeSelectedReviewRoute({ runTemp, result: preparation() }));
    const invalid = { ...route(), extra: 'no' };
    assert.throws(() => loadRouteFromFile(path, { readFileSync: () => JSON.stringify(invalid) }));
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('enforce route carries only selected certified execution fields', () => {
  const routeInput = {
    route: { status: 'prepared', reviewableCount: 1, selectedStrategy: 'deep', proposedStrategy: 'deep', selectedReviewModel: 'model/deep', fallbackModels: ['model/deep-fallback'], routeSource: 'deterministic_fallback', decisionStatus: 'unavailable' },
    runBinding: createRunBindingFromEnv(env('enforce')),
    policyVersions: { policyVersion: '1.0.0', modelCatalogVersion: '1.2.0' },
  };
  const serialized = serializeSelectedReviewRoute(routeInput);
  assert.equal(serialized.selected_model_id, 'model/deep');
  assert.deepEqual(serialized.fallback_models, ['model/deep-fallback']);
  assert.equal(Object.hasOwn(serialized, 'decision_latency_ms'), false);
  assert.equal(Object.hasOwn(serialized, 'selected_review_model'), false);
});

test('enforce route rejects a missing model when reviewable files exist', () => {
  const routeInput = {
    route: { status: 'degraded', reviewableCount: 1, selectedStrategy: 'deep', proposedStrategy: 'deep', selectedReviewModel: null, fallbackModels: [], routeSource: 'deterministic_fallback', decisionStatus: 'unavailable' },
    runBinding: createRunBindingFromEnv(env('enforce')),
    policyVersions: { policyVersion: '1.0.0', modelCatalogVersion: '1.2.0' },
  };

  assert.throws(() => serializeSelectedReviewRoute(routeInput), { message: 'ROUTE_SCHEMA_INVALID' });
});

test('saved route binding mismatch fails before a caller can spawn Host', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-routing-mismatch-'));
  let spawnCount = 0;
  try {
    writeSelectedReviewRoute({ runTemp, result: preparation() });
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
          if (args[0] === 'config') return Buffer.from(`${environment.CHECKOUT_REPO}\n`);
          if (args[0] === 'rev-parse') return Buffer.from(`${'a'.repeat(40)}\n`);
          if (args[0] === 'merge-base') return Buffer.from(`${'b'.repeat(40)}\n`);
          return Buffer.alloc(0);
        },
      });
      assert.equal(networkCalls, 1);
      assert.equal(result.route.decision_status, 'not_requested');
      assert.equal(result.decisionRecord.effective_mode, mode);
      assert.equal(existsSync(join(runTemp, 'ocr-selected-route.json')), true);
      assert.equal(existsSync(join(runTemp, 'ocr-routing', 'decision.json')), true);
      assert.equal(statSync(join(runTemp, 'ocr-selected-route.json')).mode & 0o777, 0o600);
      assert.equal(statSync(join(runTemp, 'ocr-routing', 'decision.json')).mode & 0o777, 0o600);
      assert.equal(JSON.parse(readFileSync(join(runTemp, 'ocr-routing-state.json'), 'utf8')).owner_approval_ref, null);
    } finally { rmSync(runTemp, { recursive: true, force: true }); }
  });
}

test('routing rejects a checkout whose origin does not match the target repository', async () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'ocr-routing-identity-'));
  try {
    const environment = { ...env('shadow'), RUNNER_TEMP: runTemp, OCR_PREVIEW_PATH: join(runTemp, 'preview.json'), BASE_REF: 'main', TARGET_REPO: 'owner/repo', CHECKOUT_REPO: 'https://github.com/owner/repo.git', GITHUB_TOKEN: 'test-token' };
    writeFileSync(environment.OCR_PREVIEW_PATH, JSON.stringify({ reviewable_files: [] }));
    await assert.rejects(prepareRoutingStep({
      env: environment,
      fetchImpl: async () => ({ ok: true, json: async () => ({ id: 1, full_name: 'owner/repo', private: true, visibility: 'private' }) }),
      runGit: async (_command, args) => {
        if (args[0] === 'config') return Buffer.from('https://github.com/other/repo.git\n');
        if (args[0] === 'rev-parse') return Buffer.from(`${'a'.repeat(40)}\n`);
        if (args[0] === 'merge-base') return Buffer.from(`${'b'.repeat(40)}\n`);
        return Buffer.alloc(0);
      },
    }), { message: 'CHECKOUT_IDENTITY_MISMATCH' });
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});
