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
  const env = { DECISION_ROUTING_MODE: 'enforce', DECISION_LLM_ENABLED: 'false', RUNNER_TEMP: '/tmp/run', ...(overrides.env ?? {}) };
  const expectedBinding = overrides.expectedBinding ?? {
    workflowRunId: '123', runAttempt: 1, headSha: 'a'.repeat(40), mode: env.DECISION_ROUTING_MODE,
    decisionLlmEnabled: env.DECISION_LLM_ENABLED === 'true',
  };
  const decision = ['shadow', 'enforce'].includes(expectedBinding.mode)
    || (expectedBinding.mode === 'off' && expectedBinding.decisionLlmEnabled === true) ? {
    schema_version: '1', effective_mode: expectedBinding.mode, decision_llm_enabled: expectedBinding.decisionLlmEnabled ?? false,
    head_sha: expectedBinding.headSha,
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
      readInstalledCliIdentity: async () => ({ binarySha256: '0'.repeat(64), resolvedPath: '/attested/bin/agy' }),
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

test('Given a routed Host attempt, When spawn authorization runs, Then central authority is fetched and evaluated again', async () => {
  let authorizationFetches = 0;
  let authorizationChecks = 0;
  let spawnAuthorization;
  const fixture = input({
    fetchCurrentAuthorization: async () => {
      authorizationFetches++;
      return { registry: { fetch: authorizationFetches }, operationalDossiers: {} };
    },
    evaluateStartup: ({ registry }) => {
      authorizationChecks++;
      return { authorized: registry.fetch === authorizationFetches };
    },
    runHost: async options => {
      spawnAuthorization = options.authorizeBeforeSpawn;
      return { status: 'success' };
    },
  });

  await runRoutingReview(fixture.args);
  assert.equal(typeof spawnAuthorization, 'function');
  assert.equal(await spawnAuthorization(), true);
  assert.equal(authorizationFetches, 2);
  assert.equal(authorizationChecks, 2);
});

test('Given authority is revoked at a retry boundary, When Host returns denial, Then routing guard suppresses later mutations', async () => {
  const outputs = [];
  const fixture = input({
    writeOutput: async value => outputs.push(value),
    runHost: async options => {
      assert.equal(await options.authorizeBeforeSpawn(), false);
      return { schema_version: '1.0', mode: 'review', status: 'failed', coverage: 0, findings: [], message: 'ROUTING_ACTIVATION_DENIED' };
    },
    fetchCurrentAuthorization: async () => ({ registry: {}, operationalDossiers: {} }),
    evaluateStartup: () => ({ authorized: false }),
  });

  const result = await runRoutingReview(fixture.args);
  assert.equal(result.message, 'ROUTING_ACTIVATION_DENIED');
  assert.deepEqual(outputs, ['ROUTE_GUARD_FAILED=true']);
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
      const outputs = [];
      let recorderCalls = 0;
      const fixture = input({
        env: { DECISION_ROUTING_MODE: mode },
        writeOutput: async value => outputs.push(value),
        createRecorder: async () => { recorderCalls++; return null; },
        readDecision: async () => invalidDecision === null || !invalidDecision.field
          ? invalidDecision
          : { ...fixture.decision, [invalidDecision.field]: invalidDecision.value,
            ...(invalidDecision.field === 'effective_mode'
              ? { selected_strategy: invalidDecision.value === 'shadow' ? null : 'deep' }
              : {}) },
      });
      const result = await runRoutingReview(fixture.args);
      assert.equal(result.status, 'failed', `${mode}: ${JSON.stringify(invalidDecision)}`);
      assert.equal(result.message, invalidDecision === null || !invalidDecision.field
        ? 'RUN_BINDING_INVALID' : 'RUN_BINDING_MISMATCH');
      assert.equal(fixture.calls.length, 0, `${mode}: ${JSON.stringify(invalidDecision)}`);
      assert.equal(recorderCalls, 0, `${mode}: recorder created before decision guard`);
      assert.deepEqual(outputs, ['ROUTE_GUARD_FAILED=true']);
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
      readInstalledCliIdentity: () => ({ binarySha256, resolvedPath: attestedAgy }),
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

test('Given off mode with decision opt-in, When invoked, Then the certified selected route reaches Host without target activation', async () => {
  let hostOptions;
  let startupEvaluations = 0;
  const registry = { schema_version: '1', approvals: [], activations: [], revoked_refs: [] };
  const fixture = input({
    env: { DECISION_ROUTING_MODE: 'off', DECISION_LLM_ENABLED: 'true', TARGET_REPO_PATH: '/tmp/justice' },
    readRoute: async () => ({ schema_version: '1', effective_mode: 'off', decision_llm_enabled: true,
      selected_model_id: 'certified-primary', selected_strategy: 'deep', fallback_models: ['certified-fallback'],
      reviewable_file_count: 2, status: 'prepared' }),
    readExecutionContext: async () => ({ binding: fixture.args.expectedBinding }),
    fetchCurrentAuthorization: async () => ({ registry, operationalDossiers: {} }),
    evaluateStartup: () => { startupEvaluations++; throw new Error('target activation must not be evaluated'); },
    revalidateExecutionContext: async ({ trustedInputs }) => {
      assert.equal(trustedInputs.needsModel, true);
      return { certifiedBundle: { catalog: { models: [{ model_id: 'certified-primary', certification_status: 'certified', capability_tier: 'deep' }] },
        evidence: { certification_refs: ['certified-primary'], cli_available_models: ['certified-primary', 'certified-fallback'] } } };
    },
    readInstalledCliIdentity: async () => ({ resolvedPath: '/attested/agy', binarySha256: 'a'.repeat(64) }),
    createRecorder: async () => ({ onAttemptEvent: () => {}, runAttemptId: 'a'.repeat(32), seal: () => {} }),
    runHost: async options => {
      hostOptions = options;
      assert.equal(await options.authorizeBeforeSpawn(), true);
      return { status: 'success' };
    },
  });
  fixture.args.trustedInputs = { certificationRepoIdentity: { repo_id: 1, full_name: 'central-org/central-repo' } };

  const result = await runRoutingReview(fixture.args);

  assert.equal(result.status, 'success');
  assert.equal(startupEvaluations, 0);
  assert.equal(hostOptions.routingMode, 'off');
  assert.equal(hostOptions.decisionLlmEnabled, true);
  assert.equal(hostOptions.model, 'certified-primary');
  assert.deepEqual(hostOptions.fallbackModels, ['certified-fallback']);
  assert.equal(hostOptions.executablePath, '/attested/agy');
});

test('Given off-mode opt-in with invalid certification, When invoked, Then Host does not run', async () => {
  const fixture = input({
    env: { DECISION_ROUTING_MODE: 'off', DECISION_LLM_ENABLED: 'true' },
    readRoute: async () => ({ schema_version: '1', effective_mode: 'off', decision_llm_enabled: true,
      selected_model_id: 'uncertified', selected_strategy: 'deep', fallback_models: [], reviewable_file_count: 1, status: 'prepared' }),
    fetchCurrentAuthorization: async () => ({ registry: { schema_version: '1', approvals: [], activations: [], revoked_refs: [] }, operationalDossiers: {} }),
    revalidateExecutionContext: async () => ({ certifiedBundle: null }),
  });

  const result = await runRoutingReview(fixture.args);

  assert.equal(result.status, 'failed');
  assert.deepEqual(fixture.calls, []);
});

test('Given opt-in env disagrees with the run binding, When invoked, Then Host is not called', async () => {
  const fixture = input({ env: { DECISION_ROUTING_MODE: 'off', DECISION_LLM_ENABLED: 'true' },
    expectedBinding: { workflowRunId: '123', runAttempt: 1, headSha: 'a'.repeat(40), mode: 'shadow', decisionLlmEnabled: false } });

  const result = await runRoutingReview(fixture.args);

  assert.equal(result.status, 'failed');
  assert.equal(result.message, 'RUN_BINDING_MISMATCH');
  assert.deepEqual(fixture.calls, []);
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

test('RED 3-2: enforce checks CLI identity before reading route or decision and fails closed on identity error', async () => {
  const order = [];
  const fixture = input({
    env: { DECISION_ROUTING_MODE: 'enforce', RUNNER_TEMP: '/tmp/run' },
    fetchCurrentAuthorization: async () => { order.push('auth'); return { registry: {}, operationalDossiers: {} }; },
    evaluateStartup: () => { order.push('startup'); return { authorized: true }; },
    readInstalledCliIdentity: async () => { order.push('identity'); throw new Error('REVIEW_CLI_UNAVAILABLE'); },
    readExecutionContext: async () => { order.push('context'); return validContext; },
    readRoute: async () => { order.push('route'); return { selected_model_id: 'certified-primary', selected_strategy: 'deep', fallback_models: [], reviewable_file_count: 2, status: 'prepared' }; },
    readDecision: async () => { order.push('decision'); return fixture.decision; },
  });
  const result = await runRoutingReview(fixture.args);
  assert.equal(result.message, 'ROUTING_ACTIVATION_DENIED');
  assert.deepEqual(order, ['auth', 'startup', 'identity']);
  assert.equal(fixture.calls.length, 0);
});

test('Given invalid CLI identity, When enforce routing runs, Then execution context is not read', async () => {
  const order = [];
  const fixture = input({
    env: { DECISION_ROUTING_MODE: 'enforce', RUNNER_TEMP: '/tmp/run' },
    fetchCurrentAuthorization: async () => ({ registry: {}, operationalDossiers: {} }),
    evaluateStartup: () => ({ authorized: true }),
    readInstalledCliIdentity: async () => { order.push('identity'); return null; },
    readExecutionContext: async () => { order.push('context'); return validContext; },
    readRoute: async () => ({ selected_model_id: 'certified-primary', selected_strategy: 'deep', fallback_models: [], reviewable_file_count: 2, status: 'prepared' }),
  });
  const result = await runRoutingReview(fixture.args);
  assert.equal(result.message, 'ROUTING_ACTIVATION_DENIED');
  assert.deepEqual(order, ['identity']);
});

test('RED 3-2: enforce rejects a malformed CLI identity before reading route or decision', async () => {
  const order = [];
  const outputs = [];
  const fixture = input({
    env: { DECISION_ROUTING_MODE: 'enforce', RUNNER_TEMP: '/tmp/run' },
    readInstalledCliIdentity: async () => { order.push('identity'); return { binarySha256: 'not-a-hash', resolvedPath: '/attested/bin/agy' }; },
    readRoute: async () => { order.push('route'); return { selected_model_id: 'certified-primary', selected_strategy: 'deep', fallback_models: [], reviewable_file_count: 2, status: 'prepared' }; },
    readDecision: async () => { order.push('decision'); return fixture.decision; },
    writeOutput: async value => outputs.push(value),
  });
  const result = await runRoutingReview(fixture.args);
  assert.equal(result.message, 'ROUTING_ACTIVATION_DENIED');
  assert.deepEqual(order, ['identity']);
  assert.equal(fixture.calls.length, 0);
  assert.deepEqual(outputs, ['ROUTE_GUARD_FAILED=true']);
});

test('RED 3-2: enforce CLI identity failure suppresses Host and publish output', async () => {
  const outputs = [];
  const fixture = input({
    env: { DECISION_ROUTING_MODE: 'enforce', RUNNER_TEMP: '/tmp/run' },
    readInstalledCliIdentity: async () => { throw new Error('REVIEW_CLI_UNAVAILABLE'); },
    writeOutput: async value => outputs.push(value),
  });
  const result = await runRoutingReview(fixture.args);
  assert.equal(result.status, 'failed');
  assert.equal(result.message, 'ROUTING_ACTIVATION_DENIED');
  assert.equal(fixture.calls.length, 0);
  assert.deepEqual(outputs, ['ROUTE_GUARD_FAILED=true']);
});

test('RED 3-2: enforce verifies CLI identity before route and decision in the success path', async () => {
  const order = [];
  const fixture = input({
    env: { DECISION_ROUTING_MODE: 'enforce', RUNNER_TEMP: '/tmp/run' },
    fetchCurrentAuthorization: async () => { order.push('auth'); return { registry: {}, operationalDossiers: {} }; },
    evaluateStartup: () => { order.push('startup'); return { authorized: true }; },
    readInstalledCliIdentity: async () => { order.push('identity'); return { binarySha256: '0'.repeat(64), resolvedPath: '/attested/bin/agy' }; },
    readRoute: async () => { order.push('route'); return { selected_model_id: 'certified-primary', selected_strategy: 'deep', fallback_models: ['certified-fallback'], reviewable_file_count: 2, status: 'prepared' }; },
    readDecision: async () => { order.push('decision'); return fixture.decision; },
  });
  await runRoutingReview(fixture.args);
  assert.equal(fixture.calls.length, 1);
  assert.deepEqual(order, ['auth', 'startup', 'identity', 'route', 'decision']);
});

test('RED 3-2: off and shadow modes do not read CLI identity', async () => {
  for (const mode of ['off', 'shadow']) {
    let identityCalls = 0;
    const fixture = input({
      env: { DECISION_ROUTING_MODE: mode, RUNNER_TEMP: '/tmp/run' },
      readInstalledCliIdentity: async () => { identityCalls++; return { binarySha256: '0'.repeat(64), resolvedPath: '/attested/bin/agy' }; },
      ...(mode === 'shadow' ? { readRoute: async () => ({ reviewable_file_count: 0, selected_model_id: null, fallback_models: [] }) } : {}),
    });
    const result = await runRoutingReview(fixture.args);
    assert.equal(result.status, 'success', `${mode}: expected success but got ${result.message}`);
    assert.equal(identityCalls, 0, `${mode}: CLI identity must not be read`);
  }
});

test('off-mode Decision LLM route remains usable after owner expiry while enforcing pinned model list', async () => {
  const pinnedCatalog = structuredClone(certifiedCatalog);
  pinnedCatalog.models = pinnedCatalog.models.map(model => ({
    ...model, certification_reference: `sha256:${createHash('sha256').update(model.model_id).digest('hex')}`,
  }));
  const primary = pinnedCatalog.strategies.deep.preferred_model_id;
  const fallback = pinnedCatalog.models.find(item => item.model_id === primary).allowed_fallbacks;
  const available = pinnedCatalog.models.map(item => item.model_id);
  const index = { cli_inventory: { approval_ref: 'OWNER-CLI' },
    certifications: pinnedCatalog.models.map(model => ({
      sha256: model.certification_reference.slice(7), approval_ref: `OWNER-${model.model_id}`,
    })) };
  const fixture = input({
    env: { DECISION_ROUTING_MODE: 'off', DECISION_LLM_ENABLED: 'true', TARGET_REPO_PATH: '/tmp/repo' },
    readRoute: async () => ({ selected_model_id: primary, selected_strategy: 'deep',
      fallback_models: fallback, reviewable_file_count: 1, status: 'prepared' }),
    readExecutionContext: async () => ({}),
    fetchCurrentAuthorization: async () => ({ registry: { schema_version: '1', approvals: [], activations: [],
      revoked_refs: [] }, operationalDossiers: {} }),
    revalidateExecutionContext: async () => ({ certifiedBundle: { catalog: pinnedCatalog,
      evidence: { certification_refs: [], cli_available_models: available,
        index, revokedRefs: [] } } }),
    readInstalledCliIdentity: async () => ({ resolvedPath: '/attested/agy', binarySha256: 'a'.repeat(64) }),
    trustedInputs: { catalog: pinnedCatalog, index },
    resolveModels: undefined,
    now: () => '2028-01-01T00:00:00.000Z',
    runHost: async options => {
      assert.equal(options.model, primary);
      assert.deepEqual(options.fallbackModels, fallback);
      assert.equal(await options.authorizeBeforeSpawn(), true);
      return { status: 'success' };
    },
  });
  assert.equal((await runRoutingReview(fixture.args)).status, 'success');
  const blocked = input({
    ...fixture.args,
    readRoute: async () => ({ selected_model_id: 'unallowlisted', selected_strategy: 'deep',
      fallback_models: [], reviewable_file_count: 1, status: 'prepared' }),
    runHost: async () => { throw new Error('MUST_NOT_SPAWN'); },
  });
  assert.equal((await runRoutingReview(blocked.args)).status, 'failed');
  assert.deepEqual(blocked.calls, []);
});


test('off-mode execution denies a newly revoked model before CLI spawn', async () => {
  const pinnedCatalog = structuredClone(certifiedCatalog);
  pinnedCatalog.models = pinnedCatalog.models.map(model => ({
    ...model, certification_reference: `sha256:${createHash('sha256').update(model.model_id).digest('hex')}`,
  }));
  const primary = pinnedCatalog.strategies.deep.preferred_model_id;
  const fallback = pinnedCatalog.models.find(item => item.model_id === primary).allowed_fallbacks;
  const available = pinnedCatalog.models.map(item => item.model_id);
  const index = { cli_inventory: { approval_ref: 'OWNER-CLI' },
    certifications: pinnedCatalog.models.map(model => ({
      sha256: model.certification_reference.slice(7), approval_ref: `OWNER-${model.model_id}`,
    })) };
  let reads = 0;
  const fixture = input({
    env: { DECISION_ROUTING_MODE: 'off', DECISION_LLM_ENABLED: 'true', TARGET_REPO_PATH: '/tmp/repo' },
    trustedInputs: { catalog: pinnedCatalog, index },
    resolveModels: undefined,
    readRoute: async () => ({ selected_model_id: primary, selected_strategy: 'deep',
      fallback_models: fallback, reviewable_file_count: 1, status: 'prepared' }),
    readExecutionContext: async () => ({}),
    fetchCurrentAuthorization: async () => ({
      registry: { schema_version: '1', approvals: [], activations: [],
        revoked_refs: reads++ === 0 ? [] : [`OWNER-${primary}`] },
      operationalDossiers: {},
    }),
    revalidateExecutionContext: async ({ trustedInputs }) => ({ certifiedBundle: {
      catalog: pinnedCatalog,
      evidence: { certification_refs: [], cli_available_models: available, index,
        revokedRefs: trustedInputs.registry.revoked_refs },
    } }),
    readInstalledCliIdentity: async () => ({ resolvedPath: '/attested/agy', binarySha256: 'a'.repeat(64) }),
    runHost: async options => {
      assert.equal(await options.authorizeBeforeSpawn(), false);
      return { status: 'failed', message: 'ROUTING_ACTIVATION_DENIED' };
    },
  });
  assert.equal((await runRoutingReview(fixture.args)).status, 'failed');
  assert.equal(reads, 2);
});
