# GitHub Actions Review Progress Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream Antigravity/OpenCodeReview progress lines into the GitHub Actions log while preserving the final JSON result on stdout.

**Architecture:** Add an optional `onProgress` callback to the child-process host. `readChild` continues buffering bounded stderr for diagnostics, sanitizes complete progress lines, and invokes the callback for live output within a bounded total. The workflow passes a callback that writes sanitized stderr to the Actions log; stdout remains buffered and parsed as JSON.

**Tech Stack:** Node.js ESM, `node:child_process`, `node:test`, GitHub Actions YAML.

## Global Constraints

- Review progress is displayed in the `Run Antigravity review host` Actions step.
- The final JSON remains on stdout and is still parsed by `extractPayload`.
- Retry, fallback, timeout, and failure classification behavior remains unchanged.
- `runThreadHost` behavior remains unchanged when no progress callback is supplied.
- Do not add a percentage progress bar, Check Run polling, or structured progress events.
- Do not log authentication credentials or environment variable values.

---

### Task 1: Add Regression Tests for Progress Forwarding

**Files:**
- Modify: `.github/workflows/scripts/antigravity-host.test.mjs:15-30` to allow the fake child to emit multiple stderr chunks.
- Modify: `.github/workflows/scripts/antigravity-host.test.mjs` near the existing `runHost` success tests.

**Interfaces:**
- Consumes: `runHost({ prompt, cwd, spawn, onProgress })`.
- Produces: Tests that define the callback, sanitization, size-limit, and timeout contracts for Task 2.

- [x] **Step 1: Extend the fake child with ordered stderr chunks**

Change `childFor` so an optional `stderrChunks` array is emitted in order, while retaining the existing `stderr` string option for current tests:

```javascript
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
```

- [x] **Step 2: Add a failing callback forwarding test**

Add this test after the basic successful `runHost` test:

```javascript
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
```

- [x] **Step 3: Run the focused test and confirm it fails**

Run: `node --test --test-name-pattern="forwards live stderr progress" .github/workflows/scripts/antigravity-host.test.mjs`

Expected: FAIL because `runHost` does not yet pass `onProgress` to the child-process reader.

- [x] **Step 4: Commit the failing-test change**

```bash
git add .github/workflows/scripts/antigravity-host.test.mjs
git commit -m "test: Actions進捗転送の回帰テストを追加"
```

### Task 2: Forward Child stderr Through the Host API

**Files:**
- Modify: `.github/workflows/scripts/antigravity-host.mjs:167-240` in `readChild`.
- Modify: `.github/workflows/scripts/antigravity-host.mjs:255-343` in `runMode`.

**Interfaces:**
- Consumes: Optional `onProgress` callback supplied by `runHost` or `runThreadHost`.
- Produces: `onProgress(line)` invocation for each sanitized live stderr line, while preserving the existing parsed result.

- [x] **Step 1: Add the optional callback to `readChild`**

Extend the destructured options with `onProgress`, add `sanitizeProgress`, and replace `onStderr` so it retains the bounded buffer, collects complete lines, sanitizes them, limits total forwarded output to `MAX_OUTPUT_CHARS`, and invokes the callback only while the process is unsettled:

```javascript
function sanitizeProgress(value) {
  const cleaned = String(value ?? '')
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-_]/g, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
  return sanitize(cleaned);
}

const onStderr = chunk => {
  if (!settled) {
    stderr = appendOutput(stderr, chunk);
    if (typeof onProgress === 'function') {
      progressBuffer = appendOutput(progressBuffer, chunk);
      emitProgressLines();
    }
  }
};
```

Flush the remaining partial progress line from `progressBuffer` immediately before the existing `close` and `error` handlers call `finish`. Ignore exceptions raised by `onProgress` so a logging failure cannot change the review result.

- [x] **Step 2: Thread the callback through `runMode`**

Add `onProgress` to `runMode`'s options and pass it to the existing `readChild` call. Keep every existing option and statement in the function unchanged:

```javascript
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
  onProgress,
}) {
  childResult = await readChild({
    prompt,
    cwd,
    timeoutMs: effectiveTimeoutMs,
    printTimeoutMs: effectivePrintTimeoutMs,
    spawn,
    mode,
    model: currentModel,
    onProgress,
  });
}
```

