import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { publishRoutingReview } from './publish-routing-review.mjs';
import { evaluatePublishEligibility } from './evaluate-routing-publish.mjs';

const runBinding = { workflowRunId: '9007199254740993', runAttempt: 2, headSha: 'a'.repeat(40), mode: 'enforce' };
const catalog = JSON.parse(readFileSync(new URL('../config/review-model-catalog.json', import.meta.url), 'utf8'));
const fastEntry = catalog.models.find(model => model.capability_tier === 'fast');
const selectedModel = fastEntry.model_id;
const fallbackModel = fastEntry.allowed_fallbacks[0];
const resultBytes = Buffer.from('{"status":"success","coverage":1,"findings":[]}\n');
const resultSha256 = createHash('sha256').update(resultBytes).digest('hex');
const certifiedCatalog = { ...catalog, models: catalog.models.map(model => ({ ...model,
  certification_status: 'certified', certification_reference: `sha256:${'b'.repeat(64)}` })) };
const verifiedCertificationRefs = certifiedCatalog.models.map(model => ({
  certification_reference: model.certification_reference,
  model_id: model.model_id,
  capability_tier: model.capability_tier,
  catalog_version: model.catalog_version,
}));
const selectedRoute = {
  schema_version: '1', workflow_run_id: runBinding.workflowRunId, run_attempt: runBinding.runAttempt,
  head_sha: runBinding.headSha, effective_mode: 'enforce', status: 'prepared', reviewable_file_count: 1,
  selected_strategy: 'fast', selected_model_id: selectedModel, fallback_models: fastEntry.allowed_fallbacks,
  proposed_strategy: 'fast', route_source: 'deterministic_fallback', decision_status: 'unavailable',
  policy_version: '1.0.0', model_catalog_version: catalog.catalog_version,
};
const finalAudit = {
  schema_version: '3', repo_id: 42, repo: 'owner/repo', pr_number: 7, head_sha: runBinding.headSha,
  workflow_run_id: runBinding.workflowRunId, run_attempt: runBinding.runAttempt, effective_mode: 'enforce',
  decision_status: 'unavailable', egress_status: 'denied', classification_status: 'unclassified_code', risk_floor: 'fast',
  selected_strategy: 'fast', proposed_strategy: 'fast', policy_version: '1.0.0', feature_schema_version: '3',
  decision_state_version: '1', model_catalog_version: catalog.catalog_version, owner_approval_ref: null,
  proposed_review_model: selectedModel, selected_review_model: selectedModel, host_success_model: fallbackModel,
  executed_review_model: fallbackModel, attempted_review_models: [selectedModel, fallbackModel], result_sha256: resultSha256,
  review_validation_status: 'passed', head_validation_status: 'passed', audit_status: 'sealed', review_scope_gap: false,
  features_incomplete: false, review_quality_measured: true, decision_api_cost: null, latency_ms: null,
};
const decisionRecord = {
  schema_version: '1', effective_mode: 'enforce', head_sha: runBinding.headSha, workflow_run_id: runBinding.workflowRunId, run_attempt: 2,
  classification_status: 'unclassified_code', risk_floor: 'fast', reviewable_file_count: 1,
  proposed_strategy: 'fast', selected_strategy: 'fast', route_source: 'deterministic_fallback',
  decision_status: 'unavailable', egress_status: 'denied', observer_status: 'not_started',
  decision_latency_ms: null, decision_api_cost: null, policy_version: '1.0.0', feature_schema_version: '3',
  decision_state_version: '1', model_catalog_version: catalog.catalog_version,
};
const event = (fields) => ({ schema_version: '1', run_attempt_id: 'c'.repeat(32),
  attempt_index: 1, event: 'attempt_started', model: selectedModel, result: null,
  timestamp: '2026-10-21T12:00:00.000Z', duration_ms: null, host_status: null, ...fields });
const attemptRecord = [
  event({}), event({ event: 'attempt_completed', result: 'model_reported_failure', duration_ms: 5 }),
  event({ event: 'attempt_started', attempt_index: 2, model: fallbackModel }),
  event({ event: 'attempt_completed', attempt_index: 2, model: fallbackModel, result: 'host_validated_success', duration_ms: 5 }),
  event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 10, host_status: 'success' }),
];
const delivery = { outcome: 'success', artifactId: 'artifact-1', runId: runBinding.workflowRunId, runAttempt: runBinding.runAttempt };
const sealed = { cli_binary_sha256: 'c'.repeat(64) };

