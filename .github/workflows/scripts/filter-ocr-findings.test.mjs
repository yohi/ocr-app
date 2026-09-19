import { execFile as nodeExecFile } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { filterKnownFalseFindings } from './filter-ocr-findings.mjs';

const execFile = promisify(nodeExecFile);
const filterScriptPath = fileURLToPath(new URL('./filter-ocr-findings.mjs', import.meta.url));
const temporaryDirectories = [];

async function createTemporaryFile(content) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'filter-ocr-findings-'));
  temporaryDirectories.push(directory);
  const resultPath = path.join(directory, 'result.json');
  await fs.writeFile(resultPath, content, 'utf8');
  return resultPath;
}

async function createResultFile(result) {
  return createTemporaryFile(JSON.stringify(result));
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    fs.rm(directory, { force: true, recursive: true })
  )));
});

test('suppresses an existence denial for a registered GitHub Actions runner label', () => {
  const { result, suppressed } = filterKnownFalseFindings({
    status: 'success',
    coverage: 1,
    findings: [{
      severity: 'high',
      path: '.github/workflows/ci.yml',
      line: 4,
      message: 'ubuntu-slim does not exist as a GitHub Actions runner.',
    }],
  });

  assert.deepEqual(result.findings, []);
  assert.deepEqual(suppressed, ['github-actions-runner-label:ubuntu-slim']);
});

test('suppresses a validity denial for a registered GitHub Actions runner label', () => {
  const { result, suppressed } = filterKnownFalseFindings({
    status: 'success',
    coverage: 1,
    findings: [{
      severity: 'high',
      path: '.github/workflows/ci.yml',
      line: 4,
      message: 'ubuntu-slim is not a valid GitHub Actions runner label.',
    }],
  });

  assert.deepEqual(result.findings, []);
  assert.deepEqual(suppressed, ['github-actions-runner-label:ubuntu-slim']);
});

test('suppresses a direct runner-context validity denial', () => {
  const { result, suppressed } = filterKnownFalseFindings({
    status: 'success',
    coverage: 1,
    findings: [{
      severity: 'high',
      path: '.github/workflows/ci.yml',
      line: 4,
      message: 'ubuntu-slim is invalid GitHub Actions runner label.',
    }],
  });

  assert.deepEqual(result.findings, []);
  assert.deepEqual(suppressed, ['github-actions-runner-label:ubuntu-slim']);
});

test('keeps a valid operational warning about the registered runner', () => {
  const { result, suppressed } = filterKnownFalseFindings({
    status: 'success',
    coverage: 1,
    findings: [{
      severity: 'medium',
      path: '.github/workflows/ci.yml',
      line: 4,
      message: 'ubuntu-slim has a 15-minute job timeout.',
    }],
  });

  assert.equal(result.findings.length, 1);
  assert.deepEqual(suppressed, []);
});

test('keeps a generic unsupported claim because it may describe a real limitation', () => {
  const { result, suppressed } = filterKnownFalseFindings({
    status: 'success',
    coverage: 1,
    findings: [{
      severity: 'medium',
      path: '.github/workflows/ci.yml',
      line: 4,
      message: 'ubuntu-slim is unsupported for this privileged Docker operation.',
    }],
  });

  assert.equal(result.findings.length, 1);
  assert.deepEqual(suppressed, []);
});

test('keeps an existence denial about a container image', () => {
  const { result, suppressed } = filterKnownFalseFindings({
    status: 'success',
    coverage: 1,
    findings: [{
      severity: 'medium',
      path: '.github/workflows/ci.yml',
      line: 4,
      message: 'ubuntu-slim does not exist as a container image.',
    }],
  });

  assert.equal(result.findings.length, 1);
  assert.deepEqual(suppressed, []);
});

test('keeps an existence denial about repository runner-group eligibility', () => {
  const { result, suppressed } = filterKnownFalseFindings({
    status: 'success',
    coverage: 1,
    findings: [{
      severity: 'medium',
      path: '.github/workflows/ci.yml',
      line: 4,
      message: "ubuntu-slim does not exist in this repository's allowed runner group.",
    }],
  });

  assert.equal(result.findings.length, 1);
  assert.deepEqual(suppressed, []);
});

