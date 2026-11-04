const CLASSES = new Set(['allowlisted_docs_only', 'allowlisted_low_risk_code', 'high_risk_metadata', 'unclassified_code', 'unclassified_other', 'incomplete']);
const CODE_EXTENSIONS = /\.(?:[cm]?[jt]sx?|py|sql|sh)$/i;
const HIGH_RISK = /(?:^|[\\/._-])(?:security|identity|auth|credential|permission|secret|policy|iam|crypto|migration|migrations|payment|deploy)(?:$|[\\/._-])/i;
const TEST_GENERATED_DIR = /(?:^|\/)(?:test|tests|spec|specs|__tests__|fixtures|__fixtures__|generated|__generated__)(?:\/|$)/i;
const TEST_SPEC_BASENAME = /(?:^|[._-])(?:test|tests|spec|specs)(?=[._-]|$)/i;


function validPolicy(policy) {
  if (!policy || typeof policy !== 'object' || !Array.isArray(policy.allow_paths) || !Array.isArray(policy.deny_paths)) throw new Error('Trusted risk policy is invalid');
  const fastPaths = Array.isArray(policy.fast_code_allow_paths) ? policy.fast_code_allow_paths : [];
  const seen = new Set();
  for (const pattern of [...policy.allow_paths, ...policy.deny_paths, ...fastPaths]) {
    if (typeof pattern !== 'string' || pattern.length > 256) throw new Error('Trusted path rule is invalid');
    try { new RegExp(pattern); } catch { throw new Error('Trusted path rule is invalid'); }
  }
  for (const pattern of fastPaths) {
    if (seen.has(pattern)) throw new Error('Trusted path rule is invalid');
    seen.add(pattern);
  }
}

function pathsMatch(paths, rules) {
  return paths.some(path => rules.some(rule => new RegExp(rule).test(path)));
}

function isValidRecord(file) {
  return Boolean(file && typeof file === 'object' && typeof file.path === 'string' && file.path &&
    typeof file.status === 'string' && typeof file.oldMode === 'string' && typeof file.mode === 'string');
}

function isCodeFile(file) {
  return CODE_EXTENSIONS.test(file.path) || (typeof file.oldPath === 'string' && CODE_EXTENSIONS.test(file.oldPath));
}

function isKnownStatus(status) {
  return ['added', 'modified', 'deleted', 'renamed', 'copied', 'type_changed'].includes(status);
}

function isNormalTextChange(file) {
  const normalOldMode = file.status === 'added' ? file.oldMode === '000000' : file.oldMode === file.mode;
  return ['added', 'modified'].includes(file.status) && file.mode === '100644' &&
    normalOldMode && file.binary === false &&
    file.additions !== null && file.deletions !== null && file.oldPath === undefined;
}

function collectFileSummary(files) {
  const paths = [];
  let validRecords = files.length > 0;
  let code = false;
  let known = true;
  let normalText = true;
  for (const file of files) {
    if (!isValidRecord(file)) { validRecords = false; known = false; continue; }
    paths.push(file.path);
    if (typeof file.oldPath === 'string') paths.push(file.oldPath);
    else if (file.oldPath !== undefined) { validRecords = false; known = false; }
    code ||= isCodeFile(file);
    known &&= isKnownStatus(file.status);
    normalText &&= isNormalTextChange(file);
  }
  const unsafeMode = files.some(file => file && typeof file === 'object' && typeof file.mode === 'string' && typeof file.oldMode === 'string' && (file.mode === '100755' || file.oldMode === '100755' || (file.status !== 'added' && file.oldMode !== file.mode)));
  return { paths, validRecords, code, known, normalText, unsafeMode };
}

function isIncomplete(features, files, validRecords) {
  const validCount = value => Number.isSafeInteger(value) && value >= 0;
  return features.features_incomplete !== false || !validRecords ||
    !validCount(features.all_changed_file_count) || features.all_changed_file_count !== files.length ||
    !validCount(features.reviewable_file_count) || !validCount(features.excluded_file_count) ||
    !validCount(features.additions) || !validCount(features.deletions) ||
    typeof features.test_files_changed !== 'boolean' ||
    typeof features.review_scope_gap !== 'boolean' || !Array.isArray(features.ocr_reviewable_paths);
}
function isNonOverridableTestOrGenerated(features) {
  if (features.test_files_changed === true) return true;
  const files = features.all_changed_files;
  if (!Array.isArray(files)) return false;
  for (const file of files) {
    if (!file || typeof file !== 'object') continue;
    for (const path of [file.path, file.oldPath]) {
      if (typeof path !== 'string') continue;
      if (TEST_GENERATED_DIR.test(path)) return true;
      const basename = path.split('/').pop();
      if (TEST_SPEC_BASENAME.test(basename)) return true;
    }
  }
  return false;
}

function allPathsMatchAllowlist(paths, allowlist) {
  return Array.isArray(allowlist) && allowlist.length > 0 && paths.every(path => pathsMatch([path], allowlist));
}


function decideStatus(features, { paths, code, known, normalText, unsafeMode }, incomplete, trustedRiskPolicy) {
  const signalsKnown = ['metadata_positive', 'metadata_not_observed', 'unassessable'].includes(features.security_signal) && ['metadata_positive', 'metadata_not_observed', 'unassessable'].includes(features.migration_signal);
  let classification_status;
  if (incomplete) classification_status = 'incomplete';
  else if (!signalsKnown) classification_status = 'unclassified_other';
  else if (features.security_signal === 'metadata_positive' || features.migration_signal === 'metadata_positive' || paths.some(path => HIGH_RISK.test(path))) classification_status = 'high_risk_metadata';
  else if (unsafeMode) classification_status = 'unclassified_other';
  else if (code) {
    if (known && !isNonOverridableTestOrGenerated(features) && normalText && features.change_size === 'small' &&
        features.all_changed_file_count >= 1 && features.all_changed_file_count <= 5 &&
        features.security_signal === 'metadata_not_observed' && features.migration_signal === 'metadata_not_observed' &&
        features.features_incomplete === false && features.review_scope_gap === false &&
        allPathsMatchAllowlist(paths, trustedRiskPolicy.fast_code_allow_paths)) {
      classification_status = 'allowlisted_low_risk_code';
    } else {
      classification_status = 'unclassified_code';
    }
  }
  else if (!known || paths.some(path => !pathsMatch([path], trustedRiskPolicy.allow_paths)) || pathsMatch(paths, trustedRiskPolicy.deny_paths)) classification_status = 'unclassified_other';
  else if (normalText && features.security_signal === 'metadata_not_observed' && features.migration_signal === 'metadata_not_observed' && features.features_incomplete === false && features.review_scope_gap === false) classification_status = 'allowlisted_docs_only';
  else classification_status = 'unclassified_other';
  if (!CLASSES.has(classification_status)) throw new Error('Risk classification failed');
  return classification_status;
}

export function classifyPRRisk(features, trustedRiskPolicy) {
  validPolicy(trustedRiskPolicy);
  if (!features || typeof features !== 'object') throw new Error('Features must be an object');
  const files = features.all_changed_files;
  if (!Array.isArray(files)) return { ...features, classification_status: 'incomplete', risk_floor: 'deep' };
  const summary = collectFileSummary(files);
  const incomplete = isIncomplete(features, files, summary.validRecords);
  const classification_status = decideStatus(features, summary, incomplete, trustedRiskPolicy);
  return { ...features, classification_status, risk_floor: (classification_status === 'allowlisted_docs_only' || classification_status === 'allowlisted_low_risk_code') ? 'fast' : 'deep' };
}
