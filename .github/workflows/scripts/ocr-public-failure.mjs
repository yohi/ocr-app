// Public diagnostics contain fixed enums only. Never publish raw exceptions,
// child stdout/stderr, prompts, API response bodies, or tokens.
const PREPARE_CODES = new Set([
  'ROUTING_ACTIVATION_DENIED', 'REVIEW_CERTIFICATION_INVALID',
  'REVIEW_CLI_UNAVAILABLE', 'RUN_BINDING_MISMATCH',
  'ROUTING_SOURCE_MANIFEST_INVALID', 'ROUTE_SCHEMA_INVALID', 'UNKNOWN',
]);
const PREPARE_STAGES = new Set(['AUTHORITY_INITIAL_LOAD', 'AUTHORITY_REFRESH_LOAD', 'OTHER']);
const HOST_CODES = new Set([
  'REVIEW_EXECUTION_FAILED', 'ROUTING_ACTIVATION_DENIED',
  'ROUTING_AUTHORITY_UNAVAILABLE', 'AUDIT_INCOMPLETE',
  'MODEL_REPORTED_FAILURE', 'INVALID_REVIEW_INPUT',
  'INVALID_FALLBACK_MODELS', 'NO_SELECTED_REVIEW_ROUTE',
  'ROUTING_EXECUTION_CONTEXT_INVALID', 'RUN_BINDING_INVALID', 'RUN_BINDING_MISMATCH',
]);
const HOST_STAGES = new Set([
  'host_execution', 'process_exit', 'spawn', 'timeout', 'payload_parse',
  'schema_validation', 'model_result',
]);
const HOST_REASONS = new Set([
  'host_error', 'nonzero_exit', 'terminated_by_signal', 'spawn_failed', 'timeout',
  'empty_stdout', 'empty_response', 'json_parse_failed', 'invalid_envelope',
  'invalid_schema', 'failed_status',
]);
const OUTPUT_FORMATS = new Set(['unknown', 'empty', 'json_like', 'mixed_or_stream', 'text', 'parsed_json']);
const PROVIDER_CATEGORIES = new Set(['rate_limited','service_unavailable','authentication_failed',
  'permission_denied','timeout','invalid_request','not_found','provider_error','unknown']);
const PROVIDER_STATUSES = new Set(['RESOURCE_EXHAUSTED','UNAVAILABLE','UNAUTHENTICATED',
  'PERMISSION_DENIED','DEADLINE_EXCEEDED','INVALID_ARGUMENT','NOT_FOUND',
  'INTERNAL','UNKNOWN','ABORTED','CANCELLED','FAILED_PRECONDITION']);
const PROVIDER_LABELS = Object.freeze({
  rate_limited: 'レート制限または利用枠の上限',
  service_unavailable: '提供元の一時的な利用不可',
  authentication_failed: '提供元への認証失敗',
  permission_denied: '提供元での権限拒否',
  timeout: '提供元の処理期限超過',
  invalid_request: '提供元に拒否されたリクエスト',
  not_found: 'モデルまたはリソースが見つかりません',
  provider_error: '提供元内部エラー',
  unknown: '特定できない提供元エラー',
});
const AUDIT_CODES = new Set([
  'ENOENT', 'AUDIT_EVENT_INVALID', 'AUDIT_ALREADY_WRITTEN', 'AUDIT_NOT_SEALED',
  'ROUTING_AUTHORITY_UNAVAILABLE', 'ROUTING_EXECUTION_CONTEXT_INVALID',
  'ROUTING_ACTIVATION_DENIED', 'REVIEW_CERTIFICATION_INVALID',
  'RUN_BINDING_INVALID', 'RUN_BINDING_MISMATCH', 'UNKNOWN',
]);
const AUDIT_STAGES = new Set([
  'LOAD_INPUTS', 'VALIDATE_RESULT', 'REFRESH_AUTHORITY',
  'REVALIDATE_CONTEXT', 'FINALIZE_RECORD', 'WRITE_AUDIT', 'LOG_SUMMARY',
]);

function fixed(value, set) {
  return typeof value === 'string' && set.has(value) ? value : null;
}

