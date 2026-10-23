import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runHost } from './antigravity-host.mjs';
import { runRoutingReview } from './run-routing-review.mjs';
import { resolveCertifiedModels } from './validate-review-model-catalog.mjs';
import { validateRoutingDecisionRecord } from './ocr-routing-audit.mjs';

const validContext = { binding: { mode: 'enforce' }, repo_identity: { repoId: 1, fullName: 'owner/repo' } };
const pendingCatalog = JSON.parse(readFileSync(new URL('../config/review-model-catalog.json', import.meta.url), 'utf8'));
const certifiedCatalog = structuredClone(pendingCatalog);
certifiedCatalog.models = certifiedCatalog.models.map((model, index) => ({
  ...model,
  certification_status: 'certified',
  certification_reference: `sha256:${String(index + 1).padStart(64, '0')}`,
}));
const certificationEvidence = {
  certification_refs: certifiedCatalog.models.map(model => ({
    certification_reference: model.certification_reference,
    model_id: model.model_id,
    capability_tier: model.capability_tier,
    catalog_version: model.catalog_version,
  })),
  cli_available_models: certifiedCatalog.models.map(model => model.model_id),
};

function input(overrides = {}) {
  const calls = [];
  const env = { DECISION_ROUTING_MODE: 'enforce', RUNNER_TEMP: '/tmp/run', ...(overrides.env ?? {}) };
  const expectedBinding = overrides.expectedBinding ?? {
    workflowRunId: '123', runAttempt: 1, headSha: 'a'.repeat(40), mode: env.DECISION_ROUTING_MODE,
  };
  const decision = ['shadow', 'enforce'].includes(expectedBinding.mode) ? {
    schema_version: '1', effective_mode: expectedBinding.mode, head_sha: expectedBinding.headSha,
    workflow_run_id: expectedBinding.workflowRunId, run_attempt: expectedBinding.runAttempt,
    classification_status: 'unclassified_code', risk_floor: 'deep', reviewable_file_count: 2,
    proposed_strategy: 'deep', selected_strategy: expectedBinding.mode === 'shadow' ? null : 'deep',
    route_source: 'deterministic_fallback', decision_status: 'unavailable', egress_status: 'denied',
    observer_status: 'not_started', decision_latency_ms: null, decision_api_cost: null,
    policy_version: 'v1', feature_schema_version: '3', decision_state_version: '1', model_catalog_version: 'v1',
  } : null;
  if (decision) validateRoutingDecisionRecord(decision);
  return {
    calls,
    decision,
    args: {
      env,
      context: validContext,
      prompt: 'review',
      runHost: async options => { calls.push(options); return { status: 'success' }; },
      runThreadHost: async options => { calls.push(options); return { status: 'success' }; },
      readRoute: async () => ({ selected_model_id: 'certified-primary', selected_strategy: 'deep', fallback_models: ['certified-fallback'], reviewable_file_count: 2, status: 'prepared' }),
      readDecision: async () => decision,
      readExecutionContext: async () => validContext,
      revalidateExecutionContext: async () => ({ certifiedBundle: { catalog: {}, evidence: { certification_refs: [], cli_available_models: ['certified-primary', 'certified-fallback'] } } }),
      fetchCurrentAuthorization: async () => ({ registry: {}, operationalDossiers: {} }),
      evaluateStartup: () => ({ authorized: true }),
      resolveModels: () => ({ primaryModelId: 'certified-primary', allowedFallbackModels: ['certified-fallback'] }),
      trustedInputs: { needsModel: true, catalog: { models: [{ model_id: 'certified-primary', certification_status: 'certified', capability_tier: 'deep', allowed_fallbacks: ['certified-fallback'] }, { model_id: 'certified-fallback', certification_status: 'certified', capability_tier: 'deep' }] } },
      readInstalledCliIdentity: async () => ({ binarySha256: 'verified-binary', resolvedPath: '/attested/bin/agy' }),
      createRecorder: async () => ({ onAttemptEvent: () => {}, runAttemptId: 'a'.repeat(32), seal: () => {} }),
      writeResult: async () => undefined,
      writeOutput: async () => undefined,
      onProgress: async () => undefined,
      repoIdentity: { repo_id: 1, full_name: 'owner/repo' },
      expectedBinding,
      ...overrides,
    },
  };
}

function hostChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: () => {}, once: () => {}, end: () => {} };
  queueMicrotask(() => {
    child.stdout.emit('data', JSON.stringify({ schema_version: '1.0', mode: 'review', status: 'success', coverage: 1, findings: [], message: 'ok' }));
    child.emit('close', 0, null);
  });
  return child;
}

