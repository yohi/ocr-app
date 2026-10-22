import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync(new URL('../ocr-engine.yml', import.meta.url), 'utf8');
const routingReview = fs.readFileSync(new URL('./run-routing-review.mjs', import.meta.url), 'utf8');
const step = name => workflow.split(`- name: ${name}`)[1]?.split('\n      - name:')[0] ?? '';

test('off mode retains legacy Host and skips routing steps', () => {
  assert.match(workflow, /DECISION_ROUTING_MODE/);
  assert.match(step('Run Antigravity review host'), /runRoutingReview/);
  assert.match(step('Run Antigravity review host'), /runRoutingReview\(\{/);
  assert.match(step('Run Antigravity review host'), /env: process\.env/);
  assert.match(step('Run Antigravity review host'), /runHost: options => runHost/);
  assert.match(step('Run Antigravity review host'), /DECISION_ROUTING_MODE == 'off'/);
  assert.match(step('Prepare dynamic routing'), /env\.DECISION_ROUTING_MODE == 'shadow'.*env\.DECISION_ROUTING_MODE == 'enforce'/);
  const host = step('Run Antigravity review host');
  assert.match(host, /mode === 'off' \? null : createRunBindingFromEnv/);
  assert.match(host, /mode === 'off' \? null : JSON\.parse\(fs\.readFileSync\(catalogPath/);
  assert.match(host, /mode === 'off' \? \{\} : \{/);
  assert.match(host, /repoIdentity = mode === 'off' \? null/);
  assert.match(host, /authorityParams: mode === 'off' \? undefined/);
  assert.match(host, /runHost: options => runHost\(\{ cwd: 'target-repo', \.\.\.options/);
  assert.match(host, /onProgress: chunk => process\.stderr\.write\(chunk\)/);
});

test('shadow fallback requires startup approval and handles absent prepared route best-effort', () => {
  const host = step('Run Antigravity review host');
  assert.match(host, /if:.*!cancelled\(\)/);
  assert.match(host, /if:.*steps\.target\.outputs\.internal == 'true'.*\(env\.DECISION_ROUTING_MODE == 'off' \|\| steps\.routing-start\.outputs\.ROUTING_START_AUTHORIZED == 'true'\)/);
  assert.match(host, /readRoute: \(\) => fs\.existsSync\(routePath\) \? readSelectedReviewRoute/);
  assert.match(host, /writeOutput: value => fs\.appendFileSync\(process\.env\.GITHUB_OUTPUT/);
  assert.match(host, /if \(mode === 'shadow' && result\.status === 'failed' && result\.message === 'NO_SELECTED_REVIEW_ROUTE'\)/);
  assert.doesNotMatch(host, /result\.message === 'ROUTING_EXECUTION_CONTEXT_INVALID'/);
  assert.match(host, /ROUTE_GUARD_FAILED=false/);
  assert.match(routingReview, /if \(writeOutput\) await writeOutput\('ROUTE_GUARD_FAILED=true'\)/);
  assert.match(routingReview, /if \(!route\) denied\('NO_SELECTED_REVIEW_ROUTE'\)/);
  assert.match(host, /result = await runHost\(\{ cwd: 'target-repo', prompt, routingMode: 'shadow', onProgress:/);
  assert.match(step('Resolve fixed review threads'), /ROUTE_GUARD_FAILED/);
  assert.match(step('Post review comments'), /ROUTE_GUARD_FAILED/);
  assert.match(step('Post review comments'), /DECISION_ROUTING_MODE == 'off'.*DECISION_ROUTING_MODE == 'shadow'/);
  assert.match(step('Update Check Run completed'), /if:.*always\(\)/);
  assert.doesNotMatch(step('Update Check Run completed'), /ROUTING_START_AUTHORIZED != 'true'/);
});

test('non-off startup requires positive authorization and shadow does not ignore failure', () => {
  assert.match(step('Prepare dynamic routing'), /ROUTING_START_AUTHORIZED == 'true'/);
  assert.match(step('Run Antigravity review host'), /ROUTING_START_AUTHORIZED == 'true'/);
  assert.doesNotMatch(step('Prepare dynamic routing'), /continue-on-error/);
});

test('routing evidence upload requires fresh upload authorization', () => {
  assert.match(step('Reauthorize routing audit upload'), /AUTHORIZED=\$\{authorized\}/);
  assert.match(step('Reauthorize routing audit upload'), /output\(authorized \? 'true' : 'false'\)/);
  assert.match(step('Upload routing audit'), /reauthorize-upload\.outputs\.AUTHORIZED == 'true'/);
  assert.match(step('Upload routing audit'), /execution-context\.json/);
  assert.match(step('Reauthorize routing audit upload'), /SHADOW_AUDIT_UNAVAILABLE=true/);
  assert.match(step('Reauthorize routing audit upload'), /SHADOW_AUDIT_UNAVAILABLE/);
  assert.match(step('Upload routing audit'), /SHADOW_AUDIT_UNAVAILABLE != 'true'/);
  assert.match(step('Upload routing audit'), /continue-on-error: true/);
});

test('enforce routing gate revalidates context and startup authorization before eligibility', () => {
  const gate = step('Evaluate routing publish eligibility');
  assert.match(gate, /revalidateRoutingExecutionContext/);
  assert.match(gate, /startupAuthorization/);
  assert.ok(gate.indexOf('const revalidated = revalidateRoutingExecutionContext') < gate.indexOf('const gate = evaluatePublishEligibility'));
  assert.match(gate, /startupAuthorization: revalidated\.startupAuthorization,[\s\S]*mode: 'enforce'/);
});

test('enforce has one publish boundary and legacy posting is off or shadow only', () => {
  const enforcePublishers = workflow.match(/publish-routing-review\.mjs/g) ?? [];
  assert.equal(enforcePublishers.length, 1);
  assert.match(step('Post review comments'), /DECISION_ROUTING_MODE == 'off'.*DECISION_ROUTING_MODE == 'shadow'/);
  assert.doesNotMatch(step('Post review comments'), /DECISION_ROUTING_MODE == 'enforce'/);
  assert.match(step('Publish enforce review'), /publish-routing-review\.mjs/);
  assert.match(step('Publish enforce review'), /PUBLISHED=true/);
  assert.match(step('Publish enforce review'), /post-ocr-comments\.mjs/);
  const publisher = step('Publish enforce review');
  assert.match(publisher, /policySha256:/);
  assert.match(publisher, /catalogSha256:/);
  assert.match(publisher, /sourceManifestSha256[,}]/);
  assert.match(publisher, /centralRepoId:/);
  assert.match(publisher, /centralRepoFullName:/);
});

test('always-run mutations are guarded by authorized startup', () => {
  for (const name of ['Resolve fixed review threads', 'Finalize routing audit', 'Reauthorize routing audit upload', 'Upload routing audit', 'Post review comments', 'Publish enforce review']) {
    const body = step(name);
    if (/if:.*always\(\)/.test(body)) assert.match(body, /ROUTING_START_AUTHORIZED == 'true'/, `${name} must require successful startup`);
  }
  const checkUpdate = step('Update Check Run completed');
  const debugUpload = step('Upload result artifacts');
  assert.match(checkUpdate, /if:.*always\(\)/);
  assert.match(debugUpload, /if:.*always\(\)/);
  assert.doesNotMatch(checkUpdate, /ROUTING_START_AUTHORIZED != 'true'|PUBLISH_AUTHORIZED != 'true'/);
  assert.doesNotMatch(debugUpload, /ROUTING_START_AUTHORIZED != 'true'|PUBLISH_AUTHORIZED != 'true'/);
});