function fixture({
  route = selectedRoute,
  chain = attemptRecord,
  authorization = { authorized: true, approvalRefs: ['OWNER-APPROVED'] },
  fetchError,
  revalidateError,
  headSha = runBinding.headSha,
  postError,
  outputError,
  upload = delivery,
  checkRunId = '123',
} = {}) {
  const runTemp = mkdtempSync(join(tmpdir(), 'publish-routing-review-'));
  mkdirSync(join(runTemp, 'ocr-routing'));
  writeFileSync(join(runTemp, 'ocr-routing', 'decision.json'), JSON.stringify(decisionRecord));
  const resultPath = join(runTemp, 'ocr-result.json');
  writeFileSync(resultPath, resultBytes);
  const calls = [];
  const outputs = [];
  const resultPaths = [];
  let postCalls = 0;
  let fetchCalls = 0;
  let revalidationCalls = 0;
  const args = {
    env: { GITHUB_TOKEN: 'token', TARGET_REPO: 'owner/repo', PR_NUMBER: '7', TARGET_REPO_PATH: 'target-repo',
      CENTRAL_REPO_ID: '99', CENTRAL_REPO_FULL_NAME: 'central/workflows', OCR_RESULT_PATH: resultPath },
    runBinding,
    runTemp,
    selectedRoute: route,
    attemptRecord: chain,
    finalAudit: { ...finalAudit },
    delivery: upload,
    checkRunId,
    trustedInputs: {
      policySha256: `sha256:${'b'.repeat(64)}`,
      catalogSha256: `sha256:${'b'.repeat(64)}`,
      sourceManifestSha256: `sha256:${'b'.repeat(64)}`,
      catalog: certifiedCatalog,
      index: {},
      repoIdentity: { repo_id: 42, full_name: 'owner/repo' },
      fetchImpl: async () => {},
    },
    readExecutionContext: async () => sealed,
    fetchAuthorization: async () => {
      fetchCalls += 1;
      if (fetchError) throw fetchError;
      return { registry: {}, operationalDossiers: {} };
    },
    readCliIdentity: async () => ({ binarySha256: sealed.cli_binary_sha256 }),
    revalidateExecutionContext: async input => {
      revalidationCalls += 1;
      if (revalidateError) throw revalidateError;
      assert.equal(input.trustedInputs.needsModel, true);
      return { startupAuthorization: authorization, certifiedBundle: { catalog: certifiedCatalog,
        evidence: { certification_refs: verifiedCertificationRefs,
          cli_available_models: certifiedCatalog.models.map(model => model.model_id) } } };
    },
    evaluateGate: async input => {
      calls.push('gate');
      assert.equal(input.decisionRecord.schema_version, '1');
      assert.equal(input.certifiedBundle.catalog, certifiedCatalog);
      return evaluatePublishEligibility(input);
    },
    checkHead: async input => {
      calls.push('head');
      assert.equal(input.expectedSha, runBinding.headSha);
      return headSha;
    },
    postReview: async input => {
      calls.push('post');
      postCalls += 1;
      resultPaths.push(input.args.at(-1));
      assert.equal(input.env.TARGET_REPO, input.args[1]);
      assert.equal(input.expectedSha, runBinding.headSha);
      assert.equal(input.expectedResultSha256, finalAudit.result_sha256);
      assert.deepEqual(input.args.slice(0, 4), ['--repo', 'owner/repo', '--pr', '7']);
      if (postError) throw postError;
      return 0;
    },
    writeOutput: async output => {
      if (outputError) throw outputError;
      outputs.push(output);
    },
    now: () => '2026-10-21T12:00:00.000Z',
  };
  return { args, calls, outputs, resultPaths, resultPath, get postCalls() { return postCalls; }, get fetchCalls() { return fetchCalls; },
    get revalidationCalls() { return revalidationCalls; }, cleanup: () => rmSync(runTemp, { recursive: true, force: true }) };
}

test('valid fallback publishes in gate, head, post order', async () => {
  const value = fixture();
  try {
    const result = await publishRoutingReview(value.args);
    assert.equal(result.published, true);
    assert.equal(result.reason, 'PUBLISHED');
    assert.deepEqual(value.calls, ['gate', 'head', 'post']);
    assert.equal(value.postCalls, 1);
    assert.equal(value.outputs[0].content, 'PUBLISHED=true\n');
  } finally { value.cleanup(); }
});

