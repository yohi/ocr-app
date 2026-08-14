import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync(new URL('../ocr-engine.yml', import.meta.url), 'utf8');

test('workflow executes only trusted workflow code and pinned tools', () => {
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /@alibaba-group\/open-code-review@1\.2\.0/);
  assert.match(workflow, /@google\/antigravity@0\.8\.2/);
  assert.match(workflow, /\.gemini\/antigravity-cli\/skills\/ocr-delegate/);
  assert.match(workflow, /ANTIGRAVITY_OAUTH_JSON/);
  assert.match(workflow, /printf '%s' "\$ANTIGRAVITY_OAUTH_JSON"/);
  assert.doesNotMatch(workflow, /echo "\$ANTIGRAVITY_OAUTH_JSON"/);
  assert.doesNotMatch(workflow, /OCR_LLM_/);
});

test('workflow policy allows only review delegation and read-only Git', () => {
  for (const allowed of ['ocr delegate preview', 'ocr delegate rule', 'git diff', 'git show', 'git status', 'git rev-parse']) {
    assert.match(workflow, new RegExp(allowed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const denied of ['git push', 'git fetch', 'curl', 'wget', 'rm', 'sudo', '--dangerously-skip-permissions']) {
    assert.match(workflow, new RegExp(denied.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('external forks are checked before the app-token secret step', () => {
  const targetStep = workflow.indexOf('id: target');
  const secretStep = workflow.indexOf('private-key: ${{ secrets.GH_APP_PRIVATE_KEY }}');
  assert.ok(targetStep >= 0 && secretStep > targetStep);
  assert.match(workflow, /steps\.target\.outputs\.internal == 'false'/);
  assert.match(workflow, /"conclusion":"neutral"/);
});
