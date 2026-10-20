import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPRRisk } from './classify-pr-review-risk.mjs';
import policy from '../config/review-risk-policy.json' with { type: 'json' };

const base = (path = 'README.md', overrides = {}) => ({
  schema_version: '3', head_sha: 'a'.repeat(40),
  all_changed_files: [{ path, status: 'modified', oldMode: '100644', mode: '100644', additions: 1, deletions: 0, binary: false }],
  ocr_reviewable_paths: [path], all_changed_file_count: 1, reviewable_file_count: 1,
  excluded_file_count: 0, additions: 1, deletions: 0, change_size: 'small',
  language_families: ['markdown'], change_areas: ['docs'], test_files_changed: false,
  security_signal: 'metadata_not_observed', migration_signal: 'metadata_not_observed',
  classification_status: 'incomplete', features_incomplete: false,
  review_scope_gap: false, risk_floor: 'deep', ...overrides,
});

test('allows only fully reviewable README markdown modifications as fast', () => {
  const result = classifyPRRisk(base(), policy);
  assert.equal(result.classification_status, 'allowlisted_docs_only');
  assert.equal(result.risk_floor, 'fast');
  const added = classifyPRRisk(base('README.md', { all_changed_files: [{ path: 'README.md', status: 'added', oldMode: '000000', mode: '100644', additions: 1, deletions: 0, binary: false }] }), policy);
  assert.equal(added.risk_floor, 'deep');
  assert.equal(classifyPRRisk(base('README.md', { review_scope_gap: true }), policy).risk_floor, 'deep');
});

test('deny paths override allow paths and code or mixed changes remain deep', () => {
  for (const path of ['docs/security-policy.md', 'AGENTS.md', '.github/workflows/a.yml', 'src/util.ts']) {
    const result = classifyPRRisk(base(path), policy);
    assert.equal(result.risk_floor, 'deep', path);
  }
  const mixed = classifyPRRisk(base('README.md', { all_changed_files: [base().all_changed_files[0], { path: 'src/util.ts', status: 'modified', oldMode: '100644', mode: '100644', additions: 1, deletions: 0, binary: false }], all_changed_file_count: 2, reviewable_file_count: 1, excluded_file_count: 1, review_scope_gap: true }), policy);
  assert.equal(mixed.risk_floor, 'deep');
  assert.equal(mixed.classification_status, 'unclassified_code');
});

test('rename, binary, executable/mode changes and unknown metadata remain deep', () => {
  const variations = [
    { status: 'renamed', oldPath: 'README.md' },
    { binary: true },
    { mode: '100755', oldMode: '100644' },
    { mode: '120000', oldMode: '100644' },
    { mode: '100644', oldMode: '100755' },
    { mode: '100755', oldMode: '000000', status: 'added' },
    { status: 'unknown' },
  ];
  for (const variation of variations) {
    const original = base().all_changed_files[0];
    assert.equal(classifyPRRisk(base('README.md', { all_changed_files: [{ ...original, ...variation }] }), policy).risk_floor, 'deep');
  }
  for (const file of [
    { ...base().all_changed_files[0], oldMode: '100755', mode: '100644' },
    { ...base().all_changed_files[0], status: 'added', oldMode: '000000', mode: '100755' },
  ]) {
    const result = classifyPRRisk(base('README.md', { all_changed_files: [file] }), policy);
    assert.equal(result.classification_status, 'unclassified_other');
    assert.equal(result.risk_floor, 'deep');
  }
});

test('incomplete features and unobserved security metadata never establish safe code', () => {
  const incomplete = classifyPRRisk(base('README.md', { features_incomplete: true }), policy);
  assert.deepEqual([incomplete.classification_status, incomplete.risk_floor], ['incomplete', 'deep']);
  const invalidCount = classifyPRRisk(base('README.md', { additions: Infinity }), policy);
  assert.deepEqual([invalidCount.classification_status, invalidCount.risk_floor], ['incomplete', 'deep']);
  const code = classifyPRRisk(base('src/util.ts', { security_signal: 'metadata_not_observed' }), policy);
  assert.deepEqual([code.classification_status, code.risk_floor], ['unclassified_code', 'deep']);
  const unknown = classifyPRRisk(base('README.md', { security_signal: 'unassessable' }), policy);
  assert.deepEqual([unknown.classification_status, unknown.risk_floor], ['unclassified_other', 'deep']);
});
