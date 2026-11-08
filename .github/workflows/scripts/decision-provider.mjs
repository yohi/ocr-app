import { assertRunBindingValid, assertSerializedRunBindingMatches } from './ocr-run-binding.mjs';
import { validateDecisionState } from './build-decision-state.mjs';

const URL = 'https://openrouter.ai/api/alpha/decisions';
export const DECISION_MODEL_ID = 'inception/mercury-decide:free';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REASONS = Object.freeze({
  denied: 'egress_denied', invalid: 'invalid_input', missingKey: 'missing_api_key',
  request: 'request_failed', http: 'http_error', response: 'invalid_response',
});
const STATUSES = new Set(['decision_available', 'decision_unavailable', 'invalid_response', 'egress_denied']);
const FAILURE_CLASSES = new Set([
  'none', 'not_sent', 'timeout', 'dns_error', 'tls_error', 'connection_error', 'transport_error', 'http_error',
  'response_too_large', 'response_read_error', 'response_json_invalid', 'response_schema_invalid',
]);
const KNOWN_REASONS = new Set(['none', ...Object.values(REASONS)]);

function statusCode(response) {
  const status = response?.status;
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function classifyTransportFailure(error) {
  const code = error?.cause?.code;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError'
    || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'timeout';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns_error';
  if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'UND_ERR_SOCKET') return 'connection_error';
  if (code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
    || code === 'DEPTH_ZERO_SELF_SIGNED_CERT') return 'tls_error';
  return 'transport_error';
}

function result(status, reason, fields = {}) {
  return { status, choice: fields.choice ?? null, probabilities: fields.probabilities ?? null,
    confidence: fields.confidence ?? null, latencyMs: fields.latencyMs ?? null, reason,
    failureClass: fields.failureClass ?? (reason === null ? 'none' : 'not_sent'),
    httpStatus: fields.httpStatus ?? null };
}

// Fixed vocabulary only: never include raw exceptions, headers, URLs, response bodies, or API keys.
export function formatDecisionDiagnostic(decision) {
  const status = STATUSES.has(decision?.status) ? decision.status : 'unknown';
  const reason = KNOWN_REASONS.has(decision?.reason ?? 'none') ? decision.reason ?? 'none' : 'unknown';
  const failureClass = FAILURE_CLASSES.has(decision?.failureClass) ? decision.failureClass : 'unknown';
  const httpStatus = statusCode({ status: decision?.httpStatus });
  const elapsed = decision?.latencyMs;
  const latencyMs = Number.isSafeInteger(elapsed) && elapsed >= 0 && elapsed <= 3_600_000 ? elapsed : 'unknown';
  return `DECISION_LLM_DIAGNOSTIC status=${status} reason=${reason} failure_class=${failureClass} http_status=${httpStatus ?? 'none'} latency_ms=${latencyMs}`;
}

function validExpectedBinding(binding) {
  try {
    assertRunBindingValid(binding);
    return true;
  } catch {
    return false;
  }
}

function validGrant(grant, binding) {
  if (!grant || typeof grant !== 'object' || grant.schema_version !== '1' || grant.allowed !== true || grant.destination !== 'openrouter-decisions') return false;
  try {
    assertSerializedRunBindingMatches(binding, grant);
    return true;
  } catch {
    return false;
  }
}

function parseAnswer(payload) {
  const answer = payload?.answers?.review_strategy;
  if (!answer || answer.type !== 'choice' || !['fast', 'deep'].includes(answer.choice)) throw new Error('invalid');
  const probabilities = answer.probabilities;
  if (!probabilities || typeof probabilities !== 'object' || Array.isArray(probabilities)) throw new Error('invalid');
  const { fast, deep } = probabilities;
  if (![fast, deep].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) || Math.abs(fast + deep - 1) > 0.01) throw new Error('invalid');
  const confidence = Object.hasOwn(answer, 'confidence') ? answer.confidence : null;
  if (confidence !== null && (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)) throw new Error('invalid');
  return { choice: answer.choice, probabilities: { fast, deep }, confidence };
}

async function readBoundedText(response) {
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('response too large');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
  }
  if (typeof response.text !== 'function') throw new Error('invalid response');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('response too large');
  return text;
}

export async function requestReviewDecision({ decisionState, grant, expectedBinding, apiKey, fetchImpl, timeoutMs = 5000 }) {
  try { validateDecisionState(decisionState); } catch { return result('decision_unavailable', REASONS.invalid); }
  if (!validExpectedBinding(expectedBinding) || !validGrant(grant, expectedBinding)) return result('egress_denied', REASONS.denied);
  if (typeof apiKey !== 'string' || apiKey.length === 0) return result('decision_unavailable', REASONS.missingKey);
  if (typeof fetchImpl !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return result('decision_unavailable', REASONS.invalid);

  const started = Date.now();
  let response;
  try {
    response = await fetchImpl(URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: DECISION_MODEL_ID,
        state: decisionState,
        questions: { review_strategy: {
          type: 'choice',
          instructions: 'Choose code review depth from PR metadata only. Deep is preferred for high impact or uncertainty. Fast is limited to allowlisted low-risk changes. This is advisory; application policy may override.',
          criteria: { fast: 'Low-impact allowlisted documentation or low-risk code changes', deep: 'Code, security-sensitive, unknown, complex or high-impact changes' },
        } },
      }),
    });
  } catch (error) {
    const failureClass = classifyTransportFailure(error);
    return result('decision_unavailable', REASONS.request, { failureClass, latencyMs: Date.now() - started });
  }
  if (!response?.ok) return result('decision_unavailable', REASONS.http, {
    failureClass: 'http_error', httpStatus: statusCode(response), latencyMs: Date.now() - started,
  });
  let rawText;
  try {
    rawText = await readBoundedText(response);
  } catch (error) {
    const failureClass = error?.message === 'response too large' ? 'response_too_large' : 'response_read_error';
    return result('invalid_response', REASONS.response, { failureClass, latencyMs: Date.now() - started });
  }
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    return result('invalid_response', REASONS.response, { failureClass: 'response_json_invalid', latencyMs: Date.now() - started });
  }
  try {
    const normalized = parseAnswer(payload);
    return result('decision_available', null, { ...normalized, latencyMs: Date.now() - started });
  } catch {
    return result('invalid_response', REASONS.response, { failureClass: 'response_schema_invalid', latencyMs: Date.now() - started });
  }
}
