import fs from 'node:fs';

function failureDetails(result) {
  if (typeof result?.message !== 'string' || result.message.length === 0) return '';
  const runs = result.message.match(/`+/g) || [];
  const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
  return `\n\nFailure details:\n${fence}\n${result.message}\n${fence}`;
}

export function buildCheckRunUpdate({ conclusion, targetRepo, prNumber, reviewUrl, detailsUrl, result }) {
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
  const summary = [
    isFailure
      ? `レビューを完了できませんでした。[PRの失敗コメントを確認](<${resultUrl}>).`
      : isSkipped
        ? `レビューはスキップされました。[PRを確認](<${pullRequestUrl}>).`
        : `レビューが完了しました。[レビュー概要とコメントを確認](<${resultUrl}>).`,
    `[この実行のログを確認](<${detailsUrl}>)`,
    failureDetails(result),
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
    console.error(error.message);
    process.exitCode = 1;
  });
}
