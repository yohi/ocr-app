import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createRoutingDecisionRecord, finalizeRoutingAudit, validateRoutingAudit, validateRoutingDecisionRecord } from './ocr-routing-audit.mjs';
import { publishRoutingReview } from './publish-routing-review.mjs';
import { runRoutingReview } from './run-routing-review.mjs';
import { evaluatePublishEligibility } from './evaluate-routing-publish.mjs';
import * as checkRun from './update-check-run.mjs';

const workflow = fs.readFileSync(new URL('../ocr-engine.yml', import.meta.url), 'utf8');
const step = name => workflow.split(`- name: ${name}\n`)[1]?.split('\n      - name:')[0] ?? '';
const binding = { workflowRunId: '123', runAttempt: 1, headSha: 'a'.repeat(40), mode: 'enforce' };
const route = { schema_version: '1', workflow_run_id: '123', run_attempt: 1, head_sha: binding.headSha,
  effective_mode: 'enforce', reviewable_file_count: 1, selected_model_id: 'primary', fallback_models: [], selected_strategy: 'deep' };
const catalog = { models: [{ model_id: 'primary', certification_status: 'certified', capability_tier: 'deep' }],
  strategies: { deep: { preferred_model_id: 'primary' } } };
const bundle = { catalog, evidence: { cli_available_models: ['primary'] } };
const event = fields => ({ schema_version: '1', run_attempt_id: 'b'.repeat(32), attempt_index: 1,
  event: 'attempt_started', model: 'primary', result: null, timestamp: '2026-10-22T00:00:00.000Z',
  duration_ms: null, host_status: null, ...fields });
const attempts = [event({}), event({ event: 'attempt_completed', result: 'host_validated_success', duration_ms: 1 }),
  event({ event: 'host_completed', attempt_index: null, model: null, host_status: 'success' })];

async function execute(name, imports, env = {}) {
  const body = step(name).match(/node --input-type=module - <<'EOF'\n([\s\S]*?)\n          EOF/)?.[1];
  assert.ok(body, `${name} must have an executable Node entrypoint`);
  const code = body.replace(/^          /gm, '')
    .replace(/^import (.+?) from '([^']+)';$/gm, (_, names, source) =>
      `const ${names.startsWith('{') ? names.replace(/ as /g, ': ') : `{ default: ${names} }`} = await imports('${source}');`)
    .replace(/\bimport\(/g, 'imports(');
  const process = { env, exitCode: 0, cwd: () => '.' };
  process.logs = [];
  const console = { error: (...values) => process.logs.push(values.join(' ')) };
  await new (Object.getPrototypeOf(async function () {}).constructor)('imports', 'process', 'console', code)(imports, process, console);
  return process;
}

