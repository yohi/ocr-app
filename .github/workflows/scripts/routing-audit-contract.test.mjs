import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAttemptRecorder, createRoutingDecisionRecord, finalizeRoutingAudit } from './ocr-routing-audit.mjs';
import { validateRoutingAttempts } from './routing-attempts.mjs';

const binding = { workflowRunId: '123', runAttempt: 2, headSha: 'a'.repeat(40), mode: 'enforce' };
const catalog = { models: [{ model_id: 'primary', capability_tier: 'deep', certification_status: 'certified' }] };
const event = (fields = {}) => ({ schema_version: '1', run_attempt_id: 'b'.repeat(32), attempt_index: 1,
  event: 'attempt_started', model: 'primary', result: null, timestamp: '2026-10-22T00:00:00.000Z',
  duration_ms: null, host_status: null, ...fields });
const decision = count => createRoutingDecisionRecord({ runBinding: binding,
  features: { classification_status: 'unclassified_code', risk_floor: 'deep', reviewable_file_count: count },
  decision: {}, egressStatus: 'denied', route: { proposedStrategy: null, selectedStrategy: count ? 'deep' : null,
    routeSource: count ? 'deterministic_fallback' : 'not_requested', decisionStatus: 'not_requested' },
  policyVersions: { policyVersion: '1', modelCatalogVersion: '1' } });
const policy = { repoId: 7, repo: 'owner/repo', prNumber: 1, review_scope_gap: false,
  features_incomplete: false, selectedReviewModel: 'primary' };

test('Host event stream seals with exactly nine keys and no startup or publication event', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'routing-contract-'));
  try {
    const recorder = createAttemptRecorder({ runTemp, mode: 'enforce', catalog, runAttempt: 2, runAttemptId: 'b'.repeat(32) });
    for (const value of [event(), event({ event: 'attempt_completed', result: 'host_validated_success', duration_ms: 1 }),
      event({ event: 'host_completed', model: null, attempt_index: null, host_status: 'success' })]) recorder.onAttemptEvent(value);
    recorder.seal();
    const attempts = readFileSync(join(runTemp, 'ocr-routing/attempts.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(attempts.map(value => Object.keys(value).sort()), Array(3).fill([
      'attempt_index', 'duration_ms', 'event', 'host_status', 'model', 'result', 'run_attempt_id', 'schema_version', 'timestamp',
    ]));
    const audit = finalizeRoutingAudit({ decision: decision(1), attempts, reviewResult: { status: 'success' },
      validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding, policy, catalog, runTemp,
      selectedRoute: { selected_model_id: 'primary', selected_strategy: 'deep', fallback_models: [] },
      certifiedBundle: { catalog, evidence: { cli_available_models: ['primary'] } } });
    assert.equal(audit.executed_review_model, 'primary');
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('zero-review recorder produces a zero-byte stream accepted by the finalizer', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'routing-contract-'));
  try {
    const recorder = createAttemptRecorder({ runTemp, mode: 'enforce', catalog, runAttempt: 2 });
    recorder.seal();
    assert.equal(readFileSync(join(runTemp, 'ocr-routing/attempts.ndjson'), 'utf8'), '');
    const audit = finalizeRoutingAudit({ decision: decision(0), attempts: [], reviewResult: { status: 'skipped' },
      validation: { status: 'passed' }, headCheck: { status: 'passed' }, runBinding: binding,
      policy: { ...policy, selectedReviewModel: null }, catalog });
    assert.equal(audit.executed_review_model, null);
    assert.deepEqual(audit.attempted_review_models, []);
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});

test('canonical attempt validation rejects incomplete, reused, reordered and post-success events', () => {
  const start = event();
  const complete = event({ event: 'attempt_completed', result: 'host_validated_success', duration_ms: 1 });
  const terminal = event({ event: 'host_completed', model: null, attempt_index: null, host_status: 'success' });
  const validate = attempts => validateRoutingAttempts({ attempts,
    selectedRoute: { selected_model_id: 'primary', selected_strategy: 'deep', fallback_models: [] },
    certifiedBundle: { catalog, evidence: { cli_available_models: ['primary'] } } });
  assert.equal(validate([start, complete, terminal]).successModel, 'primary');
  for (const chain of [[], [start, complete], [complete, start, terminal],
    [start, { ...complete, run_attempt_id: 'c'.repeat(32) }, terminal],
    [start, complete, event({ attempt_index: 2 }), terminal],
    [start, complete, terminal, terminal], [start, complete, terminal, start],
    [start, { ...complete, model: 'other' }, terminal],
    [{ ...start, run_attempt: 2 }, complete, terminal],
    [{ ...start, attempt_index: 2 }, { ...complete, attempt_index: 2 }, terminal]]) {
    assert.throws(() => validate(chain), /AUDIT_EVENT_INVALID/);
  }
});

test('enforce recorder rejects pending models while shadow can observe their CLI IDs', () => {
  const runTemp = mkdtempSync(join(tmpdir(), 'routing-contract-'));
  const pending = { models: [{ model_id: 'primary', certification_status: 'pending' }] };
  try {
    const enforce = createAttemptRecorder({ runTemp, mode: 'enforce', catalog: pending, runAttempt: 2, runAttemptId: 'b'.repeat(32) });
    assert.throws(() => enforce.onAttemptEvent(event()), /AUDIT_MODEL_NOT_CERTIFIED/);
    const shadow = createAttemptRecorder({ runTemp, mode: 'shadow', catalog: pending, runAttempt: 2, runAttemptId: 'b'.repeat(32) });
    shadow.onAttemptEvent(event());
    shadow.seal();
    assert.equal(JSON.parse(readFileSync(join(runTemp, 'ocr-routing/attempts.ndjson'), 'utf8')).model, 'primary');
  } finally { rmSync(runTemp, { recursive: true, force: true }); }
});