test('Given revoked fresh authority, When invoked, Then Host is not called and denial is fixed', async () => {
  const fixture = input({
    revalidateExecutionContext: async () => { throw Object.assign(new Error('ROUTING_ACTIVATION_DENIED'), { code: 'ROUTING_ACTIVATION_DENIED' }); },
  });
  const result = await runRoutingReview(fixture.args);
  assert.deepStrictEqual(result, { schema_version: '1.0', mode: 'review', status: 'failed', coverage: 0, findings: [], message: 'ROUTING_ACTIVATION_DENIED' });
  assert.equal(fixture.calls.length, 0);
});

test('Given authorized enforce route, When invoked, Then exact certified model and audit options reach Host', async () => {
  const fixture = input();
  await runRoutingReview(fixture.args);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].model, 'certified-primary');
  assert.deepEqual(fixture.calls[0].fallbackModels, ['certified-fallback']);
  assert.equal(fixture.calls[0].onProgress, undefined);
  assert.equal(typeof fixture.calls[0].onAttemptEvent, 'function');
  assert.equal(fixture.calls[0].runAttemptId, 'a'.repeat(32));
  assert.equal(fixture.calls[0].executablePath, '/attested/bin/agy');
  assert.equal(fixture.calls[0].routingMode, 'enforce');
});

test('Given a missing, invalid, or differently bound decision, When routing runs, Then neither mode starts Host', async () => {
  for (const mode of ['shadow', 'enforce']) {
    for (const invalidDecision of [
      null,
      {},
      { field: 'workflow_run_id', value: '456' },
      { field: 'run_attempt', value: 2 },
      { field: 'head_sha', value: 'b'.repeat(40) },
      { field: 'effective_mode', value: mode === 'shadow' ? 'enforce' : 'shadow' },
    ]) {
      const fixture = input({
        env: { DECISION_ROUTING_MODE: mode },
        readDecision: async () => invalidDecision === null || !invalidDecision.field
          ? invalidDecision
          : { ...fixture.decision, [invalidDecision.field]: invalidDecision.value,
            ...(invalidDecision.field === 'effective_mode'
              ? { selected_strategy: invalidDecision.value === 'shadow' ? null : 'deep' }
              : {}) },
      });
      const result = await runRoutingReview(fixture.args);
      assert.equal(result.status, 'failed', `${mode}: ${JSON.stringify(invalidDecision)}`);
      assert.equal(fixture.calls.length, 0, `${mode}: ${JSON.stringify(invalidDecision)}`);
    }
  }
});

test('Given nested certification evidence and the real model resolver, When invoked, Then the certified route reaches Host', async () => {
  const primaryModelId = certifiedCatalog.strategies.deep.preferred_model_id;
  const fallbackModels = certifiedCatalog.models.find(model => model.model_id === primaryModelId).allowed_fallbacks;
  const fixture = input({
    trustedInputs: { catalog: certifiedCatalog },
    readRoute: async () => ({ selected_model_id: primaryModelId, selected_strategy: 'deep',
      fallback_models: [...fallbackModels], reviewable_file_count: 2, status: 'prepared' }),
    revalidateExecutionContext: async () => ({ certifiedBundle: { catalog: certifiedCatalog, evidence: certificationEvidence } }),
    resolveModels: resolveCertifiedModels,
  });
  await runRoutingReview(fixture.args);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].model, primaryModelId);
  assert.deepEqual(fixture.calls[0].fallbackModels, fallbackModels);
});