function fixture(count = 1) {
  const decision = createRoutingDecisionRecord({ runBinding: binding,
    features: { classification_status: 'unclassified_code', risk_floor: 'deep', reviewable_file_count: count },
    decision: {}, egressStatus: 'denied', route: { proposedStrategy: null, selectedStrategy: count ? 'deep' : null,
      routeSource: count ? 'deterministic_fallback' : 'not_requested', decisionStatus: 'not_requested' },
    policyVersions: { policyVersion: '1', modelCatalogVersion: '1' } });
  const files = new Map([
    ['/run/ocr-routing/decision.json', JSON.stringify(decision)],
    ['/run/ocr-routing/attempts.ndjson', count ? attempts.map(JSON.stringify).join('\n') + '\n' : ''],
    ['/run/ocr-routing-state.json', JSON.stringify({ review_scope_gap: false, features_incomplete: false })],
    ['/tmp/ocr-result.json', JSON.stringify({ status: count ? 'success' : 'skipped' })],
    ['/run/ocr-review-context.json', '{}'],
    ['/run/ocr-routing-execution-context.json', '{}'],
  ]);
  const outputs = [];
  const fakeFs = { readFileSync: file => {
    if (files.has(file)) return files.get(file);
    if (file.includes('review-model-catalog.json')) return JSON.stringify(catalog);
    if (file.includes('review-certification-index.json')) return '{}';
    if (file.includes('review-risk-policy.json')) return '{}';
    throw new Error(`unexpected read: ${file}`);
  }, existsSync: file => files.has(file), lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => false }),
  appendFileSync: (_file, value) => outputs.push(value),
  writeFileSync: (file, value) => files.set(file, value) };
  const selected = { ...route, reviewable_file_count: count, selected_model_id: count ? 'primary' : null,
    selected_strategy: count ? 'deep' : null };
  files.set('/run/ocr-routing/final.json', JSON.stringify(finalizeRoutingAudit({ decision,
    attempts: count ? attempts : [], reviewResult: { status: count ? 'success' : 'skipped' },
    validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding,
    policy: { repoId: 7, repo: 'owner/repo', prNumber: 1, review_scope_gap: false, features_incomplete: false,
      selectedReviewModel: selected.selected_model_id }, catalog, selectedRoute: selected, certifiedBundle: bundle,
    runTemp: '/run', fs: fakeFs })));
  const env = { RUNNER_TEMP: '/run', GITHUB_OUTPUT: '/out', DECISION_ROUTING_MODE: 'enforce', COMMIT_SHA: binding.headSha,
    GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_REPOSITORY: 'central/repo',
    TARGET_REPO: 'owner/repo', PR_NUMBER: '1', GITHUB_TOKEN: 'target-test', CENTRAL_GITHUB_TOKEN: 'central-test',
    VALIDATION_STATUS: 'passed', HEAD_STATUS: 'passed', DELIVERY_OUTCOME: 'success', ARTIFACT_ID: 'artifact', CHECK_RUN_ID: '1',
    OCR_RESULT_PATH: '/tmp/ocr-result.json' };
  const calls = [];
  const revalidate = () => ({ startupAuthorization: { authorized: true, approvalRefs: [] }, certifiedBundle: count ? bundle : null });
  const authority = async input => {
    assert.equal(input.protectedRef, 'master');
    assert.equal(typeof input.fetchImpl, 'function');
    assert.ok(Number.isFinite(Date.parse(input.now)));
    assert.equal(input.token, 'central-test');
    calls.push('authority');
    return { registry: {}, operationalDossiers: {} };
  };
  const modules = {
    'node:fs': { default: fakeFs }, 'node:crypto': crypto, 'node:path': path,
    'node:child_process': { execFileSync: (command, args) => command === 'gh'
      ? args.includes('--jq') ? '7' : JSON.stringify({ id: 7, full_name: args[1].slice(6) }) : '' },
    'prepare-review-routing.mjs': { createRunBindingFromEnv: () => binding, readSelectedReviewRoute: () => selected },
    'ocr-run-binding.mjs': { createRunBindingFromEnv: env => ({ ...binding, mode: env.DECISION_ROUTING_MODE }) },
    'routing-authorization.mjs': { fetchCurrentRoutingAuthorization: authority, hashRoutingSourceManifest: () => `sha256:${'d'.repeat(64)}` },
    'routing-execution-context.mjs': { readRoutingExecutionContext: () => ({}), revalidateRoutingExecutionContext: revalidate },
    'load-review-certification.mjs': { readInstalledCliIdentity: () => ({ binarySha256: 'e'.repeat(64) }) },
    'evaluate-routing-publish.mjs': { evaluatePublishEligibility },
    'update-check-run.mjs': checkRun,
    'ocr-routing-audit.mjs': { finalizeRoutingAudit: input => finalizeRoutingAudit({ ...input, fs: fakeFs }),
      writeRoutingAudit: ({ record }) => files.set('/run/ocr-routing/final.json', JSON.stringify(record)),
      validateRoutingDecisionRecord, validateRoutingAudit },
    'publish-routing-review.mjs': { publishRoutingReview: async input => {
      const runTemp = fs.mkdtempSync(path.join(tmpdir(), 'workflow-publisher-'));
      try {
        fs.mkdirSync(path.join(runTemp, 'ocr-routing'));
        fs.writeFileSync(path.join(runTemp, 'ocr-routing/decision.json'), JSON.stringify(decision));
        return await publishRoutingReview({ ...input, runTemp,
          readExecutionContext: () => ({}), fetchAuthorization: authority, revalidateExecutionContext: revalidate,
          evaluateGate: () => ({ authorized: true }), checkHead: modules['check-pr-head.mjs'].fetchCurrentHead,
          readCliIdentity: () => ({ binarySha256: undefined }) });
      } finally { fs.rmSync(runTemp, { recursive: true, force: true }); }
    } },
    'check-pr-head.mjs': { fetchCurrentHead: () => binding.headSha },
    'post-ocr-comments.mjs': { run: async input => {
      assert.deepEqual(input.args, ['--repo', 'owner/repo', '--pr', '1', '--result', '/tmp/ocr-result.json']);
      assert.equal(input.expectedSha, binding.headSha);
      assert.equal(input.token, 'target-test');
      calls.push('post');
      return 1;
    } },
  };
  return { env, files, outputs, calls, modules, imports: async source => {
    const module = modules[source] ?? modules[source.split('/').at(-1)];
    assert.ok(module, `unexpected import: ${source}`);
    return module;
  } };
}

