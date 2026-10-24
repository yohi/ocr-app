import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { countReviewableFiles, validateReviewResult } from './validate-ocr-result.mjs';

const validatorPath = fileURLToPath(new URL('./validate-ocr-result.mjs', import.meta.url));

function runValidatorOnBytes(resultBytes) {
  const directory = mkdtempSync(join(tmpdir(), 'validate-ocr-result-'));
  const resultPath = join(directory, 'result.json');
  const contextPath = join(directory, 'context.json');
  const outputPath = join(directory, 'github-output');
  writeFileSync(resultPath, resultBytes);
  writeFileSync(contextPath, JSON.stringify({ reviewable_files: [] }));
  const child = spawnSync(process.execPath, [validatorPath, resultPath, '0', contextPath], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: outputPath },
  });
  return { child, outputPath, resultBytes, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('counts reviewable files from the deterministic OCR preview', () => {
  assert.equal(countReviewableFiles({ reviewable_files: [{ path: 'a.js' }, { path: 'b.md' }] }), 2);
});

test('rejects a preview without a reviewable file list', () => {
  assert.throws(() => countReviewableFiles({}), /reviewable file list/i);
});

test('rejects a skipped result when the preview selected reviewable files', () => {
  assert.throws(
    () => validateReviewResult({
      expectedReviewableFiles: 1,
      result: { status: 'skipped', coverage: 0 },
    }),
    /reviewable files/i,
  );
});

test('rejects a failed result even when the preview selected no files', () => {
  assert.throws(
    () => validateReviewResult({
      expectedReviewableFiles: 0,
      result: { status: 'failed', coverage: 0 },
    }),
    /failed/i,
  );
});

test('accepts a successful result covering all previewed files', () => {
  assert.deepEqual(
    validateReviewResult({
      expectedReviewableFiles: 2,
      result: { status: 'success', coverage: 1 },
    }),
    { status: 'success' },
  );
});

test('rejects findings on files that are only present as supporting context', () => {
  assert.throws(
    () => validateReviewResult({
      expectedReviewableFiles: 1,
      expectedReviewablePaths: ['README.md'],
      result: {
        coverage: 1,
        findings: [{ body: 'Finding on context-only file', line: 3, path: '_mk/system.mk' }],
        status: 'success',
      },
    }),
    /not reviewable/i,
  );
});

test('accepts a skipped result when the preview selected no files', () => {
  assert.deepEqual(
    validateReviewResult({
      expectedReviewableFiles: 0,
      result: { status: 'skipped', coverage: 0 },
    }),
    { status: 'skipped' },
  );
});

test('rejects a successful result with zero coverage for previewed files', () => {
  assert.throws(
    () => validateReviewResult({
      expectedReviewableFiles: 1,
      result: { status: 'success', coverage: 0 },
    }),
    /coverage/i,
  );
});

test('rejects a successful result without numeric complete coverage', () => {
  assert.throws(
    () => validateReviewResult({
      expectedReviewableFiles: 1,
      result: { status: 'success' },
    }),
    /coverage/i,
  );
});

test('emits the raw-byte digest for validated JSON', () => {
  const resultBytes = Buffer.from('{\n  "status": "skipped"\n}\n');
  const run = runValidatorOnBytes(resultBytes);
  try {
    assert.equal(run.child.status, 0, run.child.stderr);
    assert.equal(readFileSync(run.outputPath, 'utf8'), `RESULT_SHA256=${sha256(resultBytes)}\n`);
    assert.notEqual(sha256(resultBytes), sha256(Buffer.from(JSON.stringify(JSON.parse(resultBytes.toString('utf8'))))));
  } finally {
    run.cleanup();
  }
});

test('emits the raw-byte digest before rejecting malformed JSON', () => {
  const resultBytes = Buffer.from('{ "status": "skipped",\n');
  const run = runValidatorOnBytes(resultBytes);
  try {
    assert.notEqual(run.child.status, 0);
    assert.equal(readFileSync(run.outputPath, 'utf8'), `RESULT_SHA256=${sha256(resultBytes)}\n`);
  } finally {
    run.cleanup();
  }
});
for (const mode of ['enforce', 'off', 'shadow']) {
  test(`${mode} validation diagnostics ${mode === 'enforce' ? 'hide' : 'retain'} untrusted finding paths`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'validate-ocr-result-'));
    const resultPath = join(directory, 'result.json');
    const contextPath = join(directory, 'context.json');
    const sentinel = 'PR_BODY_SECRET_SENTINEL';
    try {
      writeFileSync(resultPath, JSON.stringify({
        coverage: 1,
        findings: [{ path: sentinel }],
        status: 'success',
      }));
      writeFileSync(contextPath, JSON.stringify({ reviewable_files: [{ path: 'README.md' }] }));

      const result = spawnSync(process.execPath, [validatorPath, resultPath, '1', contextPath], {
        encoding: 'utf8',
        env: { ...process.env, DECISION_ROUTING_MODE: mode },
      });

      assert.equal(result.status, 1);
      if (mode === 'enforce') {
        assert.equal(result.stderr.trim(), 'REVIEW_VALIDATION_FAILED');
        assert.doesNotMatch(result.stdout + result.stderr, new RegExp(sentinel));
      } else {
        assert.match(result.stderr, new RegExp(sentinel));
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
