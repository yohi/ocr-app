import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseAuditDiagnostic, parseHostDiagnostic, parseAgyErrorDiagnostic, publicFailureDiagnosticFromEnv,
  safeHostFailureCode,
} from './ocr-public-failure.mjs';

test('preparation failure takes precedence over later host and audit consequences', () => {
  const detail = publicFailureDiagnosticFromEnv({
    PREPARE_FAILURE_CODE: 'REVIEW_CERTIFICATION_INVALID',
    PREPARE_FAILURE_STAGE: 'OTHER',
    HOST_FAILURE_CODE: 'REVIEW_EXECUTION_FAILED',
    HOST_DIAG_STAGE: 'payload_parse',
    HOST_DIAG_REASON: 'json_parse_failed',
    AUDIT_FAILURE_CODE: 'ENOENT',
    AUDIT_FAILURE_STAGE: 'LOAD_INPUTS',
  });
  assert.match(detail, /ルーティング準備/);
  assert.match(detail, /REVIEW_CERTIFICATION_INVALID/);
  assert.match(detail, /期限・整合性・承認状態/);
  assert.doesNotMatch(detail, /ENOENT|json_parse_failed/);
});

test('host diagnosis exposes stage, reason and bounded exit code without raw text', () => {
  const raw = 'ANTIGRAVITY_HOST_DIAGNOSTIC stage=process_exit reason=nonzero_exit output_format=unknown exit_code=17 attempt=2';
  const parsed = parseHostDiagnostic(raw);
  assert.deepEqual(parsed, { stage: 'process_exit', reason: 'nonzero_exit',
    outputFormat: 'unknown', exitCode: '17', attempt: '2' });
  const detail = publicFailureDiagnosticFromEnv({
    HOST_FAILURE_CODE: 'REVIEW_EXECUTION_FAILED',
    HOST_DIAG_STAGE: parsed.stage, HOST_DIAG_REASON: parsed.reason,
    HOST_DIAG_FORMAT: parsed.outputFormat, HOST_DIAG_EXIT: parsed.exitCode,
    HOST_DIAG_ATTEMPT: parsed.attempt,
  });
  assert.match(detail, /CLIプロセス異常終了/);
  assert.match(detail, /終了コードが0ではありません/);
  assert.match(detail, /終了コード:.*17/);
  assert.match(detail, /記録された試行: 2/);
});

test('host JSON parsing failure is distinguishable from credentials or API key failures', () => {
  const parsed = parseHostDiagnostic(
    'ANTIGRAVITY_HOST_DIAGNOSTIC stage=payload_parse reason=json_parse_failed output_format=json_like exit_code=na attempt=1',
  );
  assert.equal(parsed?.stage, 'payload_parse');
  const detail = publicFailureDiagnosticFromEnv({
    HOST_FAILURE_CODE: 'REVIEW_EXECUTION_FAILED', HOST_DIAG_STAGE: parsed.stage,
    HOST_DIAG_REASON: parsed.reason, HOST_DIAG_FORMAT: parsed.outputFormat, HOST_DIAG_EXIT: parsed.exitCode,
  });
  assert.match(detail, /CLI出力の解析/);
  assert.match(detail, /有効なJSONを取得できません/);
  assert.doesNotMatch(detail, /APIキーが不正|OAuthの期限切れ/);
});

test('audit follow-on failure is reported only when no earlier cause was recorded', () => {
  const parsed = parseAuditDiagnostic('ROUTING_AUDIT_DIAGNOSTIC code=ENOENT stage=LOAD_INPUTS reason=OTHER');
  assert.deepEqual(parsed, { code: 'ENOENT', stage: 'LOAD_INPUTS' });
  const detail = publicFailureDiagnosticFromEnv({
    AUDIT_FAILURE_CODE: parsed.code, AUDIT_FAILURE_STAGE: parsed.stage,
  });
  assert.match(detail, /ルーティング監査/);
  assert.match(detail, /ENOENT/);
  assert.match(detail, /前のステップの失敗/);
});

