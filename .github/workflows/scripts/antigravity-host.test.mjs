import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  normalizeAntigravityModel,
  resolveBatchLimits,
  resolveModel,
  resolvePrintTimeoutMs,
  resolveTimeoutMs,
  runHost,
  runThreadHost,
} from './antigravity-host.mjs';

function childFor(output, { stderr = '', stderrChunks = [], exitCode = 0, delayMs = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    child.emit('close', null, 'SIGTERM');
  };
  queueMicrotask(() => {
    setTimeout(() => {
      if (output !== undefined) child.stdout.emit('data', output);
      for (const chunk of stderrChunks) child.stderr.emit('data', chunk);
      if (stderr) child.stderr.emit('data', stderr);
      child.emit('close', exitCode, null);
    }, delayMs);
  });
  return child;
}

function spawnWith(output, options = {}) {
  return () => childFor(output, options);
}

const validReview = {
  schema_version: '1.0',
  mode: 'review',
  status: 'success',
  coverage: 0.75,
  findings: [{
    severity: 'high',
    path: 'src/example.js',
    line: 12,
    message: 'Validate input before use.',
  }],
  message: 'Review completed.',
};

test('runHost invokes agy and returns a validated review result', async () => {
  const result = await runHost({
    prompt: 'Review the trusted diff.',
    cwd: '/tmp/trusted',
    spawn: spawnWith(JSON.stringify(validReview)),
  });

  assert.deepEqual(result, validReview);
});

test('runHost forwards live stderr progress without changing the JSON result', async () => {
  const progress = [];
  const result = await runHost({
    prompt: 'Review the trusted diff.',
    cwd: '/tmp/trusted',
    spawn: spawnWith(JSON.stringify(validReview), {
      stderrChunks: ['[ocr] reviewing files\n', '[ocr] checking findings\n'],
    }),
    onProgress: chunk => progress.push(chunk),
  });

  assert.deepEqual(progress, ['[ocr] reviewing files\n', '[ocr] checking findings\n']);
  assert.deepEqual(result, validReview);
});

test('runHost sanitizes and bounds live stderr progress', async () => {
  const progress = [];
  const secret = 'ghp_dummy_oauth_token_1234567890';
  const unsafeProgress = `\u001b]8;;https://attacker.invalid\u0007Bearer ${secret}\u001b]8;;\u0007\n`;
  const excessiveProgress = `${'x'.repeat(1_000_001)}\n`;
  const result = await runHost({
    prompt: 'Review the trusted diff.',
    cwd: '/tmp/trusted',
    spawn: spawnWith(JSON.stringify(validReview), {
      stderrChunks: [unsafeProgress.slice(0, 24), unsafeProgress.slice(24), excessiveProgress],
    }),
    onProgress: chunk => progress.push(chunk),
  });

  const output = progress.join('');
  assert.deepEqual(result, validReview);
  assert.ok(!output.includes(secret));
  assert.ok(!output.includes('attacker.invalid'));
  assert.ok(!output.includes('\u001b'));
  assert.ok(output.length <= 1_000_000);
});

test('runHost ignores progress sink failures', async () => {
  const result = await runHost({
    prompt: 'Review the trusted diff.',
    cwd: '/tmp/trusted',
    spawn: spawnWith(JSON.stringify(validReview), {
      stderrChunks: ['[ocr] reviewing files\n'],
    }),
    onProgress: () => {
      throw new Error('Actions log is unavailable');
    },
  });

  assert.deepEqual(result, validReview);
});

test('runHost does not forward stderr emitted after timeout', async () => {
  const progress = [];
  const result = await runHost({
    prompt: 'Review the trusted diff.',
    cwd: '/tmp/trusted',
    timeoutMs: 5,
    spawn: spawnWith(undefined, { stderrChunks: ['late progress\n'], delayMs: 50 }),
    onProgress: chunk => progress.push(chunk),
  });

  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(result.status, 'failed');
  assert.deepEqual(progress, []);
});

test('runHost accepts review result without top-level message and defaults to empty string', async () => {
  const { message, ...reviewWithoutMessage } = validReview;
  const result = await runHost({
    prompt: 'Review the trusted diff.',
    cwd: '/tmp/trusted',
    spawn: spawnWith(JSON.stringify(reviewWithoutMessage)),
  });

  assert.deepEqual(result, { ...reviewWithoutMessage, message: '' });
});

