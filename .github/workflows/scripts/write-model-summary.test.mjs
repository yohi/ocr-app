import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DECISION_MODEL_ID } from './decision-provider.mjs';
import { formatModelSummary, renderModelSummary } from './write-model-summary.mjs';

test('summary labels decision configuration and the configured reviewer separately', () => {
  const summary = formatModelSummary({
    mode: 'off', enabled: 'true', configuredReviewModel: 'gemini-3.8-flash-medium',
    decision: { decision_status: 'succeeded', egress_status: 'allowed' },
    selectedRoute: { selected_model_id: 'claude-opus-5-5-high', route_source: 'model_decision' },
  });
  assert.match(summary, /判断特化LLM \| 有効/);
  assert.ok(summary.includes(DECISION_MODEL_ID));
  assert.match(summary, /判断結果 \| `succeeded`/);
  assert.match(summary, /判断API送信状態 \| `allowed`/);
  assert.match(summary, /レビュー既定モデル（設定） \| `gemini-3\.8-flash-medium`/);
  assert.match(summary, /レビュー選択モデル（実行証明ではない） \| `claude-opus-5-5-high`/);
  assert.match(summary, /レビュー実行モデル（監査記録） \| 未確定（有効な監査記録なし）/);
});

test('summary reports executed model from audit rather than confusing it with the selected model', () => {
  const summary = formatModelSummary({
    mode: 'enforce', enabled: 'true', configuredReviewModel: 'gemini-3.8-flash-medium',
    decision: { decision_status: 'unavailable', egress_status: 'allowed' },
    selectedRoute: { selected_model_id: 'claude-opus-5-5-high', route_source: 'deterministic_fallback' },
    audit: { executed_review_model: 'claude-sonnet-5-5-high',
      attempted_review_models: ['claude-opus-5-5-high', 'claude-sonnet-5-5-high'] },
  });
  assert.match(summary, /レビュー選択モデル（実行証明ではない） \| `claude-opus-5-5-high`/);
  assert.match(summary, /レビュー実行モデル（監査記録） \| `claude-sonnet-5-5-high`/);
  assert.match(summary, /レビュー試行モデル（監査記録） \| `claude-opus-5-5-high`, `claude-sonnet-5-5-high`/);
  assert.match(summary, /モデル選択元 \| `deterministic_fallback`/);
});

test('disabled decision LLM and missing audit never claim model execution', () => {
  const summary = formatModelSummary({
    mode: 'off', enabled: 'false', configuredReviewModel: 'gemini-3.8-flash-medium',
  });
  assert.match(summary, /判断特化LLM \| 無効/);
  assert.match(summary, /判断結果 \| 未要求（無効）/);
  assert.match(summary, /レビュー実行モデル（監査記録） \| 未確定/);
  assert.match(summary, /レビュー試行モデル（監査記録） \| 未確認/);
});

test('untrusted model IDs cannot inject markdown into the GitHub Summary', () => {
  const secret = 'SECRET_SENTINEL';
  const summary = formatModelSummary({
    mode: 'not-a-mode', enabled: 'bad-value',
    configuredReviewModel: 'test\n| ' + secret + ' |',
    selectedRoute: { selected_model_id: 'bad' + String.fromCharCode(96) + secret, route_source: 'bad\n' + secret },
    audit: { executed_review_model: 'bad\n' + secret, attempted_review_models: ['bad\n' + secret] },
  });
  assert.doesNotMatch(summary, /SECRET_SENTINEL/);
  assert.match(summary, /ルーティングモード \| 未確認/);
  assert.match(summary, /レビュー実行モデル（監査記録） \| 未確認/);
});

test('summary refuses malformed or unbound runtime records without throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ocr-model-summary-'));
  try {
    mkdirSync(join(dir, 'ocr-routing'));
    writeFileSync(join(dir, 'ocr-routing', 'final.json'), JSON.stringify({
      workflow_run_id: '123', executed_review_model: 'fake-model',
    }));
    writeFileSync(join(dir, 'ocr-routing', 'decision.json'), 'not-json');
    const summary = renderModelSummary({ env: {
      GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', COMMIT_SHA: 'a'.repeat(40),
      DECISION_ROUTING_MODE: 'off', DECISION_LLM_ENABLED: 'true', RUNNER_TEMP: dir,
      OCR_LLM_MODEL: 'gemini-3.8-flash-medium',
    } });
    assert.match(summary, /レビュー実行モデル（監査記録） \| 未確定/);
    assert.match(summary, /判断結果 \| 未確認/);
    assert.doesNotMatch(summary, /fake-model/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('decision model display stays aligned with the provider request configuration', () => {
  const provider = fs.readFileSync(new URL('./decision-provider.mjs', import.meta.url), 'utf8');
  assert.match(provider, /model: DECISION_MODEL_ID/);
  assert.equal(DECISION_MODEL_ID, 'inception/mercury-decide:free');
});