test('diagnostic parsers reject secret-bearing or malformed messages', () => {
  const injection = 'Bearer ghp_SUPER_SECRET\nMarkdown <img src=x onerror=alert(1)>';
  const invalid = [
    `ANTIGRAVITY_HOST_DIAGNOSTIC stage=payload_parse reason=${injection} output_format=empty exit_code=na attempt=1`,
    'ANTIGRAVITY_HOST_DIAGNOSTIC stage=process_exit reason=nonzero_exit output_format=unknown exit_code=999 attempt=1',
    'ANTIGRAVITY_HOST_DIAGNOSTIC stage=evil reason=host_error output_format=unknown exit_code=na attempt=1',
    'ANTIGRAVITY_HOST_DIAGNOSTIC stage=timeout reason=timeout output_format=unknown exit_code=na attempt=0',
  ];
  for (const line of invalid) assert.equal(parseHostDiagnostic(line), null);
  assert.equal(parseAuditDiagnostic(`ROUTING_AUDIT_DIAGNOSTIC code=${injection} stage=LOAD_INPUTS reason=OTHER`), null);

  const detail = publicFailureDiagnosticFromEnv({
    PREPARE_FAILURE_CODE: injection, PREPARE_FAILURE_STAGE: injection,
    HOST_FAILURE_CODE: injection, HOST_DIAG_STAGE: injection, HOST_DIAG_REASON: injection,
    AUDIT_FAILURE_CODE: injection, AUDIT_FAILURE_STAGE: injection,
  });
  assert.equal(detail, null);
  assert.equal(safeHostFailureCode(injection), 'REVIEW_EXECUTION_FAILED');
});

test('fixed code and stage allowlists cannot publish arbitrary text', () => {
  const secret = 'Bearer ghp_SECRET_VALUE';
  const detail = publicFailureDiagnosticFromEnv({
    HOST_FAILURE_CODE: 'MODEL_REPORTED_FAILURE',
    HOST_DIAG_STAGE: 'spawn',
    HOST_DIAG_REASON: 'spawn_failed',
    HOST_DIAG_FORMAT: 'unknown',
    HOST_DIAG_EXIT: secret,
    HOST_DIAG_ATTEMPT: '<script>doBadThing()</script>',
  });
  assert.match(detail, /MODEL_REPORTED_FAILURE/);
  assert.match(detail, /CLIを起動できませんでした/);
  assert.doesNotMatch(detail, /Bearer|SECRET_VALUE|script/);
  assert.equal(safeHostFailureCode('RUN_BINDING_MISMATCH'), 'RUN_BINDING_MISMATCH');
  assert.equal(publicFailureDiagnosticFromEnv({}), null);
});

test('allows fixed AGY_ERROR diagnostics to name rate limit without leaking raw stderr', () => {
  const line = 'AGY_ERROR_DIAGNOSTIC category=rate_limited status=RESOURCE_EXHAUSTED error_code=429 code_kind=http retryable=true attempt=3';
  const parsed = parseAgyErrorDiagnostic(line);
  assert.equal(parsed?.category, 'rate_limited');
  const detail = publicFailureDiagnosticFromEnv({
    HOST_FAILURE_CODE: 'MODEL_REPORTED_FAILURE',
    HOST_DIAG_STAGE: 'process_exit', HOST_DIAG_REASON: 'nonzero_exit',
    HOST_AGY_DIAGNOSTIC: line,
  });
  assert.match(detail, /レート制限または利用枠の上限/);
  assert.match(detail, /429/);
  assert.match(detail, /retryable=trueでも直ちに回復するとは限りません/);
  assert.doesNotMatch(detail, /ghp_PRIVATE|raw stderr/);
  assert.equal(parseAgyErrorDiagnostic(line + ' Bearer ghp_PRIVATE'), null);
  assert.equal(parseAgyErrorDiagnostic(line.replace('error_code=429', 'error_code=999')), null);
});
