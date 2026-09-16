import { spawn as nodeSpawn } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';

const SCHEMA_VERSION = '1.0';
const REVIEW_MODE = 'review';
const THREAD_MODE = 'thread';
const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_PRINT_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_CHARS = 1_000_000;
const KILL_GRACE_PERIOD_MS = 25;
const MAX_TIMEOUT_MS = 1_800_000;

export function resolveTimeoutMs(env = process.env, fallback = DEFAULT_TIMEOUT_MS) {
  return parsePositiveInteger(env?.ANTIGRAVITY_TIMEOUT_MS, fallback, MAX_TIMEOUT_MS);
}

export function resolvePrintTimeoutMs(env = process.env, fallback = DEFAULT_PRINT_TIMEOUT_MS) {
  return parsePositiveInteger(env?.ANTIGRAVITY_PRINT_TIMEOUT_MS, fallback, MAX_TIMEOUT_MS);
}

export function normalizeAntigravityModel(model) {
  const trimmed = String(model ?? '').trim();
  if (!trimmed) return 'gemini-3.8-flash-medium';
  if (/^gemini-\d+\.\d+-flash$/i.test(trimmed)) return `${trimmed.toLowerCase()}-medium`;
  return trimmed;
}

export function resolveModel(env = process.env) {
  return normalizeAntigravityModel(env?.OCR_LLM_MODEL || env?.ANTIGRAVITY_MODEL);
}

function sanitize(value) {
  return String(value ?? '')
    .replace(/(?:gh[pousr]|github_pat|sk-[a-z0-9_-]+|oauth)[a-z0-9._-]*/gi, '[REDACTED]')
    .replace(/bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/(token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

function failure(mode, message) {
  if (mode === THREAD_MODE) {
    return {
      schema_version: SCHEMA_VERSION,
      mode: THREAD_MODE,
      status: 'failed',
      decision: 'keep',
      reason: '',
      message: sanitize(message),
    };
  }
  return {
    schema_version: SCHEMA_VERSION,
    mode: REVIEW_MODE,
    status: 'failed',
    coverage: 0,
    findings: [],
    message: sanitize(message),
  };
}

function parsePositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed <= 0) return 1;
  return Math.min(parsed, maximum);
}

export function resolveBatchLimits(env = process.env) {
  return {
    maxDiffChars: parsePositiveInteger(env.ANTIGRAVITY_MAX_DIFF_CHARS, 20_000, 40_000),
    maxFilesPerBatch: parsePositiveInteger(env.ANTIGRAVITY_MAX_FILES_PER_BATCH, 10, 20),
  };
}

function isRelativePath(filePath) {
  return typeof filePath === 'string' && filePath.length > 0 &&
    !filePath.startsWith('/') && !filePath.startsWith('\\') &&
    !filePath.split(/[\\/]+/).includes('..');
}

function validateReview(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Review output must be an object');
  if (data.schema_version !== SCHEMA_VERSION || data.mode !== REVIEW_MODE) {
    throw new Error('Review output schema or mode is invalid');
  }
  if (!['success', 'skipped', 'failed'].includes(data.status)) throw new Error('Review status is invalid');
  if (typeof data.coverage !== 'number' || data.coverage < 0 || data.coverage > 1) {
    throw new Error('Review coverage must be a number between 0 and 1');
  }
  if (!Array.isArray(data.findings)) throw new Error('Review findings must be an array');
  for (const finding of data.findings) {
    if (!finding || typeof finding !== 'object' || !SEVERITIES.has(finding.severity)) {
      throw new Error('Finding severity is invalid');
    }
    if (!isRelativePath(finding.path) || !Number.isSafeInteger(finding.line) || finding.line <= 0) {
      throw new Error('Finding path or changed-line position is invalid');
    }
    if (typeof finding.message !== 'string' || finding.message.length === 0) {
      throw new Error('Finding message is invalid');
    }
  }
  if (data.message === undefined || data.message === null) {
    data.message = '';
  } else if (typeof data.message !== 'string') {
    throw new Error('Review message is invalid');
  }
  return data;
}

function validateThread(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Thread output must be an object');
  if (data.schema_version !== SCHEMA_VERSION || data.mode !== THREAD_MODE) {
    throw new Error('Thread output schema or mode is invalid');
  }
  if (!['resolve', 'keep'].includes(data.decision) || typeof data.reason !== 'string') {
    throw new Error('Thread decision is invalid');
  }
  return data;
}

function parseJsonFromText(text) {
  if (typeof text !== 'string') {
    throw new Error('Expected string input for JSON parsing');
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error('Response text is empty');
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch) {
      return JSON.parse(codeBlockMatch[1].trim());
    }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('No valid JSON object found in response');
  }
}

export function extractPayload(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if (raw.status === 'ERROR' || raw.status === 'FAILED' || raw.error) {
      throw new Error(raw.error || raw.message || 'Antigravity execution failed');
    }
    if ('response' in raw) {
      if (typeof raw.response === 'string') {
        return parseJsonFromText(raw.response);
      }
      if (typeof raw.response === 'object' && raw.response !== null) {
        return raw.response;
      }
    }
    return raw;
  }
  if (typeof raw === 'string') {
    const parsed = parseJsonFromText(raw);
    return extractPayload(parsed);
  }
  throw new Error('Invalid payload format');
}