export function safeHostFailureCode(value) {
  return fixed(value, HOST_CODES) ?? 'REVIEW_EXECUTION_FAILED';
}

export function parseHostDiagnostic(line) {
  if (typeof line !== 'string' || line.length > 240) return null;
  const match = /^ANTIGRAVITY_HOST_DIAGNOSTIC stage=([a-z_]+) reason=([a-z_]+) output_format=([a-z_]+) exit_code=(na|[0-9]{1,3}) attempt=([1-9][0-9]{0,3})$/.exec(line);
  if (!match || !fixed(match[1], HOST_STAGES) || !fixed(match[2], HOST_REASONS)
    || !fixed(match[3], OUTPUT_FORMATS) || (match[4] !== 'na' && Number(match[4]) > 255)) return null;
  return {
    stage: match[1], reason: match[2], outputFormat: match[3],
    exitCode: match[4], attempt: match[5],
  };
}

export function parseAgyErrorDiagnostic(line) {
  if (typeof line !== 'string' || line.length > 240) return null;
  const match = /^AGY_ERROR_DIAGNOSTIC category=([a-z_]+) status=([A-Z_]+) error_code=(na|[0-9]{1,3}) code_kind=(http|grpc|unknown) retryable=(true|false|unknown) attempt=([1-9][0-9]{0,3})$/.exec(line);
  if (!match || !PROVIDER_CATEGORIES.has(match[1]) || !PROVIDER_STATUSES.has(match[2]) ||
      (match[3] !== 'na' && Number(match[3]) > 599)) return null;
  return { category: match[1], status: match[2], errorCode: match[3],
    codeKind: match[4], retryable: match[5], attempt: match[6] };
}

export function parseAuditDiagnostic(line) {
  if (typeof line !== 'string' || line.length > 240) return null;
  const match = /^ROUTING_AUDIT_DIAGNOSTIC code=([A-Z0-9_]+) stage=([A-Z_]+) reason=[A-Z0-9_]+$/.exec(line);
  if (!match) return null;
  return { code: fixed(match[1], AUDIT_CODES) ?? 'UNKNOWN',
    stage: fixed(match[2], AUDIT_STAGES) ?? 'LOAD_INPUTS' };
}

const GUIDANCE = Object.freeze({
  REVIEW_CERTIFICATION_INVALID: '認定証跡の期限・整合性・承認状態を確認してください。期限切れとは限りません。',
  REVIEW_CLI_UNAVAILABLE: '固定CLIの配置・実行権限・バイナリSHA-256を確認してください。',
  ROUTING_ACTIVATION_DENIED: 'ルーティングの権限・取消し・実行時のHead一致を確認してください。',
  RUN_BINDING_MISMATCH: '対象PRのHead SHAとワークフロー実行の識別情報を確認してください。',
  ROUTING_SOURCE_MANIFEST_INVALID: 'ルーティングのSource Manifest整合性を確認してください。',
  ROUTE_SCHEMA_INVALID: '選択ルートのスキーマと許可モデルを確認してください。',
  REVIEW_EXECUTION_FAILED: '下記の失敗段階を確認してください。認証エラーと断定できる情報ではありません。',
  MODEL_REPORTED_FAILURE: 'モデル側の処理失敗や一時的な提供状況を確認してください。',
  INVALID_FALLBACK_MODELS: '選択モデル・Fallbackの許可リストと能力Tierを確認してください。',
  AUDIT_INCOMPLETE: '試行イベントの欠落や監査レコードの保存状態を確認してください。',
  ENOENT: '前のステップの失敗により監査入力が生成されなかった可能性があります。',
});

const STAGE_LABELS = Object.freeze({
  process_exit: 'CLIプロセス異常終了',
  spawn: 'CLI起動',
  timeout: 'CLI実行タイムアウト',
  payload_parse: 'CLI出力の解析',
  schema_validation: 'レビュー結果のスキーマ検証',
  model_result: 'モデルが失敗ステータスを返却',
  host_execution: 'CLI実行',
});