test('does not call post adapter for missing result digest', async () => {
  const value = fixture();
  delete value.args.finalAudit.result_sha256;
  try {
    const result = await publishRoutingReview(value.args);
    assert.equal(result.published, false);
    assert.equal(result.reason, 'AUDIT_INCOMPLETE');
    assert.equal(value.postCalls, 0);
  } finally { value.cleanup(); }
});

test('does not call post adapter for changed result bytes', async () => {
  const value = fixture();
  writeFileSync(value.resultPath, '{"status":"success","coverage":0,"findings":[]}\n');
  try {
    const result = await publishRoutingReview(value.args);
    assert.equal(result.published, false);
    assert.equal(result.reason, 'PUBLISH_FAILED');
    assert.equal(value.postCalls, 0);
  } finally { value.cleanup(); }
});

test('re-fetches central authority for each mutation callback', async () => {
  const value = fixture();
  let authorizeBeforeMutation;
  value.args.postReview = async input => {
    authorizeBeforeMutation = input.authorizeBeforeMutation;
    return 0;
  };
  try {
    const result = await publishRoutingReview(value.args);
    assert.equal(result.published, true);
    assert.equal(await authorizeBeforeMutation(), true);
    assert.equal(await authorizeBeforeMutation(), true);
    assert.equal(value.fetchCalls, 3);
    assert.equal(value.revalidationCalls, 3);
    assert.equal(value.calls.filter(call => call === 'gate').length, 3);
  } finally { value.cleanup(); }
});

test('denies mutation when fresh authority, context, CLI identity, or Gate fails', async () => {
  const failures = [
    ['authority GET', value => {
      let reads = 0;
      const fetch = value.args.fetchAuthorization;
      value.args.fetchAuthorization = async input => {
        reads++;
        if (reads === 2) throw new Error('revoked');
        return fetch(input);
      };
    }],
    ['context revalidation', value => {
      let reads = 0;
      const revalidate = value.args.revalidateExecutionContext;
      value.args.revalidateExecutionContext = async input => {
        reads++;
        if (reads === 2) throw new Error('context changed');
        return revalidate(input);
      };
    }],
    ['CLI identity', value => {
      let reads = 0;
      const readIdentity = value.args.readCliIdentity;
      value.args.readCliIdentity = async input => {
        reads++;
        if (reads === 2) return { binarySha256: 'd'.repeat(64) };
        return readIdentity(input);
      };
    }],
    ['fresh Gate', value => {
      let evaluations = 0;
      const evaluate = value.args.evaluateGate;
      value.args.evaluateGate = async input => {
        evaluations++;
        if (evaluations === 2) return { authorized: false, reason: 'ROUTING_ACTIVATION_DENIED' };
        return evaluate(input);
      };
    }],
  ];

  for (const [failureName, configure] of failures) {
    const value = fixture();
    configure(value);
    let callbackAuthorized;
    value.args.postReview = async input => {
      callbackAuthorized = await input.authorizeBeforeMutation();
      return 1;
    };
    try {
      const result = await publishRoutingReview(value.args);
      assert.equal(callbackAuthorized, false, failureName);
      assert.equal(result.published, false, failureName);
      assert.equal(result.reason, 'PUBLISH_FAILED', failureName);
    } finally { value.cleanup(); }
  }
});

test('publication uses the run-scoped result path when OCR_RESULT_PATH is unset', async () => {
  const value = fixture();
  delete value.args.env.OCR_RESULT_PATH;
  try {
    const result = await publishRoutingReview(value.args);
    assert.equal(result.published, true);
    assert.equal(value.resultPaths[0], join(value.args.runTemp, 'ocr-result.json'));
  } finally { value.cleanup(); }
});

test('startup revocation thrown by provenance revalidation does not check Gate, HEAD, or post', async () => {
  const value = fixture({ revalidateError: Object.assign(new Error('revoked'), { code: 'ROUTING_ACTIVATION_DENIED' }) });
  try {
    const result = await publishRoutingReview(value.args);
    assert.equal(result.published, false);
    assert.equal(result.reason, 'ROUTING_ACTIVATION_DENIED');
    assert.equal(value.postCalls, 0);
    assert.deepEqual(value.calls, []);
    assert.equal(value.revalidationCalls, 1);
  } finally { value.cleanup(); }
});

test('route mismatch or invalid chain gate denial does not post', async () => {
  const value = fixture({ route: { ...selectedRoute, selected_model_id: 'wrong-model' } });
  try {
    const result = await publishRoutingReview(value.args);
    assert.equal(result.published, false);
    assert.equal(result.reason, 'ROUTE_ATTEMPT_MISMATCH');
    assert.equal(value.postCalls, 0);
    assert.deepEqual(value.calls, ['gate']);
  } finally { value.cleanup(); }
});

