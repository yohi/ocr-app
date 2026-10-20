import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync(new URL('../ocr-engine.yml', import.meta.url), 'utf8');

test('workflow preserves off mode and confines routing dependency and secret setup', () => {
  assert.match(workflow, /DECISION_ROUTING_MODE/);
  assert.match(workflow, /npm ci --prefix self-repo\/\.github\/workflows --ignore-scripts/);
  assert.match(workflow, /secrets\.DECISION_OPENROUTER_API_KEY/);
  assert.match(workflow, /name: Prepare dynamic routing/);
  assert.match(workflow, /DECISION_ROUTING_MODE.*==.*off/);
});

test('host has an independent run-binding guard before any spawn', () => {
  const host = workflow.split('- name: Run Antigravity review host')[1]?.split('- name:')[0] ?? '';
  assert.match(host, /createRunBindingFromEnv/);
  assert.match(host, /readSelectedReviewRoute/);
  assert.ok(host.indexOf('readSelectedReviewRoute') < host.indexOf('runHost('));
  assert.match(host, /fallbackModels/);
});

test('enforce publication requires a successful audit artifact gate and fresh HEAD check', () => {
  assert.match(workflow, /name: Upload routing audit[\s\S]*?continue-on-error: true/);
  assert.match(workflow, /name: Evaluate routing publish eligibility/);
  assert.match(workflow, /PUBLISH_AUTHORIZED/);
  assert.match(workflow, /name: Revalidate PR head immediately before enforce publication/);
  assert.match(workflow, /if:.*PUBLISH_AUTHORIZED.*true/);
  assert.match(workflow, /steps\.target\.outputs\.internal == 'true'.*DECISION_ROUTING_MODE.*off/);
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
  assert.match(host, /mode === 'enforce' \? \{ model: route\.selected_review_model, fallbackModels: route\.fallback_models/);
});

test('shadow route absence keeps best-effort legacy review without consuming route data', () => {
  const host = workflow.split('- name: Run Antigravity review host')[1]?.split('- name:')[0] ?? '';
  assert.match(host, /mode === 'shadow' && !route/);
  assert.match(host, /if \(route \|\| mode === 'enforce' \|\| mode === 'shadow'\)/);
  assert.match(host, /assertSerializedRunBindingMatches\(binding, decisionRecord\)/);
});
