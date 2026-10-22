import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync(new URL('../ocr-engine.yml', import.meta.url), 'utf8');
const routingReview = fs.readFileSync(new URL('./run-routing-review.mjs', import.meta.url), 'utf8');
const step = name => workflow.split(`- name: ${name}`)[1]?.split('\n      - name:')[0] ?? '';
const condition = name => step(name).match(/^        if: (.+)$/m)?.[1] ?? '';

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
  assert.match(host, /if \(!fs\.existsSync\(routePath\)\) return null/);
  assert.match(host, /writeOutput: value => fs\.appendFileSync\(process\.env\.GITHUB_OUTPUT/);
  assert.doesNotMatch(host, /result\.message === 'NO_SELECTED_REVIEW_ROUTE'/);
  assert.match(routingReview, /if \(writeOutput\) await writeOutput\('ROUTE_GUARD_FAILED=true'\)/);
  assert.match(routingReview, /if \(mode !== 'shadow'\) denied\('NO_SELECTED_REVIEW_ROUTE'\)/);
  assert.match(routingReview, /return host\(\{ \.\.\.legacy, routingMode: 'shadow' \}\)/);
  assert.match(step('Resolve fixed review threads'), /ROUTE_GUARD_FAILED/);
  assert.match(step('Post review comments'), /ROUTE_GUARD_FAILED/);
  assert.match(step('Post review comments'), /DECISION_ROUTING_MODE == 'off'.*DECISION_ROUTING_MODE == 'shadow'/);
  assert.match(step('Update Check Run completed'), /if:.*always\(\)/);
  assert.doesNotMatch(step('Update Check Run completed'), /ROUTING_START_AUTHORIZED != 'true'/);
});

test('non-off startup requires positive authorization and shadow does not ignore failure', () => {
  assert.match(step('Prepare dynamic routing'), /ROUTING_START_AUTHORIZED == 'true'/);
  assert.match(step('Run Antigravity review host'), /ROUTING_START_AUTHORIZED == 'true'/);
  assert.doesNotMatch(step('Authorize routing start'), /continue-on-error/);
  assert.match(step('Prepare dynamic routing'), /continue-on-error: \$\{\{ env\.DECISION_ROUTING_MODE == 'shadow' \}\}/);
});

test('routing evidence upload requires fresh upload authorization', () => {
  assert.match(step('Reauthorize routing audit upload'), /AUTHORIZED=\$\{authorized\}/);
  assert.match(step('Reauthorize routing audit upload'), /output\(authorized \? 'true' : 'false'\)/);
  assert.match(step('Upload routing audit'), /reauthorize-upload\.outputs\.AUTHORIZED == 'true'/);
  assert.doesNotMatch(step('Upload routing audit'), /execution-context\.json/);
  assert.match(step('Reauthorize routing audit upload'), /SHADOW_AUDIT_UNAVAILABLE=true/);
  assert.match(step('Reauthorize routing audit upload'), /SHADOW_AUDIT_UNAVAILABLE/);
  assert.match(step('Upload routing audit'), /SHADOW_AUDIT_UNAVAILABLE != 'true'/);
  assert.match(step('Upload routing audit'), /continue-on-error: true/);
});

test('enforce routing gate revalidates context and startup authorization before eligibility', () => {
  const gate = step('Evaluate routing publish eligibility');
  assert.match(gate, /revalidateRoutingExecutionContext/);
  assert.match(gate, /startupAuthorization/);
  const revalidateIndex = gate.indexOf('const revalidated = revalidateRoutingExecutionContext');
  const eligibilityIndex = gate.indexOf('const gate = evaluatePublishEligibility');
  assert.notEqual(revalidateIndex, -1, 'routing context must be revalidated');
  assert.notEqual(eligibilityIndex, -1, 'publish eligibility must be evaluated');
  assert.ok(revalidateIndex < eligibilityIndex, 'context must be revalidated before eligibility');
  assert.match(gate, /startupAuthorization: revalidated\.startupAuthorization,[\s\S]*mode: 'enforce'/);
});

test('enforce has one publish boundary and legacy posting is off or shadow only', () => {
  const enforcePublishers = workflow.match(/publish-routing-review\.mjs/g) ?? [];
  assert.equal(enforcePublishers.length, 1);
  assert.match(step('Post review comments'), /DECISION_ROUTING_MODE == 'off'.*DECISION_ROUTING_MODE == 'shadow'/);
  assert.doesNotMatch(step('Post review comments'), /DECISION_ROUTING_MODE == 'enforce'/);
  assert.match(step('Publish enforce review'), /publish-routing-review\.mjs/);
  assert.match(step('Publish enforce review'), /postReview,/);
  assert.doesNotMatch(step('Publish enforce review'), /PUBLISHED=true|postReview: async \(\) => 0/);
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
    const ifCondition = condition(name);
    if (/always\(\)/.test(ifCondition)) assert.match(ifCondition, /ROUTING_START_AUTHORIZED == 'true'/, `${name} must require successful startup`);
  }
  const checkUpdate = condition('Update Check Run completed');
  const debugUpload = condition('Upload result artifacts');
  assert.match(checkUpdate, /always\(\)/);
  assert.match(debugUpload, /always\(\)/);
  for (const [name, ifCondition] of [['Check Run completion', checkUpdate], ['result artifact upload', debugUpload]]) {
    assert.doesNotMatch(ifCondition, /ROUTING_START_AUTHORIZED\s*==\s*'true'|PUBLISH_AUTHORIZED\s*==\s*'true'/,
      `${name} must run independently of authorization success`);
  }
});
