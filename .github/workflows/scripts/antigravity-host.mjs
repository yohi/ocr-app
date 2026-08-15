import { spawn as nodeSpawn } from 'node:child_process';

const SCHEMA_VERSION = '1.0';
const REVIEW_MODE = 'review';
const THREAD_MODE = 'thread';
const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_CHARS = 1_000_000;
const KILL_GRACE_PERIOD_MS = 25;

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
  if (typeof data.message !== 'string') throw new Error('Review message is invalid');
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

function readChild({ prompt, cwd, timeoutMs, spawn, mode }) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn('agy', ['-p', prompt, '--output-format', 'json'], {
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
      killProcessTree('SIGTERM');
      finish({ error: new Error('Antigravity host timed out') });
      setTimeout(() => killProcessTree('SIGKILL'), KILL_GRACE_PERIOD_MS);
    }, timeoutMs);

    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.once('error', error => finish({ error }));
    child.once('close', (code, signal) => {
      if (code !== 0) {
        finish({ error: new Error(`Antigravity host exited with ${signal || `code ${code}`}`) });
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        finish({ parsed });
      } catch {
        finish({ error: new Error('Antigravity host returned malformed JSON') });
      }
    });
    void stderr;
    void mode;
  });
}

async function runMode({ prompt, cwd, timeoutMs = DEFAULT_TIMEOUT_MS, spawn = nodeSpawn, mode }) {
  if (typeof prompt !== 'string' || prompt.length === 0) return failure(mode, 'Prompt is required');
  if (typeof cwd !== 'string' || cwd.length === 0) return failure(mode, 'Trusted working directory is required');
  let childResult;
  try {
    childResult = await readChild({ prompt, cwd, timeoutMs, spawn, mode });
  } catch (error) {
    return failure(mode, error.message);
  }
  if (childResult.error) return failure(mode, childResult.error.message);
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

export function runHost(options) {
  return runMode({ ...options, mode: REVIEW_MODE });
}

export function runThreadHost(options) {
  return runMode({ ...options, mode: THREAD_MODE });
}
