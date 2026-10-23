import { fetchCurrentRoutingAuthorization } from './routing-authorization.mjs';
import { evaluateRoutingStartup } from './routing-authorization.mjs';
import { readInstalledCliIdentity as defaultReadInstalledCliIdentity } from './load-review-certification.mjs';
import { readRoutingExecutionContext, revalidateRoutingExecutionContext } from './routing-execution-context.mjs';
import { assertSerializedRunBindingMatches } from './ocr-run-binding.mjs';
import { validateRoutingDecisionRecord } from './ocr-routing-audit.mjs';

function denied(code) {
  const error = Object.assign(new Error(code), { code });
  throw error;
}

function failedResult(mode, reason) {
  return mode === 'thread'
    ? { schema_version: '1.0', mode: 'thread', status: 'failed', decision: 'keep', reason: '', message: reason }
    : { schema_version: '1.0', mode: 'review', status: 'failed', coverage: 0, findings: [], message: reason };
}

function skippedResult(mode) {
  return mode === 'thread'
    ? { schema_version: '1.0', mode: 'thread', status: 'skipped', decision: 'keep', reason: '', message: 'REVIEW_SKIPPED_NO_REVIEWABLE_FILES' }
    : { schema_version: '1.0', mode: 'review', status: 'skipped', coverage: 0, findings: [], message: 'REVIEW_SKIPPED_NO_REVIEWABLE_FILES' };
}

