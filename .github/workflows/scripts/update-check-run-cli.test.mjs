import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptPath = fileURLToPath(new URL('./update-check-run.mjs', import.meta.url));
const sentinel = 'PR_BODY_SECRET_SENTINEL';
const cli = `
  import { pathToFileURL } from 'node:url';
  globalThis.fetch = async (_url, options) => {
    if (process.env.TEST_FAILURE === 'json' || process.env.TEST_FAILURE === 'read') {
      console.error('PATCH_MUST_NOT_BE_CALLED');
      throw new Error('PATCH_MUST_NOT_BE_CALLED');
    }
    if (process.env.TEST_FAILURE === 'network') throw new Error('PR_BODY_SECRET_SENTINEL');
    const body = JSON.parse(options.body);
    if (options.method !== 'PATCH' || body.conclusion !== 'failure') throw new Error('INVALID_PATCH');
    return { ok: process.env.TEST_FAILURE !== 'http', status: 503 };
  };
  process.argv[1] = process.env.SCRIPT_PATH;
  await import(pathToFileURL(process.env.SCRIPT_PATH).href);
`;

function invoke(directory, failure, mode = 'enforce') {
  const resultPath = join(directory, 'result.json');
  if (failure === 'json') writeFileSync(resultPath, sentinel);
  return spawnSync(process.execPath, ['--input-type=module'], {
    input: cli, encoding: 'utf8', timeout: 10000,
    env: {
      SCRIPT_PATH: scriptPath, TEST_FAILURE: failure, DECISION_ROUTING_MODE: mode,
      RESULT_PATH: failure === 'read' ? directory : resultPath,
      CONCLUSION: 'failure', TARGET_REPO: 'owner/repo', PR_NUMBER: '1', CHECK_RUN_ID: '1',
      DETAILS_URL: 'https://github.com/central/repo/actions/runs/1', GITHUB_TOKEN: 'test-token',
    },
  });
}

for (const failure of ['json', 'read', 'http', 'network']) {
  test(`enforce Check Run ${failure} failure exits unsuccessfully with only CHECK_UPDATE_FAILED`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'check-update-failure-'));
    try {
      const result = invoke(directory, failure);
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr.trim(), 'CHECK_UPDATE_FAILED');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

test('successful enforce Check Run update exits successfully without a failure diagnostic', () => {
  const directory = mkdtempSync(join(tmpdir(), 'check-update-success-'));
  try {
    const result = invoke(directory, 'none');
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const mode of ['off', 'shadow']) {
  test(`${mode} Check Run diagnostics retain the existing exception message`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'check-update-legacy-'));
    try {
      const result = invoke(directory, 'network', mode);
      assert.equal(result.status, 1);
      assert.equal(result.stderr.trim(), sentinel);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}
