import assert from 'node:assert/strict';
import test from 'node:test';

import { filterKnownFalseFindings } from './filter-ocr-findings.mjs';

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