export async function runRoutingReview({
  env = process.env,
  context,
  prompt,
  runHost,
  runThreadHost,
  readRoute,
  readDecision,
  readExecutionContext = readRoutingExecutionContext,
  revalidateExecutionContext = revalidateRoutingExecutionContext,
  readInstalledCliIdentity = defaultReadInstalledCliIdentity,
  createRecorder,
  writeResult,
  writeOutput,
  onProgress,
  fetchCurrentAuthorization = fetchCurrentRoutingAuthorization,
  evaluateStartup = evaluateRoutingStartup,
  resolveModels,
  authorityParams,
  trustedInputs,
  repoIdentity,
  expectedBinding,
  now = () => new Date().toISOString(),
  ...hostOptions
}) {
  const mode = env?.DECISION_ROUTING_MODE ?? 'off';
  const host = hostOptions.mode === 'thread' ? runThreadHost : runHost;
  const legacy = { ...hostOptions, env, prompt, onProgress };
  if (mode === 'off') return host(legacy);

  try {
    if (!['shadow', 'enforce'].includes(mode)) denied('ROUTING_EXECUTION_CONTEXT_INVALID');
    const route = await readRoute();
    const authorization = await fetchCurrentAuthorization({ ...authorityParams, now: now() });
    if (!authorization?.registry) denied('ROUTING_ACTIVATION_DENIED');
    const freshInputs = {
      policySha256: trustedInputs?.policySha256,
      catalogSha256: trustedInputs?.catalogSha256,
      sourceManifestSha256: trustedInputs?.sourceManifestSha256,
      index: trustedInputs?.index,
      catalog: trustedInputs?.catalog,
      readEvidence: trustedInputs?.readEvidence,
      readCliIdentity: trustedInputs?.readCliIdentity,
      cliBinarySha256: trustedInputs?.cliBinarySha256,
      registry: authorization.registry,
      operationalDossiers: authorization.operationalDossiers,
    };
    const startupAuthorization = evaluateStartup({
      mode,
      repoIdentity,
      registry: freshInputs.registry,
      operationalDossiers: freshInputs.operationalDossiers,
      policySha256: freshInputs.policySha256,
      catalogSha256: freshInputs.catalogSha256,
      sourceManifestSha256: freshInputs.sourceManifestSha256,
      now: now(),
    });
    if (!startupAuthorization.authorized) denied('ROUTING_ACTIVATION_DENIED');
    if (!route) {
      if (mode !== 'shadow') denied('NO_SELECTED_REVIEW_ROUTE');
      return host({ ...legacy, routingMode: 'shadow' });
    }
    const sealed = await readExecutionContext({ runTemp: env.RUNNER_TEMP, expectedBinding });
    if (!sealed) denied('ROUTING_EXECUTION_CONTEXT_INVALID');
    let decision;
    try {
      decision = await readDecision();
      validateRoutingDecisionRecord(decision);
      assertSerializedRunBindingMatches(expectedBinding, decision);
    } catch (error) {
      if (error?.code === 'RUN_BINDING_INVALID' || error?.code === 'RUN_BINDING_MISMATCH') throw error;
      denied('RUN_BINDING_INVALID');
    }
    let certification = null;
    let cliIdentity = null;
    if (mode === 'enforce' && route.reviewable_file_count > 0) {
      cliIdentity = await readInstalledCliIdentity({ env, targetRoot: env.TARGET_REPO_PATH });
      const checked = await revalidateExecutionContext({ context: sealed, expectedBinding,
        trustedInputs: { ...freshInputs, needsModel: true }, repoIdentity, now: now(),
        cliBinarySha256: cliIdentity.binarySha256 });
      const evidence = checked.certifiedBundle?.evidence;
      const available = new Set(evidence?.cli_available_models ?? []);
      const models = freshInputs.catalog?.models?.filter(model => available.has(model.model_id)) ?? [];
      const resolveEvidence = { verifiedCertificationRefs: evidence?.certification_refs,
        cliAvailableModels: [...available] };
      const resolver = resolveModels ?? (await import('./validate-review-model-catalog.mjs')).resolveCertifiedModels;
      const resolved = resolver({ ...freshInputs.catalog, models }, route.selected_strategy, resolveEvidence);
      if (resolved.primaryModelId !== route.selected_model_id
        || resolved.allowedFallbackModels.join('\0') !== route.fallback_models.join('\0')) denied('ROUTING_ACTIVATION_DENIED');
      certification = { ...freshInputs.catalog, models };
    } else {
      await revalidateExecutionContext({ context: sealed, expectedBinding,
        trustedInputs: { ...freshInputs, needsModel: false }, repoIdentity, now: now(), cliBinarySha256: null });
    }
    let recorder = null;
    if (createRecorder) {
      try {
        recorder = await createRecorder({ context: sealed, writeResult, writeOutput,
          catalog: certification ?? trustedInputs?.catalog, mode });
      } catch (error) {
        if (mode === 'enforce') throw error;
      }
    }
    if (mode === 'enforce' && route.reviewable_file_count === 0) {
      if (recorder) recorder.seal();
      const result = skippedResult(hostOptions.mode);
      if (writeResult) await writeResult(result);
      return result;
    }
    const isThread = hostOptions.mode === 'thread';
    return host({ ...legacy,
      routingMode: mode,
      ...(mode === 'enforce' && route.reviewable_file_count > 0 ? {
        model: route.selected_model_id,
        fallbackModels: [...route.fallback_models],
        modelCatalog: certification,
        executablePath: cliIdentity.resolvedPath,
      } : {}),
      ...(mode === 'enforce' ? { onProgress: undefined } : { onProgress }),
      ...(recorder ? { onAttemptEvent: recorder.onAttemptEvent, runAttemptId: recorder.runAttemptId } : {}),
      ...(isThread ? { onProgress: mode === 'enforce' ? undefined : onProgress } : {}),
    });
  } catch (error) {
    const code = ['ROUTING_ACTIVATION_DENIED', 'ROUTING_EXECUTION_CONTEXT_INVALID', 'NO_SELECTED_REVIEW_ROUTE', 'RUN_BINDING_INVALID', 'RUN_BINDING_MISMATCH'].includes(error?.code)
      ? error.code
      : 'ROUTING_ACTIVATION_DENIED';
    if (writeOutput) await writeOutput('ROUTE_GUARD_FAILED=true');
    return failedResult(hostOptions.mode, code);
  }
}
