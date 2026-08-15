import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync(new URL('../ocr-engine.yml', import.meta.url), 'utf8');

function stepRun(name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = workflow.match(new RegExp(
    `- name: ${escapedName}\\n(?:        .*\\n)*?        run: \\|\\n((?:          .*\\n)+)`,
  ));
  assert.ok(match, `workflow step must define a run block: ${name}`);
  return match[1]
    .split('\n')
    .filter(Boolean)
    .map(line => line.slice(10))
    .join('\n');
}

function topLevelPermissions() {
  const match = workflow.match(/^permissions:\n((?:  [^\n]+\n)+)/m);
  assert.ok(match, 'workflow must define top-level permissions');
  return Object.fromEntries(
    match[1]
      .trim()
      .split('\n')
      .map(line => line.trim().split(': ')),
  );
}

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
  const policyStep = stepRun('Configure restrictive Antigravity policy');
  const reviewStep = stepRun('Run Antigravity review host');

  assert.match(policyStep, /install -d "\$HOME\/\.gemini\/antigravity-cli"/);
  assert.match(policyStep, /cat > "\$HOME\/\.gemini\/antigravity-cli\/settings\.json"/);
  assert.match(reviewStep, /runHost\(\{/);
  assert.match(reviewStep, /cwd: 'target-repo'/);
  assert.doesNotMatch(reviewStep, /\b(?:agy|curl|wget|npm|git\s+(?:push|fetch)|rm|sudo)\b/);
  assert.doesNotMatch(reviewStep, /--dangerously-skip-permissions/);

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
  assert.ok(
    workflow.indexOf('Configure restrictive Antigravity policy') <
      workflow.indexOf('Run Antigravity review host'),
    'restrictive policy must be configured before the review host starts',
  );

  assert.deepEqual(topLevelPermissions(), {
    contents: 'read',
    'pull-requests': 'write',
    issues: 'write',
  });
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