- [x] **Step 3: Run the focused test and confirm it passes**

Run: `node --test --test-name-pattern="forwards live stderr progress" .github/workflows/scripts/antigravity-host.test.mjs`

Expected: PASS, with both stderr chunks received in order and `validReview` returned unchanged.

- [x] **Step 4: Run the complete host test file**

Run: `node --test .github/workflows/scripts/antigravity-host.test.mjs`

Expected: PASS for all existing host, timeout, sanitization, retry, and fallback tests.

- [x] **Step 5: Commit the host implementation**

```bash
git add .github/workflows/scripts/antigravity-host.mjs .github/workflows/scripts/antigravity-host.test.mjs
git commit -m "feat: Actionsログへレビュー進捗を転送"
```

### Task 3: Connect Progress Forwarding to the Actions Workflow

**Files:**
- Modify: `.github/workflows/ocr-engine.yml` in the inline Node.js block that calls `runHost`.

**Interfaces:**
- Consumes: `runHost({ onProgress })` from Task 2.
- Produces: Live stderr output and explicit start/end status messages in the Actions job log.

- [x] **Step 1: Add start and end log messages around `runHost`**

In the existing inline module, log only fixed text and the validated result status:

```javascript
console.error('[OpenCodeReview] Review started');
const result = await runHost({
  cwd: 'target-repo',
  prompt: `Review PR #${process.env.PR_NUMBER} from ${process.env.BASE_REF} to ${process.env.COMMIT_SHA}. Use only the trusted OpenCodeReview delegate skill. Inspect the diff with read-only Git and use ocr delegate preview/rule. Return JSON schema_version 1.0, mode review, status success/skipped/failed, coverage 0..1, findings with severity low/medium/high/critical, relative path, positive changed line, and message. Do not include secrets or complete prompts in the response.`,
  onProgress: chunk => process.stderr.write(chunk),
});
console.error(`[OpenCodeReview] Review finished: ${result.status}`);
```

Keep the existing `fs.writeFileSync('/tmp/ocr-result.json', JSON.stringify(result));` and failed-status exit behavior unchanged.

- [x] **Step 2: Verify workflow syntax and the final diff**

Run: `git diff --check`

Run: `git diff -- .github/workflows/ocr-engine.yml .github/workflows/scripts/antigravity-host.mjs .github/workflows/scripts/antigravity-host.test.mjs`

Expected: no whitespace errors; only the callback plumbing, test coverage, and start/end log wiring are present.

- [x] **Step 3: Run all JavaScript workflow script tests**

Run: `node --test .github/workflows/scripts/*.test.mjs`

Expected: PASS for every workflow script test.

- [x] **Step 4: Confirm the working tree and commit the workflow change**

```bash
git status --short
git add .github/workflows/ocr-engine.yml
git commit -m "feat: Actions実行ログにレビュー開始終了を表示"
```

Expected: the working tree contains no unintended files, and the workflow commit contains only the intended YAML change.

### Review Follow-up: Secure Live Progress Output

**Files:**
- Modify: `.github/workflows/scripts/antigravity-host.mjs` to sanitize and bound forwarded progress.
- Modify: `.github/workflows/scripts/antigravity-host.test.mjs` to cover secrets, ANSI sequences, oversized output, sink failures, and timeout ordering.

- [x] **Step 1: Add failing security regression coverage**

The regression test uses a dummy GitHub token, a terminal hyperlink escape sequence, a 1,000,001-character line, a throwing sink, and delayed output after timeout. It first fails because live stderr is forwarded unchanged.

- [x] **Step 2: Sanitize and bound live progress before invoking the callback**

Buffer complete lines, remove terminal control sequences, apply the existing `sanitize` rules, cap forwarded output at `MAX_OUTPUT_CHARS`, flush before normal close/error completion, and ignore sink exceptions.

- [x] **Step 3: Re-run focused and complete tests**

Run: `node --test .github/workflows/scripts/antigravity-host.test.mjs`

Expected: PASS for all host tests, including the new security regression cases.

## Verification Summary

After all tasks, run:

```bash
node --test .github/workflows/scripts/*.test.mjs
```

Expected: all tests pass, `git diff --check` is clean, and only the intended feature commits are present beyond the design commit.
