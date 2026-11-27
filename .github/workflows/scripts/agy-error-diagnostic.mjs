// Parse agy's structured AGY_ERROR stderr line into a fixed, non-sensitive
// classification. NEVER include short_error, error_id, stderr, or unknown fields.
const STATUSES = new Set(['RESOURCE_EXHAUSTED','UNAVAILABLE','UNAUTHENTICATED',
  'PERMISSION_DENIED','DEADLINE_EXCEEDED','INVALID_ARGUMENT','NOT_FOUND',
  'INTERNAL','UNKNOWN','ABORTED','CANCELLED','FAILED_PRECONDITION']);
const CATEGORIES = new Set(['rate_limited','service_unavailable','authentication_failed',
  'permission_denied','timeout','invalid_request','not_found','provider_error','unknown']);

export function parseAgyError(stderr) {
  if (typeof stderr !== 'string') return null;
  // Bounded lookback; agy error lines are one JSON object each.
  const lines = stderr.slice(-65536).split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('AGY_ERROR: ') || line.length > 4096) continue;
    let value;
    try { value = JSON.parse(line.slice('AGY_ERROR: '.length)); } catch { continue; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const raw = value.status ?? value.canonical_status;
    const status = typeof raw === 'string' && STATUSES.has(raw) ? raw : 'UNKNOWN';
    const errorCode = Number.isSafeInteger(value.error_code) && value.error_code >= 0 && value.error_code <= 599
      ? value.error_code : null;
    const codeKind = ['http','grpc'].includes(value.code_kind) ? value.code_kind : 'unknown';
    const retryable = typeof value.retryable === 'boolean' ? String(value.retryable) : 'unknown';
    let category = 'unknown';
    if (status === 'RESOURCE_EXHAUSTED' || (codeKind === 'http' && errorCode === 429)) category = 'rate_limited';
    else if (status === 'UNAUTHENTICATED' || (codeKind === 'http' && errorCode === 401)) category = 'authentication_failed';
    else if (status === 'PERMISSION_DENIED' || (codeKind === 'http' && errorCode === 403)) category = 'permission_denied';
    else if (status === 'DEADLINE_EXCEEDED' || (codeKind === 'http' && errorCode === 408)) category = 'timeout';
    else if (status === 'UNAVAILABLE' || (codeKind === 'http' && [502,503,504].includes(errorCode))) category = 'service_unavailable';
    else if (status === 'INVALID_ARGUMENT' || (codeKind === 'http' && errorCode === 400)) category = 'invalid_request';
    else if (status === 'NOT_FOUND' || (codeKind === 'http' && errorCode === 404)) category = 'not_found';
    else if (status === 'INTERNAL' || (codeKind === 'http' && errorCode !== null && errorCode >= 500)) category = 'provider_error';
    return Object.freeze({ status, category, errorCode: errorCode === null ? 'na' : String(errorCode),
      codeKind, retryable });
  }
  return null;
}
export function formatAgyErrorDiagnostic(error, attemptIndex) {
  if (!error || !CATEGORIES.has(error.category) || !/^[1-9][0-9]{0,3}$/.test(String(attemptIndex))) return null;
  return `AGY_ERROR_DIAGNOSTIC category=${error.category} status=${error.status} error_code=${error.errorCode} code_kind=${error.codeKind} retryable=${error.retryable} attempt=${attemptIndex}`;
}
