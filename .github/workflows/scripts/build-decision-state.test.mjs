import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDecisionState, validateDecisionState } from './build-decision-state.mjs';

const features = (overrides = {}) => ({
  schema_version: '3', head_sha: 'a'.repeat(40), all_changed_files: [{ path: 'src/a.ts' }], ocr_reviewable_paths: ['src/a.ts'],
  all_changed_file_count: 10, reviewable_file_count: 3, excluded_file_count: 7, additions: 101, deletions: 1,
  change_size: 'medium', language_families: ['yaml', 'typescript', 'typescript'], change_areas: ['ci', 'auth', 'ci'],
  test_files_changed: true, security_signal: 'metadata_positive', migration_signal: 'metadata_not_observed',
  classification_status: 'high_risk_metadata', features_incomplete: false, review_scope_gap: true, risk_floor: 'deep', ...overrides,
});
const expected = {
  schema_version: '1', all_changed_file_count_bucket: '6-20', reviewable_file_count_bucket: '1-5', excluded_file_count_bucket: '6-20',
  additions_bucket: '101-500', deletions_bucket: '1-100', change_size: 'medium', language_families: ['typescript', 'yaml'],
  change_areas: ['auth', 'ci'], test_files_changed: true, security_signal: 'metadata_positive', migration_signal: 'metadata_not_observed',
  review_scope_gap: true, features_incomplete: false, classification_status: 'high_risk_metadata',
};

test('projects exactly the R4 §4.3 and §6.2 example state', () => {
  const result = buildDecisionState(features());
  assert.deepEqual(result, expected);
  assert.equal(Object.keys(result).length, 15);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  for (const forbidden of ['head_sha', 'all_changed_files', 'ocr_reviewable_paths', 'repo_id', 'repo_name']) assert.equal(Object.hasOwn(result, forbidden), false);
  assert.equal(validateDecisionState(result), undefined);
});

test('uses exact count bucket boundaries', () => {
  const cases = [
    [{ all_changed_file_count: 0, additions: 0, deletions: 0 }, ['0', '0']],
    [{ all_changed_file_count: 1, additions: 1, deletions: 100 }, ['1-5', '1-100']],
    [{ all_changed_file_count: 6, additions: 101, deletions: 500 }, ['6-20', '101-500']],
    [{ all_changed_file_count: 21, additions: 501, deletions: 2000 }, ['21-100', '501-2000']],
    [{ all_changed_file_count: 101, additions: 2001, deletions: 2001 }, ['101+', '2001+']],
  ];
  for (const [input, buckets] of cases) {
    const result = buildDecisionState(features({ ...input, reviewable_file_count: 0, excluded_file_count: 0 }));
    assert.deepEqual([result.all_changed_file_count_bucket, result.additions_bucket], buckets);
  }
});

test('rejects invalid, incomplete, inherited, unknown, and oversized input rather than leaking it', () => {
  assert.throws(() => buildDecisionState(features({ features_incomplete: true })));
  for (const patch of [
    { extra: 'leak' }, { head_sha: null }, { all_changed_file_count: Infinity }, { additions: null },
    { change_size: 'huge' }, { security_signal: 'safe' }, { all_changed_file_count_bucket: 'bogus' },
    { language_families: Array(13).fill('other') }, { language_families: ['z'] }, { change_areas: ['z'] },
  ]) assert.throws(() => buildDecisionState(features(patch)));
  const inherited = Object.assign(Object.create({ leaked: 'value' }), features());
  assert.throws(() => buildDecisionState(inherited));
});

test('validator rejects inherited properties, unknown keys, and bogus outbound buckets', () => {
  assert.throws(() => validateDecisionState({ ...expected, extra: true }));
  assert.throws(() => validateDecisionState(Object.assign(Object.create({ leaked: true }), expected)));
  assert.throws(() => validateDecisionState({ ...expected, additions_bucket: 'bogus' }));
});
