import { assertRunBindingValid, assertSerializedRunBindingMatches } from './ocr-run-binding.mjs';
import { validateDecisionState } from './build-decision-state.mjs';

const URL = 'https://openrouter.ai/api/alpha/decisions';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REASONS = Object.freeze({
  denied: 'egress_denied', invalid: 'invalid_input', missingKey: 'missing_api_key',
  request: 'request_failed', http: 'http_error', response: 'invalid_response',
});

function result(status, reason, fields = {}) {
  return { status, choice: fields.choice ?? null, probabilities: fields.probabilities ?? null, confidence: fields.confidence ?? null, latencyMs: fields.latencyMs ?? null, reason };
}

function validExpectedBinding(binding) {
  try {
    assertRunBindingValid(binding);
    return binding.destination === 'openrouter-decisions';
  } catch {
    return false;
  }
}

function validGrant(grant, binding) {
  if (!grant || typeof grant !== 'object' || grant.allowed !== true || grant.destination !== 'openrouter-decisions') return false;
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
  try {
    const response = await fetchImpl(URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: 'inception/mercury-decide:free',
        state: decisionState,
        questions: { review_strategy: {
          type: 'choice',
          instructions: 'Choose code review depth from PR metadata only. Deep is preferred for high impact or uncertainty. This is advisory; application policy may override.',
          criteria: { fast: 'Low-impact allowlisted documentation changes only', deep: 'Code, security-sensitive, unknown, complex or high-impact changes' },
        } },
      }),
    });
    if (!response?.ok) return result('decision_unavailable', REASONS.http, { latencyMs: Date.now() - started });
    const text = await readBoundedText(response);
    const normalized = parseAnswer(JSON.parse(text));
    return result('decision_available', null, { ...normalized, latencyMs: Date.now() - started });
  } catch {
    return result('decision_unavailable', REASONS.request, { latencyMs: Date.now() - started });
  }
}
