import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runHydrogenSmoke, validateSmokeResult, formatSmokeSummary } from './agy-google-ai-pro-hydrogen-smoke.mjs';

const digest = 'a'.repeat(64);
const ok = JSON.stringify({ status: 'SUCCESS', response: 'OK', usage: { tokens: 5 } });


test('CLI entrypoint accepts one executable argument and rejects extras', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-smoke-entrypoint-'));
  try {
    const executable = join(root, 'agy-stub');
    const summaryPath = join(root, 'summary.md');
    writeFileSync(executable, '#!/bin/sh\nprintf \'%s\\n\' \'{"status":"SUCCESS","response":"OK"}\'\n');
    chmodSync(executable, 0o755);
    const script = fileURLToPath(new URL('./agy-google-ai-pro-hydrogen-smoke.mjs', import.meta.url));
    const options = {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, AGY_BINARY_SHA256: digest, RUNNER_TEMP: root, GITHUB_STEP_SUMMARY: summaryPath },
    };
    const result = spawnSync(process.execPath, [script, executable], options);
    assert.equal(result.status, 0, 'the workflow invocation must execute both bounded probes');
    const summary = readFileSync(summaryPath, 'utf8');
    assert.match(summary, /gemini-4-hydrogen-medium\`: INFERENCE_PASS/);
    assert.match(summary, /gemini-4-hydrogen-high\`: INFERENCE_PASS/);
    const unexpected = spawnSync(process.execPath, [script, executable, 'extra'], options);
    assert.equal(unexpected.status, 1);
    assert.match(unexpected.stderr, /AGY_HYDROGEN_OAUTH_SMOKE_FAILED/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('two fixed Hydrogen models are tried once in plan mode with redacted output', () => {
  const seen = [];
  const result = runHydrogenSmoke({ executable: '/tmp/agy', cliSha256: digest,
    env: { RUNNER_TEMP: '/tmp' },
    exec: (binary, args, opts) => {
      seen.push({ binary, args, opts });
      return { status: 0, stdout: ok, stderr: 'Bearer SECRET', error: undefined };
    } });
  assert.equal(result.all_passed, true);
  assert.equal(result.quality_verified, false);
  assert.deepEqual(seen.map(item => item.args[item.args.indexOf('--model') + 1]),
    ['gemini-4-hydrogen-medium', 'gemini-4-hydrogen-high']);
  for (const item of seen) {
    assert.equal(item.binary, '/tmp/agy');
    assert.ok(item.args.includes('plan'));
    assert.equal(item.opts.shell, false);
    assert.equal(item.opts.input, '');
    assert.equal(item.opts.timeout, 70000);
    assert.equal(item.opts.maxBuffer, 1048576);
  }
  assert.doesNotMatch(formatSmokeSummary(result), /SECRET|Bearer/);
  assert.match(formatSmokeSummary(result), /review quality \/ quota not established/);
});

test('stops on first failure; does not expose stderr or run second model', () => {
  let calls = 0;
  const result = runHydrogenSmoke({ executable: '/tmp/agy', cliSha256: digest,
    exec: () => { calls++; return { status: 3, stdout: 'secret', stderr: 'Bearer VERY_PRIVATE' }; } });
  assert.equal(calls, 1);
  assert.equal(result.all_passed, false);
  const summary = formatSmokeSummary(result);
  assert.match(summary, /INFERENCE_FAILED/);
  assert.match(summary, /NOT_RUN/);
  assert.doesNotMatch(summary, /VERY_PRIVATE|Bearer/);
});

test('rejects invalid responses, unsafe executable or digest', () => {
  assert.equal(validateSmokeResult(ok), true);
  assert.equal(validateSmokeResult(JSON.stringify({ status: 'SUCCESS', response: '' })), false);
  assert.equal(validateSmokeResult(JSON.stringify({ status: 'ERROR', response: 'OK' })), false);
  assert.equal(validateSmokeResult('{oops'), false);
  assert.throws(() => runHydrogenSmoke({ executable: 'agy', cliSha256: digest }), /AGY_HYDROGEN_OAUTH_SMOKE_FAILED/);
  assert.throws(() => runHydrogenSmoke({ executable: '/tmp/agy', cliSha256: 'bad' }), /AGY_HYDROGEN_OAUTH_SMOKE_FAILED/);
});
