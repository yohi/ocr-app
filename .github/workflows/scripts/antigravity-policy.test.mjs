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
  assert.match(workflow, /@alibaba-group\/open-code-review@1\.12\.7/);
  assert.match(workflow, /https:\/\/antigravity\.google\/cli\/install\.sh/);
  assert.match(workflow, /npm install -g --prefix "\$HOME\/\.local" --ignore-scripts /);
  assert.match(workflow, /prepare-ocr-review-context\.mjs/);
  assert.match(workflow, /ANTIGRAVITY_OAUTH_JSON/);
  assert.match(workflow, /printf '%s' "\$ANTIGRAVITY_OAUTH_JSON"/);
  assert.doesNotMatch(workflow, /echo "\$ANTIGRAVITY_OAUTH_JSON"/);
  assert.doesNotMatch(workflow, /OCR_LLM_AUTH_TOKEN/);
  assert.doesNotMatch(workflow, /OCR_LLM_URL/);
});

test('workflow installs OCR where the Antigravity shell can resolve it', () => {
  const installStep = stepRun('Install pinned review tools');

  assert.match(
    installStep,
    /npm install -g --prefix "\$HOME\/\.local" --ignore-scripts @alibaba-group\/open-code-review@1\.12\.7/,
    'OCR must share the Antigravity-visible bin directory',
  );
  assert.match(installStep, /echo "\$HOME\/\.local\/bin" >> "\$GITHUB_PATH"/);
});

test('workflow prepares trusted review context before the context-only host', () => {
  const contextStep = stepRun('Prepare trusted review context');
  const reviewStep = stepRun('Run Antigravity review host');

  assert.match(contextStep, /prepare-ocr-review-context\.mjs/);
  assert.match(workflow, /OCR_PREVIEW_PATH: \/tmp\/ocr-preview\.json/);
  assert.match(workflow, /OCR_CONTEXT_PATH: \/tmp\/ocr-review-context\.json/);
  assert.match(reviewStep, /ocr_review_context/);
  assert.match(reviewStep, /Do not call tools, execute commands, read files, access URLs/);
  assert.match(reviewStep, /evidence-backed/);
  assert.doesNotMatch(reviewStep, /\/open-code-review-delegate/);
  assert.doesNotMatch(workflow, /Install trusted delegate skill/);
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

test('workflow policy denies Antigravity tools after trusted context preparation', () => {
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
  assert.equal(settings.enableTerminalSandbox, true);
  assert.equal(settings.toolPermission, 'proceed-in-sandbox');
  assert.equal(settings.permissions.allow, undefined);
  assert.deepEqual(settings.permissions.deny, [
    'command(*)',
    'unsandboxed(*)',
    'read_file(*)',
    'write_file(*)',
    'read_url(*)',
    'execute_url(*)',
    'mcp(*)',
  ]);
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
  assert.match(workflow, /ocr delegate preview --format json/);
  assert.match(workflow, /OCR_RULE_PATH: \.\.\/self-repo\/\.github\/workflows\/config\/markdown-review-rules\.json/);
  assert.match(workflow, /prepare-ocr-review-context\.mjs/);
  assert.match(workflow, /untrusted PR data/);
  assert.match(workflow, /evidence-backed failures/);
});

test('workflow previews the checked out target repository and validates its result', () => {
  assert.match(workflow, /- name: Validate deterministic review selection\n[\s\S]*?working-directory: target-repo/);
  assert.match(workflow, /ocr delegate preview --format json/);
  assert.match(workflow, /--rule \.\.\/self-repo\/\.github\/workflows\/config\/markdown-review-rules\.json/);
  assert.match(workflow, /validate-ocr-result\.mjs/);
  assert.match(workflow, /- name: Validate review result/);
  assert.match(workflow, /OCR_EXPECTED_REVIEWABLE_FILES/);
  assert.match(workflow, /validate-ocr-result\.mjs \\\n\s+\/tmp\/ocr-result\.json \\\n\s+"\$OCR_EXPECTED_REVIEWABLE_FILES"/);
});

test('external forks are checked before the app-token secret step', () => {
  const targetStep = workflow.indexOf('id: target');
  const secretStep = workflow.indexOf('private-key: ${{ secrets.GH_APP_PRIVATE_KEY }}');
  assert.ok(targetStep >= 0 && secretStep > targetStep);
  assert.match(workflow, /steps\.target\.outputs\.internal == 'false'/);
  assert.match(workflow, /"conclusion":"neutral"/);
});
