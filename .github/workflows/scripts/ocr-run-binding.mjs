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
  if (!expected || !actual || expected.workflowRunId !== actual.workflowRunId || expected.runAttempt !== actual.runAttempt || expected.headSha !== actual.headSha || expected.mode !== actual.mode) fail(RUN_BINDING_MISMATCH);
}

export function assertSerializedRunBindingMatches(expected, record) {
  if (!record || record.workflow_run_id !== expected.workflowRunId || record.run_attempt !== expected.runAttempt || record.head_sha !== expected.headSha || record.effective_mode !== expected.mode) fail(RUN_BINDING_MISMATCH);
}
