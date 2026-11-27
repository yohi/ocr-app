function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validFileRecord(file, { excluded = false } = {}) {
  return isRecord(file) &&
    isNonEmptyString(file.path) &&
    isNonEmptyString(file.status) &&
    isCount(file.insertions) &&
    isCount(file.deletions) &&
    (!excluded || isNonEmptyString(file.exclude_reason));
}

export function validateOpenCodeReviewPreview(preview) {
  if (
    !isRecord(preview) ||
    preview.schema_version !== '1' ||
    preview.mode !== 'range' ||
    !isNonEmptyString(preview.repository) ||
    !isNonEmptyString(preview.from) ||
    !isNonEmptyString(preview.to) ||
    !isNonEmptyString(preview.merge_base) ||
    !isCount(preview.total_files) ||
    !isCount(preview.reviewable_count) ||
    !isCount(preview.excluded_count) ||
    !isCount(preview.total_insertions) ||
    !isCount(preview.total_deletions) ||
    !Array.isArray(preview.reviewable_files) ||
    !Array.isArray(preview.excluded_files) ||
    !preview.reviewable_files.every(file => validFileRecord(file)) ||
    !preview.excluded_files.every(file => validFileRecord(file, { excluded: true }))
  ) {
    throw new Error('OCR_PREVIEW_SCHEMA_INVALID');
  }

  if (
    preview.total_files !== preview.reviewable_count + preview.excluded_count ||
    preview.reviewable_count !== preview.reviewable_files.length ||
    preview.excluded_count !== preview.excluded_files.length
  ) {
    throw new Error('OCR_PREVIEW_COUNT_MISMATCH');
  }

  const files = [...preview.reviewable_files, ...preview.excluded_files];
  if (
    preview.total_insertions !== files.reduce((total, file) => total + file.insertions, 0) ||
    preview.total_deletions !== files.reduce((total, file) => total + file.deletions, 0)
  ) {
    throw new Error('OCR_PREVIEW_COUNT_MISMATCH');
  }

  return preview;
}

export function validateOpenCodeReviewRules(rules) {
  if (
    !isRecord(rules) ||
    rules.schema_version !== '1' ||
    !Array.isArray(rules.groups) ||
    !rules.groups.every(group =>
      isRecord(group) &&
      Number.isSafeInteger(group.group_id) &&
      group.group_id > 0 &&
      isNonEmptyString(group.source) &&
      isNonEmptyString(group.pattern) &&
      Array.isArray(group.files) &&
      group.files.every(isNonEmptyString) &&
      isNonEmptyString(group.rule)
    )
  ) {
    throw new Error('OCR_RULE_SCHEMA_INVALID');
  }

  return rules;
}
