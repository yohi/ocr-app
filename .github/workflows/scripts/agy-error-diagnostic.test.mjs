import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAgyError, formatAgyErrorDiagnostic } from './agy-error-diagnostic.mjs';

test('classifies HTTP 429 AGY_ERROR without copying error prose, IDs or tokens', () => {
  const privateText = 'Bearer ghp_SECRET_TOKEN';
  const input = `progress\nAGY_ERROR: ${JSON.stringify({
    status: 'RESOURCE_EXHAUSTED', error_code: 429, code_kind: 'http',
    retryable: true, short_error: `Individual quota reached: ${privateText}`,
    error_id: privateText,
  })}\n`;
  const parsed = parseAgyError(input);
  assert.deepEqual(parsed, {
    status: 'RESOURCE_EXHAUSTED', category: 'rate_limited', errorCode: '429',
    codeKind: 'http', retryable: 'true',
  });
  const formatted = formatAgyErrorDiagnostic(parsed, 4);
  assert.match(formatted, /category=rate_limited status=RESOURCE_EXHAUSTED error_code=429/);
  assert.doesNotMatch(formatted, /PRIVATE|Bearer|quota reached|ghp_/);
});

test('classifies status even without HTTP code, and rejects malformed lines', () => {
  const error = parseAgyError('AGY_ERROR: {"canonical_status":"UNAUTHENTICATED","error_code":16,"code_kind":"grpc","retryable":false}\n');
  assert.deepEqual(error, {
    status: 'UNAUTHENTICATED', category: 'authentication_failed', errorCode: '16',
    codeKind: 'grpc', retryable: 'false',
  });
  assert.equal(parseAgyError('AGY_ERROR: {bad json}\n'), null);
  assert.equal(parseAgyError('error RESOURCE_EXHAUSTED 429'), null);
  assert.equal(parseAgyError(null), null);
  assert.equal(formatAgyErrorDiagnostic(error, 0), null);
});

test('unknown provider status remains bounded and cannot publish attacker text', () => {
  const secret = 'SECRET_PROJECT_AND_TOKEN';
  const result = parseAgyError(`AGY_ERROR: ${JSON.stringify({
    status: secret, error_code: 12345, code_kind: secret,
    retryable: secret, short_error: secret,
  })}\n`);
  assert.deepEqual(result, {
    status: 'UNKNOWN', category: 'unknown', errorCode: 'na',
    codeKind: 'unknown', retryable: 'unknown',
  });
  assert.doesNotMatch(formatAgyErrorDiagnostic(result, 1), /SECRET/);
});

test('differentiate quota, temporary unavailability and authorization failures', () => {
  const cases = [
    ['RESOURCE_EXHAUSTED', 429, 'rate_limited'],
    ['UNAVAILABLE', 503, 'service_unavailable'],
    ['UNAUTHENTICATED', 401, 'authentication_failed'],
    ['PERMISSION_DENIED', 403, 'permission_denied'],
    ['DEADLINE_EXCEEDED', 408, 'timeout'],
    ['INVALID_ARGUMENT', 400, 'invalid_request'],
  ];
  for (const [status, error_code, category] of cases) {
    assert.equal(parseAgyError(`AGY_ERROR: ${JSON.stringify({
      status, error_code, code_kind: 'http', retryable: false,
    })}\n`).category, category);
  }
});
