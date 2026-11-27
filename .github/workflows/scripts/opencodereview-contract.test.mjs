import assert from 'node:assert/strict';
import test from 'node:test';

const contract = await import('./opencodereview-contract.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

const previewFixture = () => ({
  schema_version: '1',
  mode: 'range',
  repository: 'fixture-repo',
  from: 'origin/main',
  to: 'a'.repeat(40),
  merge_base: 'b'.repeat(40),
  total_files: 2,
  reviewable_count: 1,
  excluded_count: 1,
  total_insertions: 5,
  total_deletions: 0,
  reviewable_files: [
    { path: 'README.md', status: 'modified', insertions: 2, deletions: 0 },
  ],
  excluded_files: [
    { path: 'notes.md', status: 'added', insertions: 3, deletions: 0, exclude_reason: 'unsupported_ext' },
  ],
});

const rulesFixture = () => ({
  schema_version: '1',
  groups: [
    {
      group_id: 1,
      source: 'custom',
      pattern: 'README.md',
      files: ['README.md'],
      rule: 'Review actionable defects only.',
    },
  ],
});

test('accepts the supported preview contract and allows additive metadata', () => {
  assert.equal(typeof contract.validateOpenCodeReviewPreview, 'function',
    'preview contract validator must be available');
  const preview = previewFixture();
  preview.future_metadata = { source: 'newer CLI' };
  assert.doesNotThrow(() => contract.validateOpenCodeReviewPreview(preview));
});

test('rejects preview counts that disagree with the file arrays', () => {
  assert.equal(typeof contract.validateOpenCodeReviewPreview, 'function',
    'preview contract validator must be available');
  const preview = previewFixture();
  preview.reviewable_count = 2;
  assert.throws(
    () => contract.validateOpenCodeReviewPreview(preview),
    { message: 'OCR_PREVIEW_COUNT_MISMATCH' },
  );
});

test('rejects malformed reviewable and excluded file records', () => {
  assert.equal(typeof contract.validateOpenCodeReviewPreview, 'function',
    'preview contract validator must be available');
  const unsafeReviewable = previewFixture();
  unsafeReviewable.reviewable_files[0].insertions = -1;
  assert.throws(
    () => contract.validateOpenCodeReviewPreview(unsafeReviewable),
    { message: 'OCR_PREVIEW_SCHEMA_INVALID' },
  );

  const missingExcludeReason = previewFixture();
  delete missingExcludeReason.excluded_files[0].exclude_reason;
  assert.throws(
    () => contract.validateOpenCodeReviewPreview(missingExcludeReason),
    { message: 'OCR_PREVIEW_SCHEMA_INVALID' },
  );
});

test('accepts the supported rule contract and rejects malformed groups', () => {
  assert.equal(typeof contract.validateOpenCodeReviewRules, 'function',
    'rule contract validator must be available');
  assert.doesNotThrow(() => contract.validateOpenCodeReviewRules(rulesFixture()));

  const malformed = rulesFixture();
  malformed.groups[0].files = 'README.md';
  assert.throws(
    () => contract.validateOpenCodeReviewRules(malformed),
    { message: 'OCR_RULE_SCHEMA_INVALID' },
  );
});
