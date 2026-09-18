import assert from 'node:assert/strict';
import test from 'node:test';

import { countReviewableFiles, validateReviewResult } from './validate-ocr-result.mjs';

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
