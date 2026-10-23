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
  if (!binding || typeof binding !== 'object' || Array.isArray(binding) || Object.getPrototypeOf(binding) !== Object.prototype || Reflect.ownKeys(binding).length !== keys.length || Reflect.ownKeys(binding).some(key => typeof key !== 'string' || !keys.includes(key)) || typeof binding.workflowRunId !== 'string' || !canonicalDecimal(binding.workflowRunId) || !Number.isSafeInteger(binding.runAttempt) || binding.runAttempt < 1 || typeof binding.headSha !== 'string' || !/^[0-9a-f]{40}$/.test(binding.headSha) || !['shadow', 'enforce'].includes(binding.mode)) fail(RUN_BINDING_INVALID);
}

export function createRunBindingFromEnv(env) {
  const workflowRunId = env?.GITHUB_RUN_ID;
  const attempt = env?.GITHUB_RUN_ATTEMPT;
  const headSha = env?.COMMIT_SHA;
  const mode = env?.DECISION_ROUTING_MODE;
  if (!canonicalDecimal(workflowRunId) || !canonicalDecimal(attempt) || !/^[0-9a-f]{40}$/i.test(headSha ?? '') || !['shadow', 'enforce'].includes(mode)) fail(RUN_BINDING_INVALID);
  const runAttempt = Number(attempt);
  if (!Number.isSafeInteger(runAttempt) || runAttempt < 1) fail(RUN_BINDING_INVALID);
  return { workflowRunId, runAttempt, headSha: headSha.toLowerCase(), mode };
}

export function assertRunBindingEquals(expected, actual) {
  assertRunBindingValid(expected);
  if (!actual || typeof actual !== 'object' || typeof actual.workflowRunId !== 'string' || typeof actual.runAttempt !== 'number' || typeof actual.headSha !== 'string' || typeof actual.mode !== 'string' || expected.workflowRunId !== actual.workflowRunId || expected.runAttempt !== actual.runAttempt || expected.headSha !== actual.headSha || expected.mode !== actual.mode) fail(RUN_BINDING_MISMATCH);
}

export function assertSerializedRunBindingMatches(expected, record) {
  assertRunBindingValid(expected);
  if (!record || typeof record !== 'object' || record.workflow_run_id !== expected.workflowRunId || record.run_attempt !== expected.runAttempt || record.head_sha !== expected.headSha || (Object.hasOwn(record, 'effective_mode') && record.effective_mode !== expected.mode)) fail(RUN_BINDING_MISMATCH);
}