test('keeps a compound security finding that mentions the known label', () => {
  const { result, suppressed } = filterKnownFalseFindings({
    status: 'success',
    coverage: 1,
    findings: [{
      severity: 'critical',
      path: '.github/workflows/ci.yml',
      line: 4,
      message: 'Untrusted PR code can bypass isolation; ubuntu-slim does not exist as a runner.',
    }],
  });

  assert.equal(result.findings.length, 1);
  assert.deepEqual(suppressed, []);
});

test('suppresses a direct runner-label denial without requiring the full provider name', () => {
  const { result, suppressed } = filterKnownFalseFindings({
    status: 'success',
    coverage: 1,
    findings: [{
      severity: 'high',
      path: '.github/workflows/ci.yml',
      line: 4,
      message: 'The ubuntu-slim runner label is invalid.',
    }],
  });

  assert.deepEqual(result.findings, []);
  assert.deepEqual(suppressed, ['github-actions-runner-label:ubuntu-slim']);
});

test('keeps an existence denial for an unregistered runner label', () => {
  const { result, suppressed } = filterKnownFalseFindings({
    status: 'success',
    coverage: 1,
    findings: [{
      severity: 'high',
      path: '.github/workflows/ci.yml',
      line: 4,
      message: 'ubuntu-example does not exist as a GitHub Actions runner.',
    }],
  });

  assert.equal(result.findings.length, 1);
  assert.deepEqual(suppressed, []);
});

test('preserves non-suppressed findings and result metadata without mutating the input', () => {
  const input = {
    status: 'success',
    coverage: 1,
    message: 'Review complete',
    findings: [
      {
        severity: 'high',
        path: '.github/workflows/ci.yml',
        line: 4,
        message: 'ubuntu-slim does not exist.',
      },
      {
        severity: 'low',
        path: 'README.md',
        line: 12,
        content: 'Document the supported workflow.',
      },
    ],
  };
  const original = structuredClone(input);

  const { result, suppressed } = filterKnownFalseFindings(input);

  assert.deepEqual(input, original);
  assert.deepEqual(result, {
    status: 'success',
    coverage: 1,
    message: 'Review complete',
    findings: [input.findings[1]],
  });
  assert.deepEqual(suppressed, ['github-actions-runner-label:ubuntu-slim']);
});

test('returns an unchanged result when findings are absent', () => {
  const result = { status: 'skipped', coverage: 0 };

  const filtered = filterKnownFalseFindings(result);

  assert.strictEqual(filtered.result, result);
  assert.deepEqual(filtered.suppressed, []);
});

test('CLI filters the result file in place and reports suppressed rules', async () => {
  const resultPath = await createResultFile({
    status: 'success',
    coverage: 1,
    findings: [
      { message: 'ubuntu-slim does not exist as a GitHub Actions runner.' },
      { message: 'ubuntu-slim has a 15-minute job timeout.' },
    ],
  });

  const { stderr, stdout } = await execFile(process.execPath, [filterScriptPath, resultPath], {
    encoding: 'utf8',
  });

  assert.equal(stderr, '');
  assert.equal(
    stdout,
    'Suppressed 1 known false-positive rule(s): github-actions-runner-label:ubuntu-slim\n',
  );
  assert.deepEqual(JSON.parse(await fs.readFile(resultPath, 'utf8')), {
    status: 'success',
    coverage: 1,
    findings: [{ message: 'ubuntu-slim has a 15-minute job timeout.' }],
  });
});

test('CLI exits non-zero and preserves malformed input', async () => {
  const malformedResult = '{"status":';
  const resultPath = await createTemporaryFile(malformedResult);

  await assert.rejects(
    () => execFile(process.execPath, [filterScriptPath, resultPath], { encoding: 'utf8' }),
    error => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, '');
      assert.match(error.stderr, /Failed to parse result JSON file/);
      return true;
    },
  );
  assert.equal(await fs.readFile(resultPath, 'utf8'), malformedResult);
});