test('production off Host entrypoint runs without loading the routing catalog or preparation module', async () => {
  const value = fixture();
  const env = { ...value.env, DECISION_ROUTING_MODE: 'off' };
  let hosts = 0;
  value.modules['run-routing-review.mjs'] = { runRoutingReview };
  value.modules['antigravity-host.mjs'] = { runHost: async () => { hosts++; return { status: 'success' }; } };
  await execute('Run Antigravity review host', async source => {
    assert.ok(!source.endsWith('prepare-review-routing.mjs'), 'off must not import preparation dependencies');
    return value.imports(source);
  }, env);
  assert.equal(hosts, 1);
});

test('production shadow Host entrypoint reauthorizes absent routes with complete central authority inputs', async () => {
  const value = fixture();
  let hosts = 0;
  value.modules['run-routing-review.mjs'] = { runRoutingReview: input => runRoutingReview({ ...input,
    fetchCurrentAuthorization: value.modules['routing-authorization.mjs'].fetchCurrentRoutingAuthorization,
    evaluateStartup: () => ({ authorized: true }) }) };
  value.modules['antigravity-host.mjs'] = { runHost: async () => { hosts++; return { status: 'success' }; } };
  await execute('Run Antigravity review host', value.imports, { ...value.env, DECISION_ROUTING_MODE: 'shadow' });
  assert.deepEqual(value.calls, ['authority']);
  assert.equal(hosts, 1);
});

test('production finalizer supplies the certified route and run path for a nonempty review', async () => {
  const value = fixture();
  await execute('Finalize routing audit', value.imports, value.env);
  assert.equal(JSON.parse(value.files.get('/run/ocr-routing/final.json')).executed_review_model, 'primary');
});

test('production upload reauthorization accepts a normal zero-byte skip stream', async () => {
  const value = fixture(0);
  const result = await execute('Reauthorize routing audit upload', value.imports, value.env);
  assert.equal(result.exitCode, 0);
  assert.ok(value.outputs.includes('AUTHORIZED=true\n'));
  assert.deepEqual(value.calls, ['authority']);
});

test('production skip Gate uses fresh complete authority inputs and the real eligibility function', async () => {
  const value = fixture(0);
  const result = await execute('Evaluate routing publish eligibility', value.imports, value.env);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(value.calls, ['authority']);
  assert.ok(value.outputs.includes('PUBLISH_AUTHORIZED=true\n'));
});

test('production publisher never reports published before a failed real post', async () => {
  const value = fixture(0);
  const result = await execute('Publish enforce review', value.imports, value.env);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(value.calls, ['authority', 'post']);
  assert.ok(!value.outputs.some(output => output.includes('PUBLISHED=true')));
});

