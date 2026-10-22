import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fetchCurrentRoutingAuthorization } from './routing-authorization.mjs';
import { readRoutingExecutionContext, revalidateRoutingExecutionContext } from './routing-execution-context.mjs';
import { evaluatePublishEligibility } from './evaluate-routing-publish.mjs';
import { fetchCurrentHead } from './check-pr-head.mjs';
import { run as postOcrComments } from './post-ocr-comments.mjs';
import { readInstalledCliIdentity } from './load-review-certification.mjs';

async function writeSummary({ path, content }) {
  await fs.promises.mkdir(dirname(path), { recursive: true });
  await fs.promises.writeFile(path, content);
}

export async function publishRoutingReview({
  env,
  runBinding,
  runTemp,
  selectedRoute,
  attemptRecord,
  finalAudit,
  delivery,
  checkRunId,
  revalidateExecutionContext = revalidateRoutingExecutionContext,
  evaluateGate = evaluatePublishEligibility,
  checkHead = fetchCurrentHead,
  postReview = postOcrComments,
  writeOutput = writeSummary,
  readExecutionContext = readRoutingExecutionContext,
  fetchAuthorization = fetchCurrentRoutingAuthorization,
  readCliIdentity = readInstalledCliIdentity,
  now = () => new Date().toISOString(),
  trustedInputs = env?.trustedInputs ?? {},
}) {
  let published = false;
  let reason = 'PUBLISH_DENIED';

  try {
    const sealed = await readExecutionContext({ runTemp, expectedBinding: runBinding });
    const decisionRecord = JSON.parse(fs.readFileSync(join(runTemp, 'ocr-routing', 'decision.json'), 'utf8'));
    const timestamp = now();
    const current = await fetchAuthorization({
      centralRepoId: trustedInputs.centralRepoId ?? Number(env.CENTRAL_REPO_ID),
      centralRepoFullName: trustedInputs.centralRepoFullName ?? env.CENTRAL_REPO_FULL_NAME,
      protectedRef: trustedInputs.protectedRef ?? 'master',
      token: env.CENTRAL_GITHUB_TOKEN || env.GITHUB_TOKEN,
      fetchImpl: trustedInputs.fetchImpl ?? fetch,
      now: timestamp,
    });
      if (!current?.registry) throw Object.assign(new Error('ROUTING_AUTHORITY_UNAVAILABLE'), { code: 'ROUTING_AUTHORITY_UNAVAILABLE' });

    const needsModel = runBinding.mode === 'enforce' && selectedRoute.reviewable_file_count > 0;
    const freshTrustedInputs = {
      ...trustedInputs,
      registry: current.registry,
      operationalDossiers: current.operationalDossiers,
      needsModel,
    };
    let cliBinarySha256 = null;
    if (needsModel) {
      const cliIdentity = await readCliIdentity({ env, targetRoot: env.TARGET_REPO_PATH });
      if (!cliIdentity?.binarySha256 || cliIdentity.binarySha256 !== sealed.cli_binary_sha256) {
        throw Object.assign(new Error('ROUTING_EXECUTION_CONTEXT_INVALID'), { code: 'ROUTING_EXECUTION_CONTEXT_INVALID' });
      }
      cliBinarySha256 = cliIdentity.binarySha256;
    }
    const revalidated = await revalidateExecutionContext({
      context: sealed,
      expectedBinding: runBinding,
      trustedInputs: freshTrustedInputs,
      repoIdentity: trustedInputs.repoIdentity ?? { repo_id: finalAudit.repo_id, full_name: finalAudit.repo },
      now: timestamp,
      cliBinarySha256,
    });
    const gateResult = await evaluateGate({
      mode: runBinding.mode,
      expectedBinding: runBinding,
      decisionRecord,
      finalAudit,
      delivery,
      checkRunId,
      startupAuthorization: revalidated.startupAuthorization,
      headSha: runBinding.headSha,
      selectedRoute,
      attempts: attemptRecord,
      certifiedBundle: revalidated.certifiedBundle,
    });
    if (!gateResult?.authorized) {
      reason = gateResult?.reason ?? 'PUBLISH_DENIED';
    } else {
      let currentHead;
      try {
        currentHead = await checkHead({
          token: env.GITHUB_TOKEN,
          targetRepo: env.TARGET_REPO,
          prNumber: env.PR_NUMBER,
          expectedSha: runBinding.headSha,
        });
      } catch {
        reason = 'HEAD_MISMATCH';
      }
      if (currentHead !== runBinding.headSha) {
        reason = 'HEAD_MISMATCH';
      } else {
        const resultPath = env.OCR_RESULT_PATH ?? '/tmp/ocr-result.json';
        let postResult;
        try {
          postResult = await postReview({
            env,
          args: ['--repo', env.TARGET_REPO, '--pr', String(env.PR_NUMBER), '--result', resultPath],
          token: env.GITHUB_TOKEN,
          botLogin: env.GH_APP_SLUG,
          expectedSha: runBinding.headSha,
          outputPath: env.GITHUB_OUTPUT,
        });
        } catch {
          reason = 'PUBLISH_FAILED';
        }
        if (postResult === 0) {
          published = true;
          reason = 'PUBLISHED';
        } else if (reason !== 'PUBLISH_FAILED') {
          reason = 'PUBLISH_FAILED';
        }
      }
    }
  } catch (error) {
    const knownDenials = new Set([
      'ROUTING_AUTHORITY_UNAVAILABLE',
      'ROUTING_EXECUTION_CONTEXT_INVALID',
      'ROUTING_ACTIVATION_DENIED',
      'ROUTE_ATTEMPT_MISMATCH',
    ]);
    const failureReason = error?.code ?? error?.reason ?? error?.message;
    reason = knownDenials.has(failureReason) ? failureReason : 'PUBLISH_DENIED';
  }

  try {
    await writeOutput({
      path: join(runTemp, 'ocr-routing-publish.txt'),
      content: `PUBLISHED=${published}\n`,
    });
  } catch (error) {
    // The return value remains authoritative if this optional summary cannot be written.
    void error;
  }

  return { published, reason };
}
