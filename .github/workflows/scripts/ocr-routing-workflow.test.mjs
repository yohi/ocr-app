import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync(new URL('../ocr-engine.yml', import.meta.url), 'utf8');

function stepCondition(name) {
  const step = workflow.split(`- name: ${name}`)[1]?.split(/\n\s+- name:/)[0] ?? '';
  return step.match(/^\s+if:\s*(.+)$/m)?.[1] ?? '';
}

test('workflow preserves off mode and confines routing dependency and secret setup', () => {
  assert.match(workflow, /DECISION_ROUTING_MODE/);
  assert.match(workflow, /npm ci --prefix self-repo\/\.github\/workflows --ignore-scripts/);
  assert.match(workflow, /secrets\.DECISION_OPENROUTER_API_KEY/);
  assert.match(workflow, /name: Prepare dynamic routing/);
  assert.match(workflow, /DECISION_ROUTING_MODE.*==.*off/);
  const host = workflow.split('- name: Run Antigravity review host')[1]?.split('- name:')[0] ?? '';
  assert.doesNotMatch(host, /import .*prepare-review-routing\.mjs/);
  assert.match(host, /await import\('\.\/self-repo\/\.github\/workflows\/scripts\/prepare-review-routing\.mjs'\)/);
});

test('host has an independent run-binding guard before any spawn', () => {
  const host = workflow.split('- name: Run Antigravity review host')[1]?.split('- name:')[0] ?? '';
  assert.match(host, /createRunBindingFromEnv/);
  assert.match(host, /readSelectedReviewRoute/);
  assert.ok(host.indexOf('readSelectedReviewRoute') < host.indexOf('runHost('));
  assert.match(host, /fallbackModels/);
  assert.match(host, /runAttemptId: recorder\.runAttemptId/);
});

test('enforce publication requires a successful audit artifact gate and fresh HEAD check', () => {
  assert.match(workflow, /name: Upload routing audit[\s\S]*?continue-on-error: true/);
  assert.match(workflow, /name: Evaluate routing publish eligibility/);
  assert.match(workflow, /PUBLISH_AUTHORIZED/);
  assert.match(workflow, /name: Revalidate PR head immediately before enforce publication/);
  assert.match(stepCondition('Revalidate PR head immediately before enforce publication'), /always\(\)/);
  assert.match(stepCondition('Revalidate PR head immediately before enforce publication'), /steps\.routing-gate\.outputs\.PUBLISH_AUTHORIZED == 'true'/);
  assert.match(workflow, /steps\.target\.outputs\.internal == 'true'.*DECISION_ROUTING_MODE.*off/);
});

test('completion check update and debug artifact upload run regardless of routing authorization', () => {
  for (const name of ['Update Check Run completed', 'Upload result artifacts']) {
    const condition = stepCondition(name);
    assert.match(condition, /always\(\)/, `${name} must run after earlier steps fail`);
    assert.doesNotMatch(condition, /ROUTING_START_AUTHORIZED|PUBLISH_AUTHORIZED/,
      `${name} must not depend on routing authorization`);
  }
});

test('upload failure cannot authorize success and thread resolution is excluded from enforce', () => {
  assert.match(workflow, /steps\.upload-routing\.outcome/);
  const resolver = workflow.split('- name: Resolve fixed review threads')[1]?.split('- name:')[0] ?? '';
  assert.match(resolver, /DECISION_ROUTING_MODE == 'off'.*DECISION_ROUTING_MODE == 'shadow'/);
  assert.doesNotMatch(resolver, /DECISION_ROUTING_MODE == 'enforce'/);
});

test('enforce rechecks HEAD after the gate and before the first review mutation', () => {
  const gate = workflow.indexOf('- name: Evaluate routing publish eligibility');
  const finalHeadCheck = workflow.indexOf('- name: Revalidate PR head immediately before enforce publication');
  const post = workflow.indexOf('- name: Post review comments');
  assert.ok(gate >= 0 && gate < finalHeadCheck && finalHeadCheck < post);
  assert.match(workflow.slice(post, workflow.indexOf('- name: Upload result artifacts', post)), /steps\.revalidate-before-publish\.outcome == 'success'/);
});

test('mode branches retain the exact legacy host call in off mode', () => {
  const host = workflow.split('- name: Run Antigravity review host')[1]?.split('- name:')[0] ?? '';
  assert.match(host, /mode === 'off'.*runHost\(\{ cwd: 'target-repo', prompt, onProgress: chunk => process\.stderr\.write\(chunk\) \}\)/s);
  assert.match(host, /mode === 'shadow' && !route/);
  assert.match(host, /mode === 'enforce' \? \{ model: route\.selected_model_id, fallbackModels: route\.fallback_models/);
});

test('shadow route absence keeps best-effort legacy review without consuming route data', () => {
  const host = workflow.split('- name: Run Antigravity review host')[1]?.split('- name:')[0] ?? '';
  assert.match(host, /mode === 'shadow' && !route/);
  assert.match(host, /if \(route \|\| mode === 'enforce' \|\| mode === 'shadow'\)/);
  assert.match(host, /assertSerializedRunBindingMatches\(binding, decisionRecord\)/);
});

test('host guard failure prevents shadow resolver and poster mutations', () => {
  const host = workflow.split('- name: Run Antigravity review host')[1]?.split('- name:')[0] ?? '';
  const resolver = workflow.split('- name: Resolve fixed review threads')[1]?.split('- name:')[0] ?? '';
  const poster = workflow.split('- name: Post review comments')[1]?.split('- name:')[0] ?? '';
  assert.match(host, /ROUTE_GUARD_FAILED=true/);
  assert.match(resolver, /steps\.host-review\.outputs\.ROUTE_GUARD_FAILED != 'true'/);
  assert.match(poster, /steps\.host-review\.outputs\.ROUTE_GUARD_FAILED != 'true'/);
});

test('routing dependencies are limited to explicit shadow and enforce modes', () => {
  assert.match(workflow, /name: Validate decision routing mode/);
  const routing = workflow.split('- name: Prepare dynamic routing')[1]?.split('- name:')[0] ?? '';
  assert.match(routing, /env\.DECISION_ROUTING_MODE == 'shadow'.*env\.DECISION_ROUTING_MODE == 'enforce'/);
  assert.doesNotMatch(routing, /DECISION_ROUTING_MODE != 'off'/);
});

test('audit finalizer gets model IDs from the canonical route and approval from validated egress state', () => {
  const finalizer = workflow.split('- name: Finalize routing audit')[1]?.split('- name:')[0] ?? '';
  assert.match(finalizer, /readSelectedReviewRoute/);
  assert.match(finalizer, /ownerApprovalRef: routingState\.owner_approval_ref/);
  assert.match(finalizer, /selectedReviewModel/);
  assert.match(finalizer, /proposedReviewModel/);
});
