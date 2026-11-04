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
const fixturePolicy = { ...policy, fast_code_allow_paths: ['^src/safe/.*\\.(?:ts|js|py)$'] };
const codeFile = (path, overrides = {}) => ({ path, status: 'modified', oldMode: '100644', mode: '100644', additions: 1, deletions: 0, binary: false, ...overrides });
const codeBase = (path = 'src/safe/parser.ts', overrides = {}) => base(path, {
  all_changed_files: [codeFile(path)],
  ocr_reviewable_paths: [path],
  language_families: ['typescript'],
  change_areas: ['other'],
  test_files_changed: false,
  ...overrides,
});


test('allows only fully reviewable README markdown modifications as fast', () => {
  const result = classifyPRRisk(base(), policy);
  assert.equal(result.classification_status, 'allowlisted_docs_only');
  assert.equal(result.risk_floor, 'fast');
  assert.equal(classifyPRRisk(base('README.md', { review_scope_gap: true }), policy).risk_floor, 'deep');
});

test('allows an added allowlisted README markdown file as fast', () => {
  const added = classifyPRRisk(base('README.md', { all_changed_files: [{ path: 'README.md', status: 'added', oldMode: '000000', mode: '100644', additions: 1, deletions: 0, binary: false }] }), policy);
  assert.equal(added.classification_status, 'allowlisted_docs_only');
  assert.equal(added.risk_floor, 'fast');
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

test('C01: allowlisted low-risk code selects new enum and fast floor with fixture allowlist', () => {
  const result = classifyPRRisk(codeBase('src/safe/parser.ts'), fixturePolicy);
  assert.equal(result.classification_status, 'allowlisted_low_risk_code');
  assert.equal(result.risk_floor, 'fast');
});

test('C02: empty fast_code_allow_paths keeps normal code as unclassified_code deep', () => {
  const result = classifyPRRisk(codeBase('src/safe/parser.ts'), policy);
  assert.equal(result.classification_status, 'unclassified_code');
  assert.equal(result.risk_floor, 'deep');
});

test('C03: mixed docs and code PR remains deep even when code path is allowlisted', () => {
  const result = classifyPRRisk(codeBase('src/safe/parser.ts', {
    all_changed_files: [codeFile('src/safe/parser.ts'), { path: 'README.md', status: 'modified', oldMode: '100644', mode: '100644', additions: 1, deletions: 0, binary: false }],
    all_changed_file_count: 2, reviewable_file_count: 2, excluded_file_count: 0, review_scope_gap: false,
  }), fixturePolicy);
  assert.equal(result.classification_status, 'unclassified_code');
  assert.equal(result.risk_floor, 'deep');
});

test('C04: high-risk tokens in allowlisted path remain high_risk_metadata deep', () => {
  for (const path of ['src/safe/auth/token.ts', 'src/safe/identity/map.ts', 'src/safe/credential/store.ts', 'src/safe/secret/manager.ts', 'src/safe/policy/rule.ts', 'src/safe/crypto/util.ts', 'src/safe/migration/001.ts', 'src/safe/payment/gateway.ts']) {
    const result = classifyPRRisk(codeBase(path), fixturePolicy);
    assert.equal(result.classification_status, 'high_risk_metadata', path);
    assert.equal(result.risk_floor, 'deep', path);
  }
});

test('C05: CI/workflow and migration paths stay deep even if allowlisted', () => {
  const ci = classifyPRRisk(codeBase('.github/workflows/ci.yml', { language_families: ['yaml'], change_areas: ['ci'] }), fixturePolicy);
  assert.equal(ci.risk_floor, 'deep');
  const migration = classifyPRRisk(codeBase('src/safe/migrations/001.ts', { change_areas: ['migration'] }), fixturePolicy);
  assert.equal(migration.risk_floor, 'deep');
});

test('C06: rename, binary, executable, and delete code stay deep despite allowlist', () => {
  const variations = [
    { status: 'renamed', oldPath: 'src/safe/parser.ts' },
    { binary: true },
    { mode: '100755', oldMode: '100644' },
    { status: 'deleted', oldMode: '100644', mode: '100644', additions: 0, deletions: 10 },
  ];
  for (const variation of variations) {
    const result = classifyPRRisk(codeBase('src/safe/parser.ts', { all_changed_files: [{ ...codeFile('src/safe/parser.ts'), ...variation }] }), fixturePolicy);
    assert.equal(result.risk_floor, 'deep', JSON.stringify(variation));
  }
});

test('C07: scope gap, incomplete features, and unassessable signals keep code deep', () => {
  const gap = classifyPRRisk(codeBase('src/safe/parser.ts', { review_scope_gap: true }), fixturePolicy);
  assert.equal(gap.risk_floor, 'deep');
  const incomplete = classifyPRRisk(codeBase('src/safe/parser.ts', { features_incomplete: true }), fixturePolicy);
  assert.equal(incomplete.classification_status, 'incomplete');
  assert.equal(incomplete.risk_floor, 'deep');
  const unassessable = classifyPRRisk(codeBase('src/safe/parser.ts', { security_signal: 'unassessable' }), fixturePolicy);
  assert.equal(unassessable.risk_floor, 'deep');
});

test('C08 and C08a-e: test files, fixtures, and generated paths stay unclassified_code deep', () => {
  for (const path of [
    'src/safe/parser.test.ts',
    'tests/safe.py',
    'src/safe/parser.spec.ts',
    'src/safe/fixtures/data.ts',
    'src/safe/generated/client.ts',
    'src/safe/__fixtures__/data.ts',
    'src/safe/__generated__/client.ts',
  ]) {
    const result = classifyPRRisk(codeBase(path), fixturePolicy);
    assert.equal(result.classification_status, 'unclassified_code', path);
    assert.equal(result.risk_floor, 'deep', path);
  }
  const flag = classifyPRRisk(codeBase('src/safe/parser.ts', { test_files_changed: true }), fixturePolicy);
  assert.equal(flag.classification_status, 'unclassified_code');
  assert.equal(flag.risk_floor, 'deep');
});

test('C09: docs-only PR keeps allowlisted_docs_only fast unchanged', () => {
  const result = classifyPRRisk(base('README.md'), policy);
  assert.equal(result.classification_status, 'allowlisted_docs_only');
  assert.equal(result.risk_floor, 'fast');
});

test('unknown status, malformed metadata, and unsafe modes are not overridden by empty allowlist', () => {
  assert.equal(classifyPRRisk(codeBase('src/safe/parser.ts', { all_changed_files: [codeFile('src/safe/parser.ts', { status: 'unknown' })] }), fixturePolicy).classification_status, 'unclassified_code');
});