function readChild({ prompt, cwd, timeoutMs, printTimeoutMs, spawn, mode, model }) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const effectiveModel = normalizeAntigravityModel(model);
    const workspace = resolvePath(cwd);
    const child = spawn('agy', [
      '--add-dir', workspace,
      '--model', effectiveModel,
      '-p', prompt,
      '--output-format', 'json',
      '--print-timeout', `${printTimeoutMs}ms`,
    ], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    const appendOutput = (current, chunk) => {
      if (current.length >= MAX_OUTPUT_CHARS) return current;
      return current + String(chunk).slice(0, MAX_OUTPUT_CHARS - current.length);
    };
    const onStdout = chunk => {
      if (!settled) stdout = appendOutput(stdout, chunk);
    };
    const onStderr = chunk => {
      if (!settled) stderr = appendOutput(stderr, chunk);
    };
    const removeOutputListeners = () => {
      child.stdout?.removeListener('data', onStdout);
      child.stderr?.removeListener('data', onStderr);
    };
    const killProcessTree = signal => {
      try {
        if (Number.isInteger(child.pid) && child.pid > 0) {
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch {
        // The process or its group is already gone; preserve the timeout result.
      }
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeOutputListeners();
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({ error: new Error('Antigravity host timed out') });
      killProcessTree('SIGTERM');
      setTimeout(() => killProcessTree('SIGKILL'), KILL_GRACE_PERIOD_MS);
    }, timeoutMs);

    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.once('error', error => finish({ error }));
    child.once('close', (code, signal) => {
      if (code !== 0) {
        const errorDetail = stderr.trim() ? `: ${stderr.trim()}` : '';
        finish({ error: new Error(`Antigravity host exited with ${signal || `code ${code}`}${errorDetail}`) });
        return;
      }
      try {
        const parsed = extractPayload(stdout);
        finish({ parsed });
      } catch (err) {
        const errorDetail = stderr.trim() ? ` (stderr: ${stderr.trim()})` : '';
        finish({ error: new Error(`Antigravity host returned malformed JSON: ${err.message}${errorDetail}`) });
      }
    });
  });
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 3000;

function isTransientError(errorMessage) {
  return /context canceled|resource has been exhausted|rate limit|quota|503|502|500|econnreset|etimedout|required the ["']command["'] permission that headless mode cannot prompt for.*auto-denied/i.test(errorMessage);
}

function isFallbackError(errorMessage) {
  return /no capacity|temporarily unavailable|service unavailable|host timed out|print timed out|resource has been exhausted|rate limit|quota|503|502|500|econnreset|etimedout/i.test(errorMessage);
}


async function runMode({
  prompt,
  cwd,
  timeoutMs,
  spawn = nodeSpawn,
  mode,
  env = process.env,
  model,
  fallbackModel,
  maxRetries = parsePositiveInteger(env?.ANTIGRAVITY_MAX_RETRIES, DEFAULT_MAX_RETRIES, 5),
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  printTimeoutMs,
}) {
  if (typeof prompt !== 'string' || prompt.length === 0) return failure(mode, 'Prompt is required');
  if (typeof cwd !== 'string' || cwd.length === 0) return failure(mode, 'Trusted working directory is required');
  const effectiveTimeoutMs = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : resolveTimeoutMs(env);
  const effectivePrintTimeoutMs = typeof printTimeoutMs === 'number' && Number.isFinite(printTimeoutMs) && printTimeoutMs > 0
    ? printTimeoutMs
    : resolvePrintTimeoutMs(env);
  const effectiveModel = model ? normalizeAntigravityModel(model) : resolveModel(env);
  const configuredFallbackModel = fallbackModel || env?.ANTIGRAVITY_FALLBACK_MODEL;
  const models = [effectiveModel, configuredFallbackModel ? normalizeAntigravityModel(configuredFallbackModel) : null]
    .filter((candidate, index, candidates) => candidate && candidates.indexOf(candidate) === index);

  const attempts = Math.max(1, maxRetries + 1);
  for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
    const currentModel = models[modelIndex];
    let shouldFallback = false;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      let childResult;
      try {
        childResult = await readChild({
          prompt,
          cwd,
          timeoutMs: effectiveTimeoutMs,
          printTimeoutMs: effectivePrintTimeoutMs,
          spawn,
          mode,
          model: currentModel,
        });
      } catch (error) {
        if (isFallbackError(error.message)) {
          if (modelIndex < models.length - 1) {
            shouldFallback = true;
            break;
          }
          return failure(mode, error.message);
        }
        if (attempt < attempts && isTransientError(error.message)) {
          await new Promise(r => setTimeout(r, retryDelayMs * attempt));
          continue;
        }
        return failure(mode, error.message);
      }

      if (childResult.error) {
        if (isFallbackError(childResult.error.message)) {
          if (modelIndex < models.length - 1) {
            shouldFallback = true;
            break;
          }
          return failure(mode, childResult.error.message);
        }
        if (attempt < attempts && isTransientError(childResult.error.message)) {
          await new Promise(r => setTimeout(r, retryDelayMs * attempt));
          continue;
        }
        return failure(mode, childResult.error.message);
      }

      try {
        if (mode === THREAD_MODE) {
          const data = validateThread(childResult.parsed);
          return { ...data, status: 'success', message: '' };
        }
        return validateReview(childResult.parsed);
      } catch (error) {
        return failure(mode, error.message);
      }
    }

    if (shouldFallback) continue;
  }

  return failure(mode, 'Antigravity host failed without a response');
}

export function runHost(options) {
  return runMode({ ...options, mode: REVIEW_MODE });
}

export function runThreadHost(options) {
  return runMode({ ...options, mode: THREAD_MODE });
}
