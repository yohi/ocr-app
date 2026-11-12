import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCheckRunUpdate } from './update-check-run.mjs';

describe('buildCheckRunUpdate', () => {
  it('links successful review results to the PR and workflow run', () => {
    const update = buildCheckRunUpdate({
      conclusion: 'success',
      targetRepo: 'owner/repo',
      prNumber: '42',
      reviewUrl: 'https://github.com/owner/repo/pull/42#issuecomment-456',
      detailsUrl: 'https://github.com/yohi/ocr-app/actions/runs/123',
      result: { status: 'success', findings: [] },
    });

    assert.equal(update.conclusion, 'success');
    assert.equal(update.details_url, 'https://github.com/yohi/ocr-app/actions/runs/123');
    assert.match(update.output.summary, /https:\/\/github.com\/owner\/repo\/pull\/42/);
    assert.match(update.output.summary, /https:\/\/github.com\/owner\/repo\/pull\/42#issuecomment-456/);
    assert.match(update.output.summary, /https:\/\/github.com\/yohi\/ocr-app\/actions\/runs\/123/);
  });

  it('includes the review failure reason in the check run output', () => {
    const update = buildCheckRunUpdate({
      conclusion: 'failure',
      targetRepo: 'owner/repo',
      prNumber: '42',
      detailsUrl: 'https://github.com/yohi/ocr-app/actions/runs/123',
      result: { status: 'failed', message: 'LLM request timed out' },
    });

    assert.equal(update.output.title, 'OpenCodeReview failed');
    assert.match(update.output.summary, /LLM request timed out/);
    assert.match(update.output.summary, /owner\/repo\/pull\/42/);
  });

  it('marks skipped review results as neutral', () => {
    const update = buildCheckRunUpdate({
      conclusion: 'success',
      targetRepo: 'owner/repo',
      prNumber: '42',
      detailsUrl: 'https://github.com/yohi/ocr-app/actions/runs/123',
      result: { status: 'skipped' },
    });

    assert.equal(update.conclusion, 'neutral');
    assert.equal(update.output.title, 'OpenCodeReview skipped');
  });

  it('never includes arbitrary review errors in enforce output', () => {
    const update = buildCheckRunUpdate({
      conclusion: 'failure', targetRepo: 'owner/repo', prNumber: '42',
      detailsUrl: 'https://github.com/yohi/ocr-app/actions/runs/123',
      result: { status: 'failed', message: 'PR secret Bearer hidden' }, enforce: true,
      routingFailureReason: 'ARTIFACT_UPLOAD_FAILED',
    });
    assert.doesNotMatch(update.output.summary, /PR secret|Bearer hidden/);
    assert.match(update.output.summary, /ROUTING_AUDIT_MISSING/);
    assert.match(update.output.summary, /actions\/runs\/123/);
  });

  it('maps unknown enforce reasons to a fixed general reason', () => {
    const update = buildCheckRunUpdate({
      conclusion: 'failure', targetRepo: 'owner/repo', prNumber: '42',
      detailsUrl: 'https://github.com/yohi/ocr-app/actions/runs/123', result: null,
      enforce: true, routingFailureReason: 'injected\nsecret',
    });
    assert.match(update.output.summary, /REVIEW_EXECUTION_FAILED/);
    assert.doesNotMatch(update.output.summary, /injected|secret/);
  });

  for (const reason of ['ROUTING_ACTIVATION_DENIED', 'ROUTE_ATTEMPT_MISMATCH', 'ROUTING_AUTHORITY_UNAVAILABLE']) {
    it(`preserves the trusted ${reason} denial`, () => {
      const update = buildCheckRunUpdate({ conclusion: 'failure', enforce: true,
        targetRepo: 'owner/repo', prNumber: '42', detailsUrl: 'https://github.com/central/repo/actions/runs/123',
        routingFailureReason: reason });
      assert.match(update.output.summary, new RegExp(`理由: ${reason}\\.`));
    });
  }
});

describe('safe diagnostics surfaced in PR Checks', () => {
  it('shows the real preparation error even when later audit fails with ENOENT', () => {
    const detail = [
      '**失敗工程:** ルーティング準備',
      '**診断コード:** `REVIEW_CERTIFICATION_INVALID`',
    ].join('\n');
    const update = buildCheckRunUpdate({
      conclusion: 'failure', targetRepo: 'owner/repo', prNumber: '42',
      detailsUrl: 'https://github.com/yohi/ocr-app/actions/runs/123',
      result: null, failureDiagnostic: detail, suppressUnsafeDetails: true,
    });
    assert.equal(update.conclusion, 'failure');
    assert.match(update.output.summary, /失敗工程:.*ルーティング準備/);
    assert.match(update.output.summary, /REVIEW_CERTIFICATION_INVALID/);
    assert.doesNotMatch(update.output.summary, /ENOENT/);
  });

  it('keeps model errors and secrets out of the Check Run summary for opt-in routing', () => {
    const secret = 'ghp_DO_NOT_PUBLISH';
    const update = buildCheckRunUpdate({
      conclusion: 'failure', targetRepo: 'owner/repo', prNumber: '42',
      detailsUrl: 'https://github.com/yohi/ocr-app/actions/runs/123',
      result: { status: 'failed', message: `OAuth token: ${secret}` },
      failureDiagnostic: '**失敗段階:** CLI出力の解析（有効なJSONを取得できませんでした）',
      suppressUnsafeDetails: true,
    });
    assert.match(update.output.summary, /有効なJSONを取得できません/);
    assert.doesNotMatch(update.output.summary, /OAuth token|ghp_DO_NOT_PUBLISH/);
  });
});

test('successful lower-tier final fallback is visibly marked as degraded', () => {
  const update = buildCheckRunUpdate({
    conclusion: 'success', targetRepo: 'owner/repo', prNumber: '42',
    detailsUrl: 'https://github.com/yohi/ocr-app/actions/runs/123',
    result: { status: 'success', findings: [] },
    terminalFallbackDegraded: true,
  });
  assert.equal(update.conclusion, 'success');
  assert.match(update.output.summary, /Deep品質の達成は未確認/);
  assert.match(update.output.summary, /review_quality_measured=false/);
});
