const LANGUAGE = new Set(['markdown', 'python', 'typescript', 'javascript', 'json', 'yaml', 'sql', 'shell', 'terraform', 'other', 'unknown']);
const AREA = new Set(['docs', 'ci', 'auth', 'iam', 'secret', 'crypto', 'migration', 'deploy', 'payment', 'other', 'unknown']);
const SIGNAL = new Set(['metadata_positive', 'metadata_not_observed', 'unassessable']);
const CLASSIFICATION = new Set(['allowlisted_docs_only', 'high_risk_metadata', 'unclassified_code', 'unclassified_other', 'incomplete']);
const SIZE = new Set(['small', 'medium', 'large', 'unknown']);
const STATE_KEYS = ['schema_version', 'all_changed_file_count_bucket', 'reviewable_file_count_bucket', 'excluded_file_count_bucket', 'additions_bucket', 'deletions_bucket', 'change_size', 'language_families', 'change_areas', 'test_files_changed', 'security_signal', 'migration_signal', 'review_scope_gap', 'features_incomplete', 'classification_status'];
const FEATURE_KEYS = new Set(['schema_version', 'head_sha', 'all_changed_files', 'ocr_reviewable_paths', 'all_changed_file_count', 'reviewable_file_count', 'excluded_file_count', 'additions', 'deletions', 'change_size', 'language_families', 'change_areas', 'test_files_changed', 'security_signal', 'migration_signal', 'classification_status', 'features_incomplete', 'review_scope_gap', 'risk_floor']);
const FILE_BUCKETS = new Set(['0', '1-5', '6-20', '21-100', '101+']);
const LINE_BUCKETS = new Set(['0', '1-100', '101-500', '501-2000', '2001+']);

function ensureRecord(value, allowedKeys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${label} must be a plain object`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) throw new Error(`${label} has an unknown key`);
  }
}
function enumValue(value, allowed, label) { if (typeof value !== 'string' || !allowed.has(value)) throw new Error(`${label} is invalid`); return value; }
function count(value, label) { if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid`); return value; }
function bucket(value, limits, labels) { count(value, 'Count'); for (let index = 0; index < limits.length; index++) if (value <= limits[index]) return labels[index]; return labels.at(-1); }
function compareCodeUnits(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function sortedUnique(values, allowed, label) {
  if (!Array.isArray(values) || values.length > 12 || values.some(value => typeof value !== 'string' || !allowed.has(value))) throw new Error(`${label} is invalid`);
  return [...new Set(values)].sort(compareCodeUnits);
}
function validateFeatures(features) {
  ensureRecord(features, FEATURE_KEYS, 'Features');
  if (features.schema_version !== '3' || typeof features.head_sha !== 'string' || !/^[a-f0-9]{40}$/i.test(features.head_sha)) throw new Error('Feature version or head SHA is invalid');
  if (features.features_incomplete !== false) throw new Error('Incomplete features cannot be projected');
  for (const name of ['all_changed_file_count', 'reviewable_file_count', 'excluded_file_count', 'additions', 'deletions']) count(features[name], name);
  enumValue(features.change_size, SIZE, 'change_size');
  enumValue(features.security_signal, SIGNAL, 'security_signal'); enumValue(features.migration_signal, SIGNAL, 'migration_signal');
  enumValue(features.classification_status, CLASSIFICATION, 'classification_status');
  if (typeof features.test_files_changed !== 'boolean' || typeof features.review_scope_gap !== 'boolean') throw new Error('Feature boolean is invalid');
  sortedUnique(features.language_families, LANGUAGE, 'language_families'); sortedUnique(features.change_areas, AREA, 'change_areas');
  if (!Array.isArray(features.all_changed_files) || !Array.isArray(features.ocr_reviewable_paths)) throw new Error('Internal path collections are invalid');
  return { languages: sortedUnique(features.language_families, LANGUAGE, 'language_families'), areas: sortedUnique(features.change_areas, AREA, 'change_areas') };
}

export function validateDecisionState(state) {
  ensureRecord(state, new Set(STATE_KEYS), 'Decision state');
  if (Reflect.ownKeys(state).length !== STATE_KEYS.length || STATE_KEYS.some(key => !Object.hasOwn(state, key))) throw new Error('Decision state keys are invalid');
  if (state.schema_version !== '1') throw new Error('Decision state version is invalid');
  for (const key of ['all_changed_file_count_bucket', 'reviewable_file_count_bucket', 'excluded_file_count_bucket']) enumValue(state[key], FILE_BUCKETS, key);
  for (const key of ['additions_bucket', 'deletions_bucket']) enumValue(state[key], LINE_BUCKETS, key);
  enumValue(state.change_size, SIZE, 'change_size'); enumValue(state.security_signal, SIGNAL, 'security_signal'); enumValue(state.migration_signal, SIGNAL, 'migration_signal'); enumValue(state.classification_status, CLASSIFICATION, 'classification_status');
  sortedUnique(state.language_families, LANGUAGE, 'language_families'); sortedUnique(state.change_areas, AREA, 'change_areas');
  for (const key of ['test_files_changed', 'review_scope_gap', 'features_incomplete']) {
    if (typeof state[key] !== 'boolean') throw new Error(`${key} is invalid`);
  }
}

export function buildDecisionState(features) {
  const { languages, areas } = validateFeatures(features);
  const state = {};
  state.schema_version = '1';
  state.all_changed_file_count_bucket = bucket(features.all_changed_file_count, [0, 5, 20, 100], ['0', '1-5', '6-20', '21-100', '101+']);
  state.reviewable_file_count_bucket = bucket(features.reviewable_file_count, [0, 5, 20, 100], ['0', '1-5', '6-20', '21-100', '101+']);
  state.excluded_file_count_bucket = bucket(features.excluded_file_count, [0, 5, 20, 100], ['0', '1-5', '6-20', '21-100', '101+']);
  state.additions_bucket = bucket(features.additions, [0, 100, 500, 2000], ['0', '1-100', '101-500', '501-2000', '2001+']);
  state.deletions_bucket = bucket(features.deletions, [0, 100, 500, 2000], ['0', '1-100', '101-500', '501-2000', '2001+']);
  state.change_size = features.change_size;
  state.language_families = languages;
  state.change_areas = areas;
  state.test_files_changed = features.test_files_changed;
  state.security_signal = features.security_signal;
  state.migration_signal = features.migration_signal;
  state.review_scope_gap = features.review_scope_gap;
  state.features_incomplete = features.features_incomplete;
  state.classification_status = features.classification_status;
  validateDecisionState(state);
  return state;
}
