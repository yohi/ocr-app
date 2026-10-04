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
});