const REASON_LABELS = Object.freeze({
  nonzero_exit: '終了コードが0ではありません',
  terminated_by_signal: 'プロセスがシグナルで終了しました',
  spawn_failed: 'CLIを起動できませんでした',
  timeout: '制限時間内に終了しませんでした',
  empty_stdout: '標準出力が空でした',
  empty_response: 'レビュー内容が空でした',
  json_parse_failed: '有効なJSONを取得できませんでした',
  invalid_envelope: '出力形式が想定と異なります',
  invalid_schema: 'レビュー結果がスキーマに一致しません',
  failed_status: 'モデルが失敗を報告しました',
});

export function publicFailureDiagnosticFromEnv(env = {}) {
  const prepareCode = fixed(env.PREPARE_FAILURE_CODE, PREPARE_CODES);
  if (prepareCode) {
    const stage = fixed(env.PREPARE_FAILURE_STAGE, PREPARE_STAGES) ?? 'OTHER';
    return [
      '**失敗工程:** ルーティング準備',
      `**診断コード:** \`${prepareCode}\`（stage: \`${stage}\`）`,
      `**確認事項:** ${GUIDANCE[prepareCode] ?? 'Actionsログの該当ステップを確認してください。'}`,
    ].join('\n');
  }

  const hostCode = fixed(env.HOST_FAILURE_CODE, HOST_CODES);
  const hostStage = fixed(env.HOST_DIAG_STAGE, HOST_STAGES);
  const hostReason = fixed(env.HOST_DIAG_REASON, HOST_REASONS);
  if (hostCode || hostStage) {
    const code = hostCode ?? 'REVIEW_EXECUTION_FAILED';
    const lines = [
      '**失敗工程:** レビュー実行',
      `**診断コード:** \`${code}\``,
      `**確認事項:** ${GUIDANCE[code] ?? 'Actionsログのレビュー実行ステップを確認してください。'}`,
    ];
    if (hostStage && hostReason) {
      lines.push(`**失敗段階:** ${STAGE_LABELS[hostStage] ?? 'CLI実行'}（${REASON_LABELS[hostReason] ?? '詳細分類なし'}）`);
      const format = fixed(env.HOST_DIAG_FORMAT, OUTPUT_FORMATS);
      if (format) lines.push(`**出力種別:** \`${format}\``);
      const exit = env.HOST_DIAG_EXIT;
      if (typeof exit === 'string' && /^(na|[0-9]{1,3})$/.test(exit) && (exit === 'na' || Number(exit) <= 255)) {
        if (exit !== 'na') lines.push(`**終了コード:** \`${exit}\``);
      }
      const attempt = env.HOST_DIAG_ATTEMPT;
      if (typeof attempt === 'string' && /^[1-9][0-9]{0,3}$/.test(attempt)) {
        lines.push(`**記録された試行:** ${attempt}`);
      }
    }
    const provider = parseAgyErrorDiagnostic(env.HOST_AGY_DIAGNOSTIC);
    if (provider) {
      lines.push(`**agyの提供元エラー:** ${PROVIDER_LABELS[provider.category]}（${provider.status}）`);
      if (provider.errorCode !== 'na') {
        lines.push(`**提供元エラーコード:** ${provider.errorCode}（${provider.codeKind}）`);
      }
      lines.push(`**agyのretryable判定:** ${provider.retryable}（試行 ${provider.attempt}）`);
      if (provider.category === 'rate_limited') {
        lines.push('**対応:** 利用枠の回復を確認してください。retryable=trueでも直ちに回復するとは限りません。');
      }
    }
    return lines.join('\n');
  }

  const auditCode = fixed(env.AUDIT_FAILURE_CODE, AUDIT_CODES);
  if (auditCode) {
    const stage = fixed(env.AUDIT_FAILURE_STAGE, AUDIT_STAGES) ?? 'LOAD_INPUTS';
    return [
      '**失敗工程:** ルーティング監査',
      `**診断コード:** \`${auditCode}\`（stage: \`${stage}\`）`,
      `**確認事項:** ${GUIDANCE[auditCode] ?? 'Actionsログの監査ステップを確認してください。'}`,
    ].join('\n');
  }
  return null;
}