test('production publisher reports success only after its single real posting adapter succeeds', async () => {
  const value = fixture(0);
  value.modules['post-ocr-comments.mjs'].run = async () => {
    assert.ok(!value.outputs.some(output => output.includes('PUBLISHED=true')));
    value.calls.push('post');
    return 0;
  };
  const result = await execute('Publish enforce review', value.imports, value.env);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(value.calls, ['authority', 'post']);
  assert.deepEqual(value.outputs, ['PUBLISHED=true\n']);
});

test('routing artifact upload contains exactly the three public audit files', () => {
  const files = step('Upload routing audit').match(/path: \|\n([\s\S]*?)\n          if-no-files-found/)[1]
    .trim().split('\n').map(line => line.trim());
  assert.deepEqual(files, ['${{ runner.temp }}/ocr-routing/decision.json',
    '${{ runner.temp }}/ocr-routing/attempts.ndjson', '${{ runner.temp }}/ocr-routing/final.json']);
});

// Resolve the final step's actual Actions output references, so missing YAML
// wiring cannot be hidden by supplying the intended environment directly.
async function completedCheck(value, steps) {
  const env = { ...value.env, CONCLUSION: 'failure', RESULT_PATH: '/nonexistent-routing-test-result',
    DETAILS_URL: 'https://github.com/central/repo/actions/runs/123' };
  const block = step('Update Check Run completed');
  for (const match of block.matchAll(/^          ([A-Z_]+): \$\{\{ (steps\.[^\n]+?) \}\}$/gm)) {
    env[match[1]] = match[2].split(' || ').map(reference => {
      const [, id, field, key] = reference.match(/^steps\.([\w-]+)\.(outputs|outcome)(?:\.([\w-]+))?$/) ?? [];
      return field === 'outputs' ? steps[id]?.outputs?.[key] : steps[id]?.outcome;
    }).find(Boolean) ?? '';
  }
  let body;
  await checkRun.updateCheckRun({ env, fetchImpl: async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true };
  } });
  return body;
}

function stepResult(value, result) {
  return { outcome: result.exitCode ? 'failure' : 'success', outputs: Object.fromEntries(
    value.outputs.flatMap(output => output.trim().split('\n')).map(line => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    })) };
}

test('production failed post reaches the completed Check Run as PUBLISH_FAILED', async () => {
  const value = fixture(0);
  const result = await execute('Publish enforce review', value.imports, value.env);
  const body = await completedCheck(value, {
    'routing-gate': { outcome: 'success', outputs: { ROUTING_FAILURE_REASON: '' } },
    'publish-enforce': stepResult(value, result),
  });
  assert.equal(body.conclusion, 'failure');
  assert.match(body.output.summary, /理由: PUBLISH_FAILED\./);
});

test('production final HEAD revalidation failure reaches the Check Run as HEAD_CHANGED', async () => {
  const value = fixture(0);
  const body = await completedCheck(value, {
    'routing-gate': { outcome: 'success', outputs: { ROUTING_FAILURE_REASON: '' } },
    'revalidate-before-publish': { outcome: 'failure', outputs: { HEAD_FAILURE_REASON: 'HEAD_CHANGED' } },
    'publish-enforce': { outcome: 'skipped' },
  });
  assert.match(body.output.summary, /理由: HEAD_CHANGED\./);
});

test('final HEAD revalidation without a mismatch reason reports HEAD_VALIDATION_FAILED', async () => {
  const value = fixture(0);
  const body = await completedCheck(value, { 'revalidate-before-publish': { outcome: 'failure' } });
  assert.match(body.output.summary, /理由: HEAD_VALIDATION_FAILED\./);
});

for (const [outcome, artifactId] of [['failure', 'artifact'], ['success', '']]) {
  test(`production artifact delivery ${outcome}/${artifactId || 'missing ID'} reports ROUTING_AUDIT_MISSING`, async () => {
    const value = fixture(0);
    const result = await execute('Evaluate routing publish eligibility', value.imports,
      { ...value.env, DELIVERY_OUTCOME: outcome, ARTIFACT_ID: artifactId });
    assert.equal(result.exitCode, 1);
    const body = await completedCheck(value, { 'routing-gate': stepResult(value, result) });
    assert.match(body.output.summary, /理由: ROUTING_AUDIT_MISSING\./);
    assert.match(body.output.summary, /actions\/runs\/123/);
  });
}

