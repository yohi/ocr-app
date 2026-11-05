const RUN_BINDING_INVALID = 'RUN_BINDING_INVALID';
const RUN_BINDING_MISMATCH = 'RUN_BINDING_MISMATCH';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function canonicalDecimal(value, maxDigits = 32) {
  return typeof value === 'string' && value.length <= maxDigits && /^[1-9][0-9]*$/.test(value);
}

export function assertRunBindingValid(binding) {
  const keys = ['workflowRunId', 'runAttempt', 'headSha', 'mode'];
  const hasDecisionFlag = binding !== null && typeof binding === 'object' && Object.hasOwn(binding, 'decisionLlmEnabled');
  const allowedKeys = hasDecisionFlag ? [...keys, 'decisionLlmEnabled'] : keys;
  if (!binding || typeof binding !== 'object' || Array.isArray(binding) || Object.getPrototypeOf(binding) !== Object.prototype || Reflect.ownKeys(binding).length !== allowedKeys.length || Reflect.ownKeys(binding).some(key => typeof key !== 'string' || !allowedKeys.includes(key)) || typeof binding.workflowRunId !== 'string' || !canonicalDecimal(binding.workflowRunId) || !Number.isSafeInteger(binding.runAttempt) || binding.runAttempt < 1 || typeof binding.headSha !== 'string' || !/^[0-9a-f]{40}$/.test(binding.headSha) || !['off', 'shadow', 'enforce'].includes(binding.mode) || (hasDecisionFlag && typeof binding.decisionLlmEnabled !== 'boolean')) fail(RUN_BINDING_INVALID);
}

export function createRunBindingFromEnv(env) {
  const workflowRunId = env?.GITHUB_RUN_ID;
  const attempt = env?.GITHUB_RUN_ATTEMPT;
  const headSha = env?.COMMIT_SHA;
  const mode = env?.DECISION_ROUTING_MODE;
  const decisionLlmEnabled = env?.DECISION_LLM_ENABLED || 'false';
  if (!canonicalDecimal(workflowRunId) || !canonicalDecimal(attempt) || !/^[0-9a-f]{40}$/i.test(headSha ?? '') || !['off', 'shadow', 'enforce'].includes(mode) || !['true', 'false'].includes(decisionLlmEnabled)) fail(RUN_BINDING_INVALID);
  const runAttempt = Number(attempt);
  if (!Number.isSafeInteger(runAttempt) || runAttempt < 1) fail(RUN_BINDING_INVALID);
  return { workflowRunId, runAttempt, headSha: headSha.toLowerCase(), mode, decisionLlmEnabled: decisionLlmEnabled === 'true' };
}

export function assertRunBindingEquals(expected, actual) {
  assertRunBindingValid(expected);
  const expectedDecisionFlag = expected.decisionLlmEnabled ?? false;
  const actualDecisionFlag = actual?.decisionLlmEnabled ?? false;
  if (!actual || typeof actual !== 'object' || typeof actual.workflowRunId !== 'string' || typeof actual.runAttempt !== 'number' || typeof actual.headSha !== 'string' || typeof actual.mode !== 'string' || (Object.hasOwn(actual, 'decisionLlmEnabled') && typeof actual.decisionLlmEnabled !== 'boolean') || expected.workflowRunId !== actual.workflowRunId || expected.runAttempt !== actual.runAttempt || expected.headSha !== actual.headSha || expected.mode !== actual.mode || expectedDecisionFlag !== actualDecisionFlag) fail(RUN_BINDING_MISMATCH);
}

export function assertSerializedRunBindingMatches(expected, record) {
  assertRunBindingValid(expected);
  const expectedDecisionFlag = expected.decisionLlmEnabled ?? false;
  if (!record || typeof record !== 'object' || record.workflow_run_id !== expected.workflowRunId || record.run_attempt !== expected.runAttempt || record.head_sha !== expected.headSha || (Object.hasOwn(record, 'effective_mode') && record.effective_mode !== expected.mode) || (expectedDecisionFlag && !Object.hasOwn(record, 'decision_llm_enabled')) || (Object.hasOwn(record, 'decision_llm_enabled') && (typeof record.decision_llm_enabled !== 'boolean' || record.decision_llm_enabled !== expectedDecisionFlag))) fail(RUN_BINDING_MISMATCH);
}