test('fresh central authorization GET failure stops before revalidation and all publication calls', async () => {
  const value = fixture({ fetchError: Object.assign(new Error('unavailable'), { code: 'ROUTING_AUTHORITY_UNAVAILABLE' }) });
  try {
    const result = await publishRoutingReview(value.args);
    assert.equal(value.postCalls, 0);
    assert.equal(result.published, false);
    assert.equal(result.reason, 'ROUTING_AUTHORITY_UNAVAILABLE');
    assert.equal(value.fetchCalls, 1);
    assert.equal(value.revalidationCalls, 0);
    assert.deepEqual(value.calls, []);
  } finally { value.cleanup(); }
});

test('execution context revalidation failure does not proceed to Gate, HEAD, or post', async () => {
  const value = fixture({ revalidateError: Object.assign(new Error('denied'), { code: 'ROUTING_ACTIVATION_DENIED' }) });
  try {
    const result = await publishRoutingReview(value.args);
    assert.equal(value.postCalls, 0);
    assert.equal(result.published, false);
    assert.equal(result.reason, 'ROUTING_ACTIVATION_DENIED');
    assert.equal(value.fetchCalls, 1);
    assert.equal(value.revalidationCalls, 1);
    assert.deepEqual(value.calls, []);
  } finally { value.cleanup(); }
});

test('reverse fallback chain rejects a deep success followed by the fast primary', async () => {
  const reversedChain = [
    event({ model: fallbackModel }),
    event({ event: 'attempt_completed', model: fallbackModel, result: 'host_validated_success', duration_ms: 5 }),
    event({ event: 'attempt_started', attempt_index: 2, model: selectedModel }),
    event({ event: 'attempt_completed', attempt_index: 2, model: selectedModel, result: 'model_reported_failure', duration_ms: 5 }),
    event({ event: 'host_completed', attempt_index: null, model: null, result: null, duration_ms: 10, host_status: 'success' }),
  ];
  const value = fixture({ chain: reversedChain });
  try {
    const result = await publishRoutingReview(value.args);
    assert.equal(value.postCalls, 0);
    assert.equal(result.published, false);
    assert.equal(result.reason, 'ROUTE_ATTEMPT_MISMATCH');
    assert.deepEqual(value.calls, ['gate']);
  } finally { value.cleanup(); }
});

test('authorized publication refuses a changed current HEAD', async () => {
  const value = fixture({ headSha: 'd'.repeat(40) });
  try {
    const result = await publishRoutingReview(value.args);
    assert.equal(result.published, false);
    assert.equal(result.reason, 'HEAD_MISMATCH');
    assert.equal(value.postCalls, 0);
    assert.deepEqual(value.calls, ['gate', 'head']);
  } finally { value.cleanup(); }
});

test('posting failure returns PUBLISH_FAILED without retry', async () => {
  const value = fixture({ postError: new Error('network failure') });
  try {
    const result = await publishRoutingReview(value.args);
    assert.equal(result.published, false);
    assert.equal(result.reason, 'PUBLISH_FAILED');
    assert.equal(value.postCalls, 1);
  } finally { value.cleanup(); }
});

test('missing delivery or Check Run ID is denied before HEAD and post', async () => {
  const noDelivery = fixture({ upload: null });
  const noCheck = fixture({ checkRunId: '' });
  try {
    assert.equal((await publishRoutingReview(noDelivery.args)).reason, 'ARTIFACT_UPLOAD_FAILED');
    assert.equal((await publishRoutingReview(noCheck.args)).reason, 'CHECK_RUN_MISSING');
    assert.deepEqual(noDelivery.calls, ['gate']);
    assert.deepEqual(noCheck.calls, ['gate']);
    assert.equal(noDelivery.postCalls + noCheck.postCalls, 0);
  } finally { noDelivery.cleanup(); noCheck.cleanup(); }
});

test('optional summary write failure does not change publication result', async () => {
  const value = fixture({ outputError: new Error('disk full') });
  try {
    const result = await publishRoutingReview(value.args);
    assert.equal(result.published, true);
    assert.equal(result.reason, 'PUBLISHED');
    assert.equal(value.postCalls, 1);
    assert.equal(value.outputs.length, 0);
  } finally { value.cleanup(); }
});
