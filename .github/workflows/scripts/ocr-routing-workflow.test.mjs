import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const workflow = fs.readFileSync(new URL('../ocr-engine.yml', import.meta.url), 'utf8');
const routingReview = fs.readFileSync(new URL('./run-routing-review.mjs', import.meta.url), 'utf8');
const step = name => workflow.split(`- name: ${name}`)[1]?.split('\n      - name:')[0] ?? '';
const condition = name => step(name).match(/^        if: (.+)$/m)?.[1] ?? '';

test('PR Summary publisher receives configured reviewer model in off, shadow, and enforce paths', () => {
  const legacy = step('Post review comments');
  const enforce = step('Publish enforce review');
  assert.match(legacy, /OCR_LLM_MODEL:/);
  assert.ok(legacy.includes('DECISION_LLM_MODEL_ID: ${{ vars.DECISION_LLM_MODEL_ID'));
  assert.match(enforce, /OCR_LLM_MODEL:/);
  assert.match(legacy, /post-ocr-comments\.mjs/);
  assert.match(enforce, /postReview/);
  assert.match(legacy, /EXPECTED_SHA:/);
  assert.match(enforce, /COMMIT_SHA:/);
  // Display reporting must not affect existing review authorization or publishing.
  assert.match(legacy, /steps\.finalize-routing\.outcome == 'success'/);
  assert.match(enforce, /steps\.routing-gate\.outputs\.PUBLISH_AUTHORIZED == 'true'/);
});

test('Actions Summary displays decision settings and evidence-backed reviewer model without changing the gate', () => {
  const summary = step('Write LLM model summary');
  assert.match(summary, /if: always\(\) && steps\.target\.outputs\.internal == 'true'/);
  assert.match(summary, /continue-on-error: true/);
  assert.match(summary, /GITHUB_RUN_ID: \u0024\{\{ github\.run_id \}\}/);
  assert.match(summary, /GITHUB_RUN_ATTEMPT: \u0024\{\{ github\.run_attempt \}\}/);
  assert.match(summary, /COMMIT_SHA: \u0024\{\{ github\.event\.client_payload\.commit_sha \}\}/);
  assert.match(summary, /DECISION_LLM_ENABLED: \u0024\{\{ env\.DECISION_LLM_ENABLED \}\}/);
  assert.match(summary, /OCR_LLM_MODEL:/);
  assert.ok(summary.includes('DECISION_LLM_MODEL_ID: ${{ vars.DECISION_LLM_MODEL_ID'));
  assert.match(summary, /write-model-summary\.mjs/);
  assert.doesNotMatch(summary, /gh api|curl|publish-routing-review|post-ocr-comments/);
  assert.match(step('Finalize routing audit'), /writeRoutingAudit/);
  assert.match(step('Update Check Run completed'), /update-check-run\.mjs/);
});

