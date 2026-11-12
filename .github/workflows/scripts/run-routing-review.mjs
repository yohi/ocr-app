import { fetchCurrentRoutingAuthorization } from './routing-authorization.mjs';
import { evaluateRoutingStartup } from './routing-authorization.mjs';
import { readInstalledCliIdentity as defaultReadInstalledCliIdentity } from './load-review-certification.mjs';
import { resolvePinnedModels, resolveCertifiedModels } from './validate-review-model-catalog.mjs';
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
  const decisionLlmEnabled = env?.DECISION_LLM_ENABLED === 'true';
  const globalOptIn = mode === 'off' && decisionLlmEnabled && hostOptions.mode !== 'thread';
  const appliedRoute = mode === 'enforce' || globalOptIn;
  const host = hostOptions.mode === 'thread' ? runThreadHost : runHost;
  const legacy = { ...hostOptions, env, prompt, onProgress };
  if (mode === 'off' && !globalOptIn) return host(legacy);

  try {
    if (globalOptIn && (expectedBinding?.mode !== 'off' || expectedBinding.decisionLlmEnabled !== true)) denied('RUN_BINDING_MISMATCH');
    if (!globalOptIn && !['shadow', 'enforce'].includes(mode)) denied('ROUTING_EXECUTION_CONTEXT_INVALID');
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
      certificationRepoIdentity: trustedInputs?.certificationRepoIdentity,
    };
    const startupAuthorization = globalOptIn ? { authorized: true, reason: 'GLOBAL_FLAG', approvalRefs: [] }
      : evaluateStartup({
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
    let route;
    let sealed;
    let cliIdentity = null;
    let certification = null;
    const verifyCertifiedRoute = async checked => {
      const evidence = checked.certifiedBundle?.evidence;
      const available = new Set(evidence?.cli_available_models ?? evidence?.cliAvailableModels ?? []);
      const models = freshInputs.catalog?.models?.filter(model => available.has(model.model_id)) ?? [];
      const resolveEvidence = { verifiedCertificationRefs: evidence?.certification_refs ?? evidence?.verifiedCertificationRefs,
        cliAvailableModels: [...available],
        ...(globalOptIn ? { index: freshInputs.index, revokedRefs: freshInputs.registry?.revoked_refs } : {}) };
      const resolver = resolveModels ?? (globalOptIn ? resolvePinnedModels : resolveCertifiedModels);
      const resolved = resolver(globalOptIn ? freshInputs.catalog : { ...freshInputs.catalog, models }, route.selected_strategy, resolveEvidence);
      if (resolved.primaryModelId !== route.selected_model_id
        || resolved.allowedFallbackModels.join('\0') !== route.fallback_models.join('\0')) denied('ROUTING_ACTIVATION_DENIED');
      return { ...freshInputs.catalog, models };
    };
    const authorizeBeforeSpawn = async () => {
      try {
        const current = await fetchCurrentAuthorization({ ...authorityParams, now: now() });
        if (!current?.registry) return false;
        if (globalOptIn) {
          const currentCli = await readInstalledCliIdentity({ env, targetRoot: env.TARGET_REPO_PATH });
          if (!currentCli || typeof currentCli.binarySha256 !== 'string' || !/^[0-9a-f]{64}$/.test(currentCli.binarySha256)
            || currentCli.resolvedPath !== cliIdentity?.resolvedPath || currentCli.binarySha256 !== cliIdentity?.binarySha256) return false;
          const checked = await revalidateExecutionContext({ context: sealed, expectedBinding,
            trustedInputs: { ...freshInputs, registry: current.registry, operationalDossiers: current.operationalDossiers,
              needsModel: route.reviewable_file_count > 0 }, repoIdentity, now: now(), cliBinarySha256: currentCli.binarySha256 });
          if (route.reviewable_file_count > 0) await verifyCertifiedRoute(checked);
          return true;
        }
        return evaluateStartup({
          mode,
          repoIdentity,
          registry: current.registry,
          operationalDossiers: current.operationalDossiers,
          policySha256: freshInputs.policySha256,
          catalogSha256: freshInputs.catalogSha256,
          sourceManifestSha256: freshInputs.sourceManifestSha256,
          now: now(),
        }).authorized === true;
      } catch {
        return false;
      }
    };
    const runAuthorizedHost = async options => {
      const result = await host({ ...options, authorizeBeforeSpawn });
      if (result?.status === 'failed' && ['ROUTING_ACTIVATION_DENIED', 'ROUTING_AUTHORITY_UNAVAILABLE'].includes(result.message)) {
        if (writeOutput) await writeOutput('ROUTE_GUARD_FAILED=true');
      }
      return result;
    };
    if (appliedRoute) {
      cliIdentity = await readInstalledCliIdentity({ env, targetRoot: env.TARGET_REPO_PATH });
      if (!cliIdentity || typeof cliIdentity.binarySha256 !== 'string' || !/^[0-9a-f]{64}$/.test(cliIdentity.binarySha256)
        || typeof cliIdentity.resolvedPath !== 'string' || !cliIdentity.resolvedPath) {
        denied('ROUTING_ACTIVATION_DENIED');
      }
    }
    route = await readRoute();
    if (!route) {
      if (mode !== 'shadow') denied('NO_SELECTED_REVIEW_ROUTE');
      return runAuthorizedHost({ ...legacy, routingMode: 'shadow' });
    }
    sealed = await readExecutionContext({ runTemp: env.RUNNER_TEMP, expectedBinding });
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
    if (appliedRoute && route.reviewable_file_count > 0) {
      const checked = await revalidateExecutionContext({ context: sealed, expectedBinding,
        trustedInputs: { ...freshInputs, needsModel: true }, repoIdentity, now: now(),
        cliBinarySha256: cliIdentity.binarySha256 });
      certification = await verifyCertifiedRoute(checked);
    } else {
      await revalidateExecutionContext({ context: sealed, expectedBinding,
        trustedInputs: { ...freshInputs, needsModel: false }, repoIdentity, now: now(), cliBinarySha256: null });
    }
    let recorder = null;
    if (createRecorder) {
      try {
        recorder = await createRecorder({ context: sealed, writeResult, writeOutput,
          catalog: certification ?? trustedInputs?.catalog, mode, decisionLlmEnabled });
      } catch (error) {
        if (appliedRoute) throw error;
      }
    }
    if (appliedRoute && route.reviewable_file_count === 0) {
      if (recorder) recorder.seal();
      const result = skippedResult(hostOptions.mode);
      if (writeResult) await writeResult(result);
      return result;
    }
    const isThread = hostOptions.mode === 'thread';
    return runAuthorizedHost({ ...legacy,
      routingMode: mode,
      decisionLlmEnabled,
      ...(appliedRoute && route.reviewable_file_count > 0 ? {
        model: route.selected_model_id,
        fallbackModels: [...route.fallback_models],
        modelCatalog: certification,
        executablePath: cliIdentity.resolvedPath,
        executableIdentity: cliIdentity,
        targetRoot: env.TARGET_REPO_PATH,
        readCliIdentity: readInstalledCliIdentity,
      } : {}),
      ...(appliedRoute ? { onProgress: undefined } : { onProgress }),
      ...(recorder ? { onAttemptEvent: recorder.onAttemptEvent, runAttemptId: recorder.runAttemptId } : {}),
      ...(isThread ? { onProgress: appliedRoute ? undefined : onProgress } : {}),
    });
  } catch (error) {
    const code = ['ROUTING_ACTIVATION_DENIED', 'ROUTING_EXECUTION_CONTEXT_INVALID', 'NO_SELECTED_REVIEW_ROUTE', 'RUN_BINDING_INVALID', 'RUN_BINDING_MISMATCH'].includes(error?.code)
      ? error.code
      : 'ROUTING_ACTIVATION_DENIED';
    if (writeOutput) await writeOutput('ROUTE_GUARD_FAILED=true');
    return failedResult(hostOptions.mode, code);
  }
}