test('Given a fake PATH agy and distinct attested executable, When enforce runs, Then only attested path is spawned', async () => {
  const root = mkdtempSync(join(tmpdir(), 'routing-host-'));
  try {
    const fakePath = join(root, 'path');
    const attestedDir = join(root, 'attested');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(fakePath);
    mkdirSync(attestedDir);
    const fakeAgy = join(fakePath, 'agy');
    const attestedAgy = join(attestedDir, 'agy');
    writeFileSync(fakeAgy, '#!/bin/sh\nexit 9\n');
    writeFileSync(attestedAgy, '#!/bin/sh\nexit 0\n');
    chmodSync(fakeAgy, 0o755);
    chmodSync(attestedAgy, 0o755);
    const binarySha256 = createHash('sha256').update(await import('node:fs').then(fs => fs.readFileSync(attestedAgy))).digest('hex');
    const commands = [];
    const fixture = input({
      env: { DECISION_ROUTING_MODE: 'enforce', RUNNER_TEMP: root, PATH: fakePath },
      runHost,
      cwd: root,
      readInstalledCliIdentity: async () => ({ binarySha256, resolvedPath: attestedAgy }),
      revalidateExecutionContext: async ({ cliBinarySha256 }) => {
        if (cliBinarySha256 !== binarySha256) throw new Error('REVIEW_CERTIFICATION_INVALID');
        return { certifiedBundle: { catalog: {}, evidence: { certification_refs: [],
          cli_available_models: ['certified-primary', 'certified-fallback'] } } };
      },
      spawn: command => { commands.push(command); return hostChild(); },
    });
    const result = await runRoutingReview(fixture.args);
    assert.equal(result.status, 'success', result.message);
    assert.deepEqual(commands, [attestedAgy]);

    commands.length = 0;
    const mismatched = input({
      env: { DECISION_ROUTING_MODE: 'enforce', RUNNER_TEMP: root, PATH: fakePath },
      runHost,
      cwd: root,
      readInstalledCliIdentity: async () => ({ binarySha256: '0'.repeat(64), resolvedPath: attestedAgy }),
      revalidateExecutionContext: async () => { throw new Error('REVIEW_CERTIFICATION_INVALID'); },
      spawn: command => { commands.push(command); return hostChild(); },
    });
    const denied = await runRoutingReview(mismatched.args);
    assert.equal(denied.message, 'ROUTING_ACTIVATION_DENIED');
    assert.deepEqual(commands, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Given enforce route with no reviewable files, When invoked, Then it returns trusted skipped without Host or model proof', async () => {
  const observed = { events: [], sealCalled: false };
  const fixture = input({
    readRoute: async () => ({ reviewable_file_count: 0, selected_model_id: null, fallback_models: [] }),
    revalidateExecutionContext: async ({ trustedInputs }) => {
      assert.equal(trustedInputs.needsModel, false);
      return { certifiedBundle: null };
    },
    createRecorder: async () => ({ runAttemptId: 'b'.repeat(32), onAttemptEvent: event => observed.events.push(event), seal: () => { observed.sealCalled = true; } }),
  });
  const result = await runRoutingReview(fixture.args);
  assert.deepStrictEqual(result, { schema_version: '1.0', mode: 'review', status: 'skipped', coverage: 0, findings: [], message: 'REVIEW_SKIPPED_NO_REVIEWABLE_FILES' });
  assert.equal(observed.sealCalled, true);
  assert.deepEqual(observed.events, []);
  assert.equal(fixture.calls.length, 0);
});

test('Given invalid certification evidence, When invoked, Then Host is not called', async () => {
  const fixture = input({
    revalidateExecutionContext: async () => { throw new Error('REVIEW_CERTIFICATION_INVALID'); },
  });
  const result = await runRoutingReview(fixture.args);
  assert.equal(result.status, 'failed');
  assert.equal(result.message, 'ROUTING_ACTIVATION_DENIED');
  assert.equal(fixture.calls.length, 0);
});

test('Given a cached registry but revoked fresh authority, When invoked, Then Host is not called', async () => {
  const fixture = input({
    trustedInputs: { registry: { cached: true }, operationalDossiers: { cached: true } },
    evaluateStartup: input => {
      assert.deepEqual(input.registry, { fresh: true });
      assert.deepEqual(input.operationalDossiers, { fresh: true });
      return { authorized: false };
    },
    fetchCurrentAuthorization: async () => ({ registry: { fresh: true }, operationalDossiers: { fresh: true } }),
  });
  const result = await runRoutingReview(fixture.args);
  assert.equal(result.message, 'ROUTING_ACTIVATION_DENIED');
  assert.equal(fixture.calls.length, 0);
});

test('Given shadow context binding mismatch, When invoked, Then Host is not called', async () => {
  const outputs = [];
  const fixture = input({
    env: { DECISION_ROUTING_MODE: 'shadow', RUNNER_TEMP: '/tmp/run' },
    readRoute: async () => ({ reviewable_file_count: 1 }),
    revalidateExecutionContext: async () => { throw Object.assign(new Error('ROUTING_EXECUTION_CONTEXT_INVALID'), { code: 'ROUTING_EXECUTION_CONTEXT_INVALID' }); },
    writeOutput: async value => outputs.push(value),
  });
  const result = await runRoutingReview(fixture.args);
  assert.equal(result.status, 'failed');
  assert.equal(result.message, 'ROUTING_EXECUTION_CONTEXT_INVALID');
  assert.equal(fixture.calls.length, 0);
  assert.deepEqual(outputs, ['ROUTE_GUARD_FAILED=true']);
});

test('Given shadow observer setup failure, When invoked, Then Host continues without observer', async () => {
  const legacyResult = { status: 'success', output: 'legacy-result' };
  const onProgress = () => {};
  const fixture = input({
    env: { DECISION_ROUTING_MODE: 'shadow', RUNNER_TEMP: '/tmp/run' },
    readRoute: async () => ({ reviewable_file_count: 1 }),
    revalidateExecutionContext: async () => ({ certifiedBundle: null }),
    createRecorder: async () => { throw new Error('observer unavailable'); },
    model: 'legacy-model',
    fallbackModels: ['legacy-fallback'],
    onProgress,
    runHost: async options => { fixtureOptions = options; return legacyResult; },
  });
  let fixtureOptions;
  const result = await runRoutingReview(fixture.args);
  assert.deepEqual(result, legacyResult);
  assert.equal(fixtureOptions.routingMode, 'shadow');
  assert.equal(fixtureOptions.onAttemptEvent, undefined);
  assert.equal(fixtureOptions.model, 'legacy-model');
  assert.deepEqual(fixtureOptions.fallbackModels, ['legacy-fallback']);
  assert.equal(fixtureOptions.onProgress, onProgress);
});

test('Given off mode, When invoked, Then legacy Host runs without routing reads', async () => {
  const onProgress = () => {};
  const routingReads = { context: 0, route: 0, decision: 0 };
  const legacyHostOptions = { model: 'legacy-model', fallbackModels: ['legacy-fallback'], retryCount: 4,
    retryDelayMs: 250, customOption: 'preserved' };
  const fixture = input({
    env: { DECISION_ROUTING_MODE: 'off' },
    onProgress,
    ...legacyHostOptions,
    readExecutionContext: async () => { routingReads.context++; return validContext; },
    readRoute: async () => { routingReads.route++; return null; },
    readDecision: async () => { routingReads.decision++; return null; },
  });
  await runRoutingReview(fixture.args);
  assert.equal(fixture.calls.length, 1);
  assert.deepEqual(Object.fromEntries(Object.keys(legacyHostOptions).map(key => [key, fixture.calls[0][key]])), legacyHostOptions);
  assert.equal(fixture.calls[0].onProgress, onProgress);
  assert.deepEqual(routingReads, { context: 0, route: 0, decision: 0 });
});

test('Given shadow route binding mismatch, When invoked, Then no Host runs and only fixed denial is returned', async () => {
  const outputs = [];
  const fixture = input({
    env: { DECISION_ROUTING_MODE: 'shadow', RUNNER_TEMP: '/tmp/run' },
    readRoute: async () => ({ selected_model_id: 'proposal', reviewable_file_count: 1 }),
    revalidateExecutionContext: async () => { throw Object.assign(new Error('bad binding'), { code: 'ROUTING_EXECUTION_CONTEXT_INVALID' }); },
    writeOutput: async value => outputs.push(value),
  });
  const result = await runRoutingReview(fixture.args);
  assert.equal(result.message, 'ROUTING_EXECUTION_CONTEXT_INVALID');
  assert.deepEqual(fixture.calls, []);
  assert.deepEqual(outputs, ['ROUTE_GUARD_FAILED=true']);
});

test('Given shadow route absence, When invoked, Then fresh authorization precedes legacy Host without context or observer', async () => {
  const outputs = [];
  const order = [];
  const fixture = input({ env: { DECISION_ROUTING_MODE: 'shadow', RUNNER_TEMP: '/tmp/run' },
    readRoute: async () => null,
    readExecutionContext: async () => { throw new Error('missing context must not be read for absent route'); },
    fetchCurrentAuthorization: async () => { order.push('authorize'); return { registry: {} }; },
    runHost: async options => { order.push('host'); assert.equal(options.onAttemptEvent, undefined); return { status: 'success' }; },
    writeOutput: async value => outputs.push(value) });
  const result = await runRoutingReview(fixture.args);
  assert.equal(result.status, 'success');
  assert.deepEqual(order, ['authorize', 'host']);
  assert.deepEqual(outputs, []);
});

test('shadow missing route cannot bypass freshly revoked activation', async () => {
  const fixture = input({ env: { DECISION_ROUTING_MODE: 'shadow' }, readRoute: async () => null,
    fetchCurrentAuthorization: async () => ({ registry: {} }), evaluateStartup: () => ({ authorized: false }) });
  assert.equal((await runRoutingReview(fixture.args)).message, 'ROUTING_ACTIVATION_DENIED');
  assert.deepEqual(fixture.calls, []);
});

test('off runs in a clean process with routing dependencies unavailable', () => {
  const loader = `export async function resolve(specifier, context, next) {
    if (specifier.startsWith('ajv')) throw new Error('routing dependency unavailable');
    return next(specifier, context);
  }`;
  const moduleUrl = new URL('./run-routing-review.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--experimental-loader', `data:text/javascript,${encodeURIComponent(loader)}`,
    '--input-type=module', '-e', `const {runRoutingReview} = await import(${JSON.stringify(moduleUrl)});
      const result = await runRoutingReview({env:{DECISION_ROUTING_MODE:'off'},runHost:async()=>({status:'success'})});
      if(result.status!=='success') process.exit(1);`], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
});
