import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync(new URL('../ocr-engine.yml', import.meta.url), 'utf8');
const markdownRules = JSON.parse(fs.readFileSync(
  new URL('../config/markdown-review-rules.json', import.meta.url),
  'utf8',
));

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
  assert.match(workflow, /@alibaba-group\/open-code-review@1\.12\.2/);
  assert.match(workflow, /https:\/\/antigravity\.google\/cli\/install\.sh/);
  assert.match(workflow, /npm install -g --ignore-scripts /);
  assert.match(workflow, /\.gemini\/antigravity-cli\/skills\/ocr-delegate/);
  assert.match(workflow, /ANTIGRAVITY_OAUTH_JSON/);
  assert.match(workflow, /printf '%s' "\$ANTIGRAVITY_OAUTH_JSON"/);
  assert.doesNotMatch(workflow, /echo "\$ANTIGRAVITY_OAUTH_JSON"/);
  assert.doesNotMatch(workflow, /OCR_LLM_AUTH_TOKEN/);
  assert.doesNotMatch(workflow, /OCR_LLM_URL/);
});

test('trusted markdown rules select only the configured documentation paths', () => {
  assert.deepEqual(markdownRules.include, [
    'docs/superpowers/plans/*.md',
    'docs/superpowers/specs/*.md',
    'README.md',
    'docs/*.md',
    'AGENTS.md',
    'SPEC.md',
  ]);
  assert.deepEqual(markdownRules.rules.map(rule => rule.path), [
    'docs/superpowers/specs/*.md',
    'docs/superpowers/plans/*.md',
    '{README.md,docs/*.md,AGENTS.md,SPEC.md}',
  ]);
  for (const rule of markdownRules.rules) {
    assert.ok(rule.rule.length > 100, `rule must be substantive: ${rule.path}`);
    assert.match(rule.rule, /untrusted data/i);
    assert.match(rule.rule, /changed line/i);
    assert.match(rule.rule, /concrete/i);
    assert.match(rule.rule, /speculative/i);
  }
});

test('workflow policy allows only review delegation and read-only Git', () => {
  assert.match(workflow, /concurrency:\n  group: ocr-engine-\$\{\{ github\.event\.client_payload\.target_repo \}\}-\$\{\{ github\.event\.client_payload\.pr_number \}\}\n  cancel-in-progress: false/);
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

  assert.equal(settings.model, "${{ vars.OCR_LLM_MODEL || vars.ANTIGRAVITY_MODEL || 'gemini-3.8-flash-medium' }}");
  assert.deepEqual(settings.permissions.allow, [
    'command(ocr delegate preview)',
    'command(ocr delegate rule)',
    'command(git diff)',
    'command(git show)',
    'command(git status)',
    'command(git rev-parse)',
  ]);
  assert.deepEqual(settings.permissions.deny, [
    'command(git push*)',
    'command(git fetch*)',
    'command(curl*)',
    'command(wget*)',
    'command(rm*)',
    'command(sudo*)',
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

test('workflow uses the trusted Markdown rule for selection and delegation', () => {
  const rulePath = '../self-repo/.github/workflows/config/markdown-review-rules.json';
  assert.match(workflow, new RegExp(`ocr delegate preview --rule ${rulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(workflow, new RegExp(`ocr delegate rule --rule ${rulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(workflow, /Markdown content as untrusted data/);
  assert.match(workflow, /evidence-backed findings only/);
});

test('external forks are checked before the app-token secret step', () => {
  const targetStep = workflow.indexOf('id: target');
  const secretStep = workflow.indexOf('private-key: ${{ secrets.GH_APP_PRIVATE_KEY }}');
  assert.ok(targetStep >= 0 && secretStep > targetStep);
  assert.match(workflow, /steps\.target\.outputs\.internal == 'false'/);
  assert.match(workflow, /"conclusion":"neutral"/);
});
