import fs from 'node:fs';
import { join } from 'node:path';
import { DECISION_MODEL_ID } from './decision-provider.mjs';
import { createRunBindingFromEnv, assertSerializedRunBindingMatches } from './ocr-run-binding.mjs';
import { readSelectedReviewRoute } from './prepare-review-routing.mjs';
import { validateRoutingDecisionRecord, validateRoutingAudit } from './ocr-routing-audit.mjs';

const MAX_BYTES = 64 * 1024;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/;
const MODES = new Set(['off', 'shadow', 'enforce']);
const DECISION_STATUSES = new Set(['succeeded', 'unavailable', 'not_requested', 'invalid_response']);
const EGRESS_STATUSES = new Set(['allowed', 'denied', 'not_checked']);
const ROUTE_SOURCES = new Set(['model_decision', 'deterministic_fallback', 'not_requested']);
const UNKNOWN = '未確認';
const BACKTICK = String.fromCharCode(96);
const model = value => typeof value === 'string' && MODEL_ID.test(value) ? BACKTICK + value + BACKTICK : UNKNOWN;
const enumValue = (value, allowed) => allowed.has(value) ? BACKTICK + value + BACKTICK : UNKNOWN;

function readValidatedRecord(runTemp, filename, binding, validate) {
  try {
    if (typeof runTemp !== 'string' || !runTemp || !binding) return null;
    const path = join(runTemp, 'ocr-routing', filename);
    const stat = fs.lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) return null;
    const record = JSON.parse(fs.readFileSync(path, 'utf8'));
    validate(record);
    assertSerializedRunBindingMatches(binding, record);
    return record;
  } catch {
    return null;
  }
}

export function formatModelSummary({ mode, enabled, configuredReviewModel, decision = null, selectedRoute = null, audit = null } = {}) {
  const decisionEnabled = enabled === 'true';
  const decisionSetting = enabled === 'true' ? '有効' : enabled === 'false' ? '無効' : UNKNOWN;
  const chosen = selectedRoute?.selected_model_id ?? audit?.selected_review_model ?? null;
  const actual = audit?.executed_review_model ?? null;
  const attempts = audit === null ? UNKNOWN : audit.attempted_review_models?.length
    ? audit.attempted_review_models.map(model).join(', ') : 'なし';
  const status = decision ? enumValue(decision.decision_status, DECISION_STATUSES)
    : enabled === 'false' ? '未要求（無効）' : UNKNOWN;
  const egress = decision ? enumValue(decision.egress_status, EGRESS_STATUSES)
    : enabled === 'false' ? '未要求（無効）' : UNKNOWN;
  const routeSource = selectedRoute ? enumValue(selectedRoute.route_source, ROUTE_SOURCES) : UNKNOWN;
  const rows = [
    ['判断特化LLM', decisionSetting],
    ['判断特化LLMモデル（設定）', model(DECISION_MODEL_ID)],
    ['判断特化LLM経路', 'OpenRouter Decisions API'],
    ['判断結果', status],
    ['判断API送信状態', egress],
    ['ルーティングモード', enumValue(mode, MODES)],
    ['レビュー既定モデル（設定）', model(configuredReviewModel)],
    ['レビュー選択モデル（実行証明ではない）', model(chosen)],
    ['モデル選択元', routeSource],
    ['レビュー実行モデル（監査記録）', actual ? model(actual) : '未確定（有効な監査記録なし）'],
    ['レビュー試行モデル（監査記録）', attempts],
  ];
  // A configured model is not evidence that a call occurred or succeeded.
  const note = decisionEnabled
    ? '※ 判断特化LLMの有効設定はAPI呼び出し成功を意味しません。実行モデルは当該Runに一致する有効な監査レコードがある場合のみ表示します。'
    : '※ 判断特化LLMモデルは設定値です。無効時には呼び出しを意味しません。監査未確定のモデルは実行済みと扱いません。';
  return [
    '## OpenCodeReview — LLM Summary',
    '',
    '| 項目 | 値 |',
    '| --- | --- |',
    ...rows.map(([label, value]) => '| ' + label + ' | ' + value + ' |'),
    '',
    note,
    '',
  ].join('\n');
}

export function renderModelSummary({ env = process.env } = {}) {
  let binding = null;
  try { binding = createRunBindingFromEnv(env); } catch { /* No trusted run binding: show configuration only. */ }
  const runTemp = env.RUNNER_TEMP;
  const decision = readValidatedRecord(runTemp, 'decision.json', binding, validateRoutingDecisionRecord);
  const audit = readValidatedRecord(runTemp, 'final.json', binding, validateRoutingAudit);
  let selectedRoute = null;
  try {
    if (binding && typeof runTemp === 'string' && runTemp) {
      selectedRoute = readSelectedReviewRoute({ runBinding: binding, runTemp });
    }
  } catch { /* A missing or invalid route must never be presented as selected. */ }
  return formatModelSummary({
    mode: env.DECISION_ROUTING_MODE,
    enabled: env.DECISION_LLM_ENABLED,
    configuredReviewModel: env.OCR_LLM_MODEL || 'gemini-3.8-flash-medium',
    decision, selectedRoute, audit,
  });
}

if (import.meta.url === 'file://' + process.argv[1]) {
  try {
    const outputPath = process.env.GITHUB_STEP_SUMMARY;
    if (typeof outputPath !== 'string' || !outputPath) throw new Error('missing summary path');
    fs.appendFileSync(outputPath, renderModelSummary(), 'utf8');
  } catch {
    console.error('MODEL_SUMMARY_UNAVAILABLE');
    process.exitCode = 1;
  }
}
