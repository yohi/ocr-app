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
  const settingsMatch = workflow.match(/settings\.json"?\s*<<'EOF'\n([\s\S]*?)\n\s*EOF/);
  assert.ok(settingsMatch, 'restrictive settings.json must be written by the workflow');
  const settings = JSON.parse(settingsMatch[1]);
  assert.deepEqual(settings.permissions.allow, [
    'ocr delegate preview',
    'ocr delegate rule',
    'git diff',
    'git show',
    'git status',
    'git rev-parse',
  ]);
  assert.deepEqual(settings.permissions.deny, [
    'git push',
    'git fetch',
    'curl',
    'wget',
    'rm',
    'sudo',
    '--dangerously-skip-permissions',
  ]);
  assert.ok(settings.permissions.allow.every(command => !settings.permissions.deny.includes(command)));
  assert.ok(workflow.indexOf('settings.json') < workflow.indexOf('Run Antigravity review host'));

  assert.match(workflow, /permissions:\n  contents: read\n  pull-requests: write\n  issues: write/);
  assert.match(workflow, /permission-pull-requests: write/);
  assert.match(workflow, /permission-issues: write/);
  assert.match(workflow, /permission-contents: read/);
  assert.match(workflow, /permission-checks: write/);
  assert.doesNotMatch(workflow, /permission-contents: write/);
  assert.doesNotMatch(workflow, /permissions:\n[\s\S]*\n  contents: write/);
  assert.doesNotMatch(workflow, /permissions:\n[\s\S]*\n  actions: write/);
  assert.doesNotMatch(workflow, /permissions:\n[\s\S]*\n  id-token: write/);
});

test('external forks are checked before the app-token secret step', () => {
  const targetStep = workflow.indexOf('id: target');
  const secretStep = workflow.indexOf('private-key: ${{ secrets.GH_APP_PRIVATE_KEY }}');
  assert.ok(targetStep >= 0 && secretStep > targetStep);
  assert.match(workflow, /steps\.target\.outputs\.internal == 'false'/);
  assert.match(workflow, /"conclusion":"neutral"/);
});
