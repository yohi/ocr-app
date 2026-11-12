const KEYS = ['schema_version', 'run_attempt_id', 'attempt_index', 'event', 'model', 'result', 'timestamp', 'duration_ms', 'host_status'];
const RESULTS = ['spawn_failed', 'timeout', 'transport_error', 'invalid_output', 'model_reported_failure', 'host_validated_success', 'host_skipped', 'other_failure'];
const RANK = { fast: 0, deep: 1 };
const invalid = () => { throw new Error('AUDIT_EVENT_INVALID'); };

export function validateAttemptEvent(event, runAttemptId, catalog, requireCertified = false) {
  if (!event || Object.getPrototypeOf(event) !== Object.prototype || Reflect.ownKeys(event).length !== KEYS.length
    || KEYS.some(key => !Object.hasOwn(event, key) || event[key] === undefined)
    || event.schema_version !== '1' || event.run_attempt_id !== runAttemptId
    || typeof runAttemptId !== 'string' || !/^[a-f0-9]{32}$/.test(runAttemptId)
    || !['attempt_started', 'attempt_completed', 'host_completed'].includes(event.event)) invalid();
  if (typeof event.timestamp !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(event.timestamp)
    || !Number.isFinite(Date.parse(event.timestamp)) || new Date(event.timestamp).toISOString() !== event.timestamp) invalid();
  if (event.duration_ms !== null && (!Number.isSafeInteger(event.duration_ms) || event.duration_ms < 0)) invalid();
  if (event.event === 'host_completed') {
    if (event.attempt_index !== null || event.model !== null || event.result !== null
      || !['success', 'skipped', 'failed'].includes(event.host_status)) invalid();
  } else {
    if (!Number.isSafeInteger(event.attempt_index) || event.attempt_index < 1 || event.host_status !== null) invalid();
    if (typeof event.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/.test(event.model)
      || (catalog && !catalog.models?.some(model => model.model_id === event.model
        && (!requireCertified || model.certification_status === 'certified')))) throw new Error('AUDIT_MODEL_NOT_CERTIFIED');
    if (event.event === 'attempt_started' ? event.result !== null || event.duration_ms !== null : !RESULTS.includes(event.result)) invalid();
  }
  return event;
}

export function validateAttemptOrder(attempts, _binding, allowEmpty) {
  if (!Array.isArray(attempts)) invalid();
  if (attempts.length === 0) {
    if (!allowEmpty) invalid();
    return { valid: true, completed: [], success: null };
  }
  const completed = [];
  let active = null;
  let priorIndex = 0;
  let terminal = false;
  let success = null;
  const id = attempts[0]?.run_attempt_id;
  try {
    for (const event of attempts) {
      validateAttemptEvent(event, id);
      if (terminal || success) invalid();
      if (event.event === 'attempt_started') {
        if (active || event.attempt_index !== priorIndex + 1
          || completed.some(item => item.result === 'host_validated_success')) invalid();
        priorIndex = event.attempt_index;
        active = event;
      } else if (event.event === 'attempt_completed') {
        if (!active || active.attempt_index !== event.attempt_index || active.model !== event.model) invalid();
        completed.push(event);
        active = null;
      } else {
        if (active || (completed.length === 0 && event.host_status !== 'failed')) invalid();
        terminal = true;
        const successes = completed.filter(item => item.result === 'host_validated_success');
        if (successes.length > 1 || (event.host_status === 'success' && successes.length !== 1)) invalid();
        success = event.host_status === 'success' ? successes[0] : null;
      }
    }
    if (!terminal || active) invalid();
    return { valid: true, completed, success };
  } catch (cause) { throw Object.assign(new Error('AUDIT_EVENT_INVALID', { cause }), { reason: 'attempt_chain_invalid' }); }
}

export function validateRoutingAttempts({ attempts, selectedRoute, certifiedBundle }) {
  const order = validateAttemptOrder(attempts, null, false);
  if (!selectedRoute || typeof selectedRoute.selected_model_id !== 'string' || !Array.isArray(selectedRoute.fallback_models)) invalid();
  const allowed = [selectedRoute.selected_model_id, ...selectedRoute.fallback_models];
  if (new Set(allowed).size !== allowed.length) invalid();
  const advisory = selectedRoute.effective_mode === 'off' && selectedRoute.decision_llm_enabled === true;
  const terminal = advisory ? certifiedBundle?.catalog?.strategies?.fast?.preferred_model_id : null;
  const attemptedModels = order.completed.map(event => event.model);
  let prior = 0;
  let inTerminal = false;
  const available = certifiedBundle?.evidence?.cli_available_models;
  for (const model of attemptedModels) {
    const index = allowed.indexOf(model);
    // The final default is permitted only after the normal fallback chain,
    // only in off+Decision mode, and never as a model not pinned in the catalog.
    if (!inTerminal && index < prior && advisory && model === terminal && prior === allowed.length - 1) inTerminal = true;
    if (!inTerminal && index === -1 && advisory && model === terminal && prior === allowed.length - 1) inTerminal = true;
    if (inTerminal ? model !== terminal : index < prior) invalid();
    if (!inTerminal) prior = index;
    if (certifiedBundle && (!Array.isArray(available) || !available.includes(model))) invalid();
    const entry = certifiedBundle?.catalog?.models?.find(item => item.model_id === model);
    const required = selectedRoute.selected_strategy ?? selectedRoute.proposed_strategy;
    if ((!entry && certifiedBundle) ||
        (inTerminal && (!entry || entry.certification_status !== 'certified')) ||
        (!inTerminal && entry?.capability_tier && required && RANK[entry.capability_tier] < RANK[required])) invalid();
    if (inTerminal) {
      const evidence = certifiedBundle?.evidence;
      const matches = evidence?.index?.certifications?.filter(ref => `sha256:${ref.sha256}` === entry.certification_reference) ?? [];
      if (matches.length !== 1 || !Array.isArray(evidence?.revokedRefs)
        || evidence.revokedRefs.includes(matches[0].approval_ref)
        || evidence.revokedRefs.includes(evidence.index?.cli_inventory?.approval_ref)) invalid();
    }
  }
  return { attemptedModels, successModel: order.success?.model ?? null };
}
