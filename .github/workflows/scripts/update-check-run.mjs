import fs from 'node:fs';

const ROUTING_FAILURE_REASONS = new Set([
  'REVIEW_EXECUTION_FAILED', 'HOST_TIMEOUT', 'INVALID_REVIEW_OUTPUT', 'ROUTING_AUDIT_MISSING',
  'ARTIFACT_UPLOAD_FAILED', 'MISSING_ARTIFACT_ID', 'AUDIT_INCOMPLETE', 'AUDIT_NOT_SEALED',
  'REVIEW_VALIDATION_FAILED', 'HEAD_VALIDATION_FAILED', 'HEAD_MISMATCH', 'HEAD_CHANGED',
  'REVIEW_SCOPE_GAP_BLOCKED', 'MODEL_NOT_CERTIFIED', 'EGRESS_NOT_APPROVED',
  'CHECK_RUN_MISSING', 'PUBLISH_FAILED', 'RUN_BINDING_INVALID', 'RUN_BINDING_MISMATCH',
  'ROUTING_ACTIVATION_DENIED', 'ROUTE_ATTEMPT_MISMATCH', 'ROUTING_AUTHORITY_UNAVAILABLE',
  'ROUTING_EXECUTION_CONTEXT_INVALID', 'PUBLISH_DENIED',
]);

function publicFailureReason(reason) {
  if (reason === 'ARTIFACT_UPLOAD_FAILED' || reason === 'MISSING_ARTIFACT_ID') return 'ROUTING_AUDIT_MISSING';
  if (reason === 'HEAD_MISMATCH') return 'HEAD_CHANGED';
  return ROUTING_FAILURE_REASONS.has(reason) ? reason : 'REVIEW_EXECUTION_FAILED';
}

function finalRoutingFailureReason(env) {
  // A failed gate forbids publication. Later skipped steps cannot replace its reason.
  if (env.ROUTING_FAILURE_REASON) return env.ROUTING_FAILURE_REASON;
  if (env.PUBLISH_HEAD_OUTCOME === 'failure') return env.PUBLISH_HEAD_REASON || 'HEAD_VALIDATION_FAILED';
  if (env.PUBLISH_FAILURE_REASON) return env.PUBLISH_FAILURE_REASON;
  // The publisher may fail before it can emit an output (file/API/JSON errors).
  if (env.PUBLISH_OUTCOME === 'failure') return 'PUBLISH_FAILED';
  return 'REVIEW_EXECUTION_FAILED';
}

function failureDetails(result) {
  if (typeof result?.message !== 'string' || result.message.length === 0) return '';
  const runs = result.message.match(/`+/g) || [];
  const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
  return `\n\nFailure details:\n${fence}\n${result.message}\n${fence}`;
}

export function buildCheckRunUpdate({ conclusion, targetRepo, prNumber, reviewUrl, detailsUrl, result, enforce = false, routingFailureReason = null }) {
  const pullRequestUrl = `https://github.com/${targetRepo}/pull/${prNumber}`;
  const resultUrl = reviewUrl || pullRequestUrl;
  const isFailure = conclusion === 'failure' || result?.status === 'failed';
  const isSkipped = result?.status === 'skipped';
  const title = isFailure
    ? 'OpenCodeReview failed'
    : isSkipped
      ? 'OpenCodeReview skipped'
      : 'OpenCodeReview completed';
  const status = isFailure ? 'failure' : isSkipped ? 'neutral' : 'success';
  const safeReason = publicFailureReason(routingFailureReason);
  const summary = [
    enforce && isFailure
      ? `レビューを完了できませんでした。理由: ${safeReason}.`
      : isFailure
      ? `レビューを完了できませんでした。[PRの失敗コメントを確認](<${resultUrl}>).`
      : isSkipped
        ? `レビューはスキップされました。[PRを確認](<${pullRequestUrl}>).`
        : `レビューが完了しました。[レビュー概要とコメントを確認](<${resultUrl}>).`,
    `[この実行のログを確認](<${detailsUrl}>)`,
    enforce ? '' : failureDetails(result),
  ].filter(Boolean).join('\n\n');

  return {
    status: 'completed',
    conclusion: status,
    details_url: detailsUrl,
    output: { title, summary },
  };
}

export async function updateCheckRun({ env = process.env, fetchImpl = fetch } = {}) {
  const result = fs.existsSync(env.RESULT_PATH)
    ? JSON.parse(fs.readFileSync(env.RESULT_PATH, 'utf8'))
    : null;
  const body = buildCheckRunUpdate({
    conclusion: env.CONCLUSION,
    targetRepo: env.TARGET_REPO,
    prNumber: env.PR_NUMBER,
    reviewUrl: env.REVIEW_URL,
    detailsUrl: env.DETAILS_URL,
    result,
    enforce: env.DECISION_ROUTING_MODE === 'enforce',
    routingFailureReason: finalRoutingFailureReason(env),
  });
  const response = await fetchImpl(
    `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.TARGET_REPO}/check-runs/${env.CHECK_RUN_ID}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw new Error(`Check Run update failed (HTTP ${response.status})`);
  return body;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  updateCheckRun().catch((error) => {
    console.error(process.env.DECISION_ROUTING_MODE === 'enforce' ? 'Check Run update failed' : error.message);
    process.exitCode = 1;
  });
}