for (const name of ['Reauthorize routing audit upload', 'Evaluate routing publish eligibility']) {
  for (const failure of ['filesystem', 'json', 'api', 'code']) {
    test(`${name} suppresses untrusted ${failure} diagnostics`, async () => {
      const value = fixture(0);
      const marker = 'PR_BODY_SECRET_SENTINEL';
      if (failure === 'filesystem') {
        value.modules['node:fs'].default.readFileSync = () => { throw new Error(marker); };
      } else if (failure === 'json') {
        value.files.set('/run/ocr-routing/decision.json', marker);
      } else {
        value.modules['routing-authorization.mjs'].fetchCurrentRoutingAuthorization = async () => {
          throw Object.assign(new Error(marker), failure === 'code' ? { code: marker } : {});
        };
      }
      const result = await execute(name, value.imports, value.env);
      assert.equal(result.exitCode, 1);
      assert.doesNotMatch(result.logs.join('\n'), /PR_BODY_SE|Unexpected token|not valid JSON/);
      assert.match(result.logs.join('\n'), /ROUTING_ACTIVATION_DENIED/);
    });
  }
}

test('publisher HEAD change after the workflow recheck reaches the Check Run as HEAD_CHANGED', async () => {
  const value = fixture(0);
  value.modules['check-pr-head.mjs'].fetchCurrentHead = () => 'b'.repeat(40);
  const result = await execute('Publish enforce review', value.imports, value.env);
  assert.equal(result.exitCode, 1);
  assert.ok(!value.calls.includes('post'));
  const body = await completedCheck(value, { 'publish-enforce': stepResult(value, result) });
  assert.match(body.output.summary, /理由: HEAD_CHANGED\./);
});

test('a publisher entrypoint JSON failure emits only a fixed reason and reaches the Check Run', async () => {
  const value = fixture(0);
  value.files.set('/run/ocr-routing/final.json', 'PR_BODY_SECRET_SENTINEL');
  const result = await execute('Publish enforce review', value.imports, value.env);
  assert.equal(result.exitCode, 1);
  assert.doesNotMatch(result.logs.join('\n'), /PR_BODY_SE|Unexpected token/);
  assert.ok(!value.calls.includes('post'));
  const body = await completedCheck(value, { 'publish-enforce': stepResult(value, result) });
  assert.match(body.output.summary, /理由: PUBLISH_FAILED\./);
});

test('failed gate reason is retained when later publication steps are skipped', async () => {
  const value = fixture(0);
  const body = await completedCheck(value, {
    'routing-gate': { outcome: 'failure', outputs: { ROUTING_FAILURE_REASON: 'REVIEW_SCOPE_GAP_BLOCKED' } },
    'revalidate-before-publish': { outcome: 'skipped' }, 'publish-enforce': { outcome: 'skipped' },
  });
  assert.match(body.output.summary, /理由: REVIEW_SCOPE_GAP_BLOCKED\./);
});

test('publisher failure with no output still reports PUBLISH_FAILED', async () => {
  const value = fixture(0);
  const body = await completedCheck(value, { 'publish-enforce': { outcome: 'failure', outputs: {} } });
  assert.match(body.output.summary, /理由: PUBLISH_FAILED\./);
});

test('shadow upload diagnostics retain their existing behavior', async () => {
  const value = fixture(0);
  value.modules['node:fs'].default.readFileSync = () => { throw new Error('shadow diagnostic'); };
  const result = await execute('Reauthorize routing audit upload', value.imports,
    { ...value.env, DECISION_ROUTING_MODE: 'shadow' });
  assert.equal(result.exitCode, 0);
  assert.match(result.logs.join('\n'), /shadow diagnostic/);
});