test('off mode retains legacy Host and skips routing steps', () => {
  assert.match(workflow, /DECISION_ROUTING_MODE/);
  assert.match(step('Run Antigravity review host'), /runRoutingReview/);
  assert.match(step('Run Antigravity review host'), /runRoutingReview\(\{/);
  assert.match(step('Run Antigravity review host'), /env: process\.env/);
  assert.match(step('Run Antigravity review host'), /runHost: options => runHost/);
  assert.match(step('Run Antigravity review host'), /DECISION_ROUTING_MODE == 'off'/);
  assert.match(step('Prepare dynamic routing'), /env\.DECISION_ROUTING_MODE == 'shadow'.*env\.DECISION_ROUTING_MODE == 'enforce'/);
  const host = step('Run Antigravity review host');
  assert.match(host, /routingEnabled \? createRunBindingFromEnv/);
  assert.match(host, /routingEnabled \? JSON\.parse\(fs\.readFileSync\(catalogPath/);
  assert.match(host, /trustedInputs = !routingEnabled \? \{\} : \{/);
  assert.match(host, /repoIdentity = !routingEnabled \? null/);
  assert.match(host, /authorityParams: !routingEnabled \? undefined/);
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
  assert.match(routingReview, /return runAuthorizedHost\(\{ \.\.\.legacy, routingMode: 'shadow' \}\)/);
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

test('routing review startup hashes the decision egress policy for authorization', () => {
  const host = step('Run Antigravity review host');
  assert.match(host, /const policyPath = '\.\/self-repo\/\.github\/workflows\/config\/decision-egress-policy\.json'/);
  assert.match(host, /policySha256: hashFile\(policyPath\)/);
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

test('finalizer binds validated-result step output to current raw bytes', () => {
  const finalizer = step('Finalize routing audit');
  assert.match(finalizer, /VALIDATED_RESULT_SHA256:\s*\$\{\{\s*steps\.validate-review\.outputs\.RESULT_SHA256\s*\}\}/);
  assert.match(finalizer, /verifyValidatedResultEvidence/);
  assert.match(finalizer, /validatedResultSha256:\s*process\.env\.VALIDATED_RESULT_SHA256/);
  assert.match(finalizer, /validation:\s*\{\s*status:\s*resultEvidence\.reviewValidationStatus\s*\}/);
  assert.match(finalizer, /resultSha256:\s*resultEvidence\.resultSha256/);
});

test('audit finalizer logs only normalized stage and code without relaxing fail-closed', () => {
  const finalizer = step('Finalize routing audit');
  for (const stage of ['LOAD_INPUTS', 'VALIDATE_RESULT', 'REFRESH_AUTHORITY',
    'REVALIDATE_CONTEXT', 'FINALIZE_RECORD', 'WRITE_AUDIT', 'LOG_SUMMARY']) {
    assert.ok(finalizer.includes(stage), `missing audit stage ${stage}`);
  }
  assert.match(finalizer, /formatRoutingAuditDiagnostic/);
  assert.match(finalizer, /formatDiagnostic\(\{ stage: auditStage, error \}\)/);
  assert.match(finalizer, /ROUTING_AUDIT_DIAGNOSTIC code=UNKNOWN stage=LOAD_INPUTS reason=OTHER/);
  assert.match(finalizer, /console\.error\('ROUTING_AUDIT_MISSING'\)/);
  assert.match(finalizer, /process\.exitCode = 1/);
  assert.doesNotMatch(finalizer, /console\.error\(error\)|console\.error\(error\?\.message\)/);
  assert.match(finalizer, /revalidateRoutingExecutionContext/);
  assert.match(finalizer, /writeRoutingAudit/);
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

test('certified review job disables native CLI auto-update for all steps', () => {
  const jobHeader = workflow.split('    steps:')[0];
  const jobEnv = jobHeader.split('    env:')[1] ?? '';
  assert.ok(jobHeader.includes('run-ocr-review:'));
  assert.ok(jobEnv.includes("AGY_CLI_DISABLE_AUTO_UPDATE: 'true'"));
  assert.equal((workflow.match(/AGY_CLI_DISABLE_AUTO_UPDATE:/g) ?? []).length, 1);
  assert.doesNotMatch(jobEnv, /AGY_CLI_DISABLE_AUTO_UPDATE: '(?:1|false)'/);
  assert.match(step('Install pinned review tools'), /AGY_VERSION_CERTIFICATION_MISMATCH/);
  assert.match(step('Finalize routing audit'), /revalidateRoutingExecutionContext/);
});

test('review workflow pins the official CLI release to the existing approved inventory', () => {
  const installStep = step('Install pinned review tools');
  const inventory = JSON.parse(fs.readFileSync(new URL('../config/routing-evidence/pro-cli-inventory-20261105.json', import.meta.url), 'utf8'));
  assert.equal(inventory.cli_version, '1.5.1');
  assert.match(installStep, /AGY_VERSION: '1\.5\.1'/);
  assert.match(installStep, /AGY_ARCHIVE_SHA256: '2a64ccfc5f6679c253769f0760614af5de04d8dc1eeeec9b9752ba4c8dd92250'/);
  assert.ok(installStep.includes("AGY_BINARY_SHA256: '" + inventory.cli_binary_sha256 + "'"));
  assert.match(installStep, /releases\/download\/\$\{AGY_VERSION\}\/agy_cli_linux_x64\.tar\.gz/);
  assert.match(installStep, /AGY_VERSION_CERTIFICATION_MISMATCH/);
  assert.match(installStep, /install-certified-agy\.sh/);
  assert.doesNotMatch(installStep, /cli\/install\.sh|releases\/latest/);
});

test('certified CLI installer verifies both digests and refuses malformed or mismatched artifacts', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'agy-install-test-'));
  const script = fileURLToPath(new URL('./install-certified-agy.sh', import.meta.url));
  const home = join(root, 'home');
  const payloadDir = join(root, 'payload');
  const destination = join(home, '.local/bin/agy');
  const archive = join(root, 'agy.tar.gz');
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const payload = Buffer.from('#!/bin/sh\necho fixture\n');
  const run = (archiveDigest, binaryDigest, archivePath = archive) => spawnSync('bash', [
    script, archivePath, archiveDigest, binaryDigest, destination,
  ], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  try {
    fs.mkdirSync(payloadDir);
    fs.writeFileSync(join(payloadDir, 'antigravity'), payload);
    const tar = spawnSync('tar', ['-czf', archive, '-C', payloadDir, 'antigravity'], { encoding: 'utf8' });
    assert.equal(tar.status, 0, tar.stderr);
    const archiveDigest = digest(fs.readFileSync(archive));
    const binaryDigest = digest(payload);
    const success = run(archiveDigest, binaryDigest);
    assert.equal(success.status, 0, success.stderr);
    assert.deepEqual(fs.readFileSync(destination), payload);
    assert.ok((fs.statSync(destination).mode & 0o111) !== 0);

    fs.rmSync(destination);
    const wrongArchive = run('0'.repeat(64), binaryDigest);
    assert.notEqual(wrongArchive.status, 0);
    assert.match(wrongArchive.stderr, /AGY_ARCHIVE_DIGEST_MISMATCH/);
    assert.equal(fs.existsSync(destination), false);

    const wrongBinary = run(archiveDigest, '0'.repeat(64));
    assert.notEqual(wrongBinary.status, 0);
    assert.match(wrongBinary.stderr, /AGY_BINARY_DIGEST_MISMATCH/);
    assert.equal(fs.existsSync(destination), false);

    const legacy = join(root, 'legacy.tar.gz');
    fs.writeFileSync(join(payloadDir, 'agy'), payload);
    const legacyTar = spawnSync('tar', ['-czf', legacy, '-C', payloadDir, 'agy'], { encoding: 'utf8' });
    assert.equal(legacyTar.status, 0, legacyTar.stderr);
    const rejectLegacy = run(digest(fs.readFileSync(legacy)), binaryDigest, legacy);
    assert.notEqual(rejectLegacy.status, 0);
    assert.match(rejectLegacy.stderr, /AGY_ARCHIVE_STRUCTURE_INVALID/);
    assert.equal(fs.existsSync(destination), false);

    fs.mkdirSync(join(payloadDir, 'extra'));
    fs.writeFileSync(join(payloadDir, 'extra/antigravity'), payload);
    const ambiguous = join(root, 'ambiguous.tar.gz');
    const doubleTar = spawnSync('tar', ['-czf', ambiguous, '-C', payloadDir, 'antigravity', 'extra/antigravity'], { encoding: 'utf8' });
    assert.equal(doubleTar.status, 0, doubleTar.stderr);
    const reject = run(digest(fs.readFileSync(ambiguous)), binaryDigest, ambiguous);
    assert.notEqual(reject.status, 0);
    assert.match(reject.stderr, /AGY_ARCHIVE_STRUCTURE_INVALID/);
    assert.equal(fs.existsSync(destination), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