test('runHost rejects review result with non-string top-level message', async () => {
  const invalidMessageReview = {
    ...validReview,
    message: 12345,
  };
  const result = await runHost({
    prompt: 'Review the trusted diff.',
    cwd: '/tmp/trusted',
    spawn: spawnWith(JSON.stringify(invalidMessageReview)),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.message, 'Review message is invalid');
});

test('runHost unwraps agy CLI JSON envelope with string response', async () => {
  const envelope = {
    conversation_id: '12345',
    status: 'SUCCESS',
    response: JSON.stringify(validReview),
    duration_seconds: 1.5,
  };
  const result = await runHost({
    prompt: 'Review the diff.',
    cwd: '/tmp/trusted',
    spawn: spawnWith(JSON.stringify(envelope)),
  });

  assert.deepEqual(result, validReview);
});

test('runHost unwraps agy CLI JSON envelope with markdown code block', async () => {
  const envelope = {
    conversation_id: '12345',
    status: 'SUCCESS',
    response: '```json\n' + JSON.stringify(validReview, null, 2) + '\n```',
  };
  const result = await runHost({
    prompt: 'Review the diff.',
    cwd: '/tmp/trusted',
    spawn: spawnWith(JSON.stringify(envelope)),
  });

  assert.deepEqual(result, validReview);
});

test('runHost extracts envelope even when stdout contains prefix warnings or noise', async () => {
  const envelope = {
    conversation_id: '12345',
    status: 'SUCCESS',
    response: JSON.stringify(validReview),
  };
  const noisyStdout = 'jetski: warning — some info\n' + JSON.stringify(envelope);
  const result = await runHost({
    prompt: 'Review the diff.',
    cwd: '/tmp/trusted',
    spawn: spawnWith(noisyStdout),
  });

  assert.deepEqual(result, validReview);
});

test('runHost handles error status envelope from agy', async () => {
  const envelope = {
    conversation_id: '12345',
    status: 'ERROR',
    error: 'Authentication failed',
  };
  const result = await runHost({
    prompt: 'Review the diff.',
    cwd: '/tmp/trusted',
    spawn: spawnWith(JSON.stringify(envelope)),
  });

  assert.equal(result.status, 'failed');
  assert.match(result.message, /Authentication failed/i);
});

test('runHost rejects malformed JSON as a sanitized failure', async () => {
  const result = await runHost({
    prompt: 'Review the trusted diff.',
    cwd: '/tmp/trusted',
    spawn: spawnWith('{not-json'),
  });

  assert.equal(result.status, 'failed');
  assert.match(result.message, /JSON/i);
  assert.equal(result.schema_version, '1.0');
  assert.equal(result.mode, 'review');
});

test('runHost rejects invalid severity and changed-line data', async () => {
  const invalidSeverity = {
    ...validReview,
    findings: [{ ...validReview.findings[0], severity: 'urgent' }],
  };
  const invalidLine = {
    ...validReview,
    findings: [{ ...validReview.findings[0], path: '../secret.txt', line: 0 }],
  };

  for (const output of [invalidSeverity, invalidLine]) {
    const result = await runHost({
      prompt: 'Review the trusted diff.',
      cwd: '/tmp/trusted',
      spawn: spawnWith(JSON.stringify(output)),
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.findings.length, 0);
  }
});

test('runHost times out without returning child output or secrets', async () => {
  const secret = 'ghp_dummy_oauth_token_1234567890';
  const result = await runHost({
    prompt: `Review without exposing ${secret}.`,
    cwd: '/tmp/trusted',
    timeoutMs: 5,
    spawn: spawnWith(secret, { stderr: `Bearer ${secret}`, delayMs: 50 }),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.findings.length, 0);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test('runHost stops collecting output and escalates termination for a child that ignores SIGTERM', async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const signals = [];
  child.kill = (signal) => {
    signals.push(signal);
    if (signal === 'SIGKILL') child.emit('close', null, signal);
  };

  const result = await runHost({
    prompt: 'Review.',
    cwd: '/tmp/trusted',
    timeoutMs: 5,
    spawn: () => child,
  });

  child.stdout.emit('data', 'still writing');
  child.stderr.emit('data', 'still writing');
  await new Promise(resolve => setTimeout(resolve, 30));

  assert.equal(result.status, 'failed');
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(child.stdout.listenerCount('data'), 0);
  assert.equal(child.stderr.listenerCount('data'), 0);
});

test('runHost sanitizes secrets from child errors and malformed output paths', async () => {
  const secret = 'ghp_dummy_oauth_token_abcdef';
  const spawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stderr.emit('data', `authorization=${secret}`);
      child.emit('error', new Error(`child failed with ${secret}`));
    });
    return child;
  };

  const result = await runHost({ prompt: 'Review.', cwd: '/tmp/trusted', spawn });

  assert.equal(result.status, 'failed');
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.match(result.message, /REDACTED/);
});

test('runThreadHost accepts only an explicit resolve or keep decision', async () => {
  const result = await runThreadHost({
    prompt: 'Evaluate this thread.',
    cwd: '/tmp/trusted',
    spawn: spawnWith(JSON.stringify({
      schema_version: '1.0',
      mode: 'thread',
      decision: 'resolve',
      reason: 'The issue is fixed at HEAD.',
    })),
  });

  assert.deepEqual(result, {
    schema_version: '1.0',
    mode: 'thread',
    status: 'success',
    decision: 'resolve',
    reason: 'The issue is fixed at HEAD.',
    message: '',
  });
});

test('runThreadHost keeps malformed or ambiguous decisions unresolved', async () => {
  for (const output of ['not-json', JSON.stringify({ decision: 'maybe' })]) {
    const result = await runThreadHost({
      prompt: 'Evaluate this thread.',
      cwd: '/tmp/trusted',
      spawn: spawnWith(output),
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.decision, 'keep');
  }
});

test('resolveBatchLimits clamps invalid and excessive values', () => {
  assert.deepEqual(resolveBatchLimits({
    ANTIGRAVITY_MAX_DIFF_CHARS: '0',
    ANTIGRAVITY_MAX_FILES_PER_BATCH: '0',
  }), { maxDiffChars: 1, maxFilesPerBatch: 1 });
  assert.deepEqual(resolveBatchLimits({
    ANTIGRAVITY_MAX_DIFF_CHARS: '-100',
    ANTIGRAVITY_MAX_FILES_PER_BATCH: '-5',
  }), { maxDiffChars: 1, maxFilesPerBatch: 1 });
  assert.deepEqual(resolveBatchLimits({
    ANTIGRAVITY_MAX_DIFF_CHARS: 'abc',
    ANTIGRAVITY_MAX_FILES_PER_BATCH: 'ten',
  }), { maxDiffChars: 20_000, maxFilesPerBatch: 10 });
  assert.deepEqual(resolveBatchLimits({}), { maxDiffChars: 20_000, maxFilesPerBatch: 10 });
  assert.deepEqual(resolveBatchLimits({
    ANTIGRAVITY_MAX_DIFF_CHARS: '50000',
    ANTIGRAVITY_MAX_FILES_PER_BATCH: '30',
  }), { maxDiffChars: 40_000, maxFilesPerBatch: 20 });
});

test('resolveTimeoutMs defaults to 5 minutes (300000ms) and respects environment variable', () => {
  assert.equal(resolveTimeoutMs({}), 300_000);
  assert.equal(resolveTimeoutMs({ ANTIGRAVITY_TIMEOUT_MS: '600000' }), 600_000);
  assert.equal(resolveTimeoutMs({ ANTIGRAVITY_TIMEOUT_MS: 'invalid' }), 300_000);
  assert.equal(resolveTimeoutMs({ ANTIGRAVITY_TIMEOUT_MS: '0' }), 1);
  assert.equal(resolveTimeoutMs({ ANTIGRAVITY_TIMEOUT_MS: '-50' }), 1);
  assert.equal(resolveTimeoutMs({ ANTIGRAVITY_TIMEOUT_MS: '2000000' }), 1_800_000);
});

test('runHost retries on transient context canceled error and succeeds on subsequent attempt', async () => {
  let attempts = 0;
  const spawn = () => {
    attempts++;
    if (attempts === 1) {
      return childFor('{"error": "context canceled"}', { exitCode: 0 });
    }
    return childFor(JSON.stringify(validReview), { exitCode: 0 });
  };

  const result = await runHost({
    prompt: 'Review the diff.',
    cwd: '/tmp/trusted',
    spawn,
    maxRetries: 2,
    retryDelayMs: 1,
  });

  assert.equal(attempts, 2);
  assert.deepEqual(result, validReview);
});

test('runHost retries when headless command permission denial leaves an empty response', async () => {
  let attempts = 0;
  const spawn = () => {
    attempts++;
    if (attempts === 1) {
      return childFor(JSON.stringify({
        conversation_id: '12345',
        status: 'SUCCESS',
        response: '',
        denied_actions: [{ action: 'command', display_name: 'RunCommand' }],
      }), {
        stderr: 'jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied.',
      });
    }
    return childFor(JSON.stringify(validReview), { exitCode: 0 });
  };

  const result = await runHost({
    prompt: 'Review the diff.',
    cwd: '/tmp/trusted',
    spawn,
    maxRetries: 2,
    retryDelayMs: 1,
  });

  assert.equal(attempts, 2);
  assert.deepEqual(result, validReview);
});

test('runHost does not retry on non-transient schema error', async () => {
  let attempts = 0;
  const spawn = () => {
    attempts++;
    return childFor('{invalid-json', { exitCode: 0 });
  };

  const result = await runHost({
    prompt: 'Review the diff.',
    cwd: '/tmp/trusted',
    spawn,
    maxRetries: 2,
    retryDelayMs: 1,
  });

  assert.equal(attempts, 1);
  assert.equal(result.status, 'failed');
});

test('runHost falls back to the configured model after a capacity error', async () => {
  const models = [];
  const spawn = (_command, args) => {
    models.push(args[3]);
    if (models.length === 1) {
      return childFor(JSON.stringify({ error: 'UNAVAILABLE (code 503): No capacity available' }));
    }
    return childFor(JSON.stringify(validReview));
  };

  const result = await runHost({
    prompt: 'Review the diff.',
    cwd: '/tmp/trusted',
    spawn,
    model: 'gemini-3.8-flash-medium',
    fallbackModel: 'claude-opus-4-6-thinking',
    maxRetries: 2,
    retryDelayMs: 1,
  });

  assert.deepEqual(models, ['gemini-3.8-flash-medium', 'claude-opus-4-6-thinking']);
  assert.deepEqual(result, validReview);
});

test('runHost falls back after a stalled primary host without retrying it', async () => {
  let attempts = 0;
  const spawn = (_command, args) => {
    attempts++;
    if (args[3] === 'gemini-3.8-flash-medium') {
      return childFor(undefined, { delayMs: 50 });
    }
    return childFor(JSON.stringify(validReview));
  };

  const result = await runHost({
    prompt: 'Review the diff.',
    cwd: '/tmp/trusted',
    spawn,
    fallbackModel: 'claude-opus-4-6-thinking',
    timeoutMs: 5,
    printTimeoutMs: 5,
    maxRetries: 2,
    retryDelayMs: 1,
  });

  assert.equal(attempts, 2);
  assert.deepEqual(result, validReview);
});

test('runHost does not retry a capacity failure after the fallback model also fails', async () => {
  let attempts = 0;
  const spawn = () => {
    attempts++;
    return childFor(JSON.stringify({ error: 'UNAVAILABLE (code 503): No capacity available' }));
  };

  const result = await runHost({
    prompt: 'Review the diff.',
    cwd: '/tmp/trusted',
    spawn,
    fallbackModel: 'claude-opus-4-6-thinking',
    maxRetries: 2,
    retryDelayMs: 1,
  });

  assert.equal(attempts, 2);
  assert.equal(result.status, 'failed');
});

test('runHost ignores a fallback model that normalizes to the primary model', async () => {
  let attempts = 0;
  const spawn = () => {
    attempts++;
    return childFor(JSON.stringify({ error: 'UNAVAILABLE (code 503): No capacity available' }));
  };

  const result = await runHost({
    prompt: 'Review the diff.',
    cwd: '/tmp/trusted',
    spawn,
    model: 'gemini-3.8-flash',
    fallbackModel: 'gemini-3.8-flash-medium',
    maxRetries: 2,
    retryDelayMs: 1,
  });

  assert.equal(attempts, 1);
  assert.equal(result.status, 'failed');
});

test('normalizeAntigravityModel handles effort suffix and fallbacks', () => {
  assert.equal(normalizeAntigravityModel(''), 'gemini-3.8-flash-medium');
  assert.equal(normalizeAntigravityModel(undefined), 'gemini-3.8-flash-medium');
  assert.equal(normalizeAntigravityModel('gemini-3.7-flash'), 'gemini-3.7-flash-medium');
  assert.equal(normalizeAntigravityModel('gemini-3.8-flash'), 'gemini-3.8-flash-medium');
  assert.equal(normalizeAntigravityModel('gemini-3.8-flash-high'), 'gemini-3.8-flash-high');
  assert.equal(normalizeAntigravityModel('claude-sonnet-4-6'), 'claude-sonnet-4-6');
});

test('resolveModel prioritizes OCR_LLM_MODEL over ANTIGRAVITY_MODEL and defaults', () => {
  assert.equal(resolveModel({ OCR_LLM_MODEL: 'gemini-3.7-flash' }), 'gemini-3.7-flash-medium');
  assert.equal(resolveModel({ ANTIGRAVITY_MODEL: 'claude-sonnet-4-6' }), 'claude-sonnet-4-6');
  assert.equal(resolveModel({ OCR_LLM_MODEL: 'gemini-3.8-flash-high', ANTIGRAVITY_MODEL: 'claude-sonnet-4-6' }), 'gemini-3.8-flash-high');
  assert.equal(resolveModel({}), 'gemini-3.8-flash-medium');
});

test('resolvePrintTimeoutMs defaults independently of the host timeout', () => {
  assert.equal(resolvePrintTimeoutMs({}), 300_000);
  assert.equal(resolvePrintTimeoutMs({ ANTIGRAVITY_PRINT_TIMEOUT_MS: '600000' }), 600_000);
  assert.equal(resolvePrintTimeoutMs({ ANTIGRAVITY_PRINT_TIMEOUT_MS: '2000000' }), 1_800_000);
});

test('runHost passes --model flag to agy spawn args', async () => {
  let capturedCmd = null;
  let capturedArgs = null;
  const spawn = (cmd, args) => {
    capturedCmd = cmd;
    capturedArgs = args;
    return childFor(JSON.stringify(validReview), { exitCode: 0 });
  };

  await runHost({
    prompt: 'Review diff',
    cwd: '/tmp/trusted',
    spawn,
    model: 'gemini-3.7-flash',
  });

  assert.equal(capturedCmd, 'agy');
  assert.equal(capturedArgs[0], '--add-dir');
  assert.equal(capturedArgs[1], '/tmp/trusted');
  assert.equal(capturedArgs[2], '--model');
  assert.equal(capturedArgs[3], 'gemini-3.7-flash-medium');
});

test('runHost adds the trusted cwd as an absolute agy workspace', async () => {
  let capturedArgs = null;
  const spawn = (_cmd, args) => {
    capturedArgs = args;
    return childFor(JSON.stringify(validReview), { exitCode: 0 });
  };

  await runHost({
    prompt: 'Review diff',
    cwd: '/tmp/trusted',
    spawn,
  });

  assert.deepEqual(capturedArgs.slice(0, 2), ['--add-dir', '/tmp/trusted']);
});

test('runHost keeps the agy print timeout below the host timeout by default', async () => {
  let capturedArgs = null;
  const spawn = (_cmd, args) => {
    capturedArgs = args;
    return childFor(JSON.stringify(validReview), { exitCode: 0 });
  };

  await runHost({
    prompt: 'Review diff',
    cwd: '/tmp/trusted',
    spawn,
    timeoutMs: 600_000,
  });

  assert.deepEqual(capturedArgs, [
    '--add-dir',
    '/tmp/trusted',
    '--model',
    'gemini-3.8-flash-medium',
    '-p',
    'Review diff',
    '--output-format',
    'json',
    '--print-timeout',
    '300000ms',
  ]);
});
