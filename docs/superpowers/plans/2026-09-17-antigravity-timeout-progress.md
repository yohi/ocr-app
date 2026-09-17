# Antigravity Timeout Progress Suppression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent buffered stderr progress from being emitted after `runHost` has settled due to a timeout.

**Architecture:** Keep the existing `settled` lifecycle and output buffering unchanged. Add an early return to the child `error` and `close` handlers before they flush buffered progress, so events arriving after timeout cannot invoke `onProgress`.

**Tech Stack:** Node.js ES modules, `node:test`, `node:events`.

## Global Constraints

- Preserve the timeout result and process-tree termination behavior.
- Continue sanitizing and bounding progress emitted before settlement.
- Do not add dependencies or change the public `runHost`/`runThreadHost` interfaces.
- Keep the change limited to the host implementation and its regression test.

---

### Task 1: Lock the timeout progress regression

**Files:**
- Modify: `.github/workflows/scripts/antigravity-host.test.mjs` after the existing timeout progress test

**Interfaces:**
- Consumes: `runHost({ prompt, cwd, timeoutMs, maxRetries, spawn, onProgress })`.
- Produces: A regression test proving a partial stderr line received before timeout is not flushed by a later `close` event.

- [ ] **Step 1: Write the failing test**

Add a test that emits a partial stderr chunk in a microtask, emits `close` after the 5 ms timeout, waits for late events, and asserts no progress callback:

```js
test('runHost does not flush buffered stderr after timeout settlement', async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  const progress = [];
  const spawn = () => {
    queueMicrotask(() => child.stderr.emit('data', 'partial stderr'));
    setTimeout(() => child.emit('close', 0, null), 20);
    return child;
  };

  const result = await runHost({
    prompt: 'Review.',
    cwd: '/tmp/trusted',
    timeoutMs: 5,
    maxRetries: 0,
    spawn,
    onProgress: chunk => progress.push(chunk),
  });

  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(result.status, 'failed');
  assert.deepEqual(progress, []);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test .github/workflows/scripts/antigravity-host.test.mjs --test-name-pattern="does not flush buffered stderr"`

Expected: FAIL because the current `close` handler calls `flushProgress()` after timeout settlement.

### Task 2: Guard post-settlement child events

**Files:**
- Modify: `.github/workflows/scripts/antigravity-host.mjs:268-286`

**Interfaces:**
- Consumes: The existing local `settled` flag in `readChild()`.
- Produces: `error` and `close` handlers that ignore events after `finish()` has settled the promise.

- [ ] **Step 1: Add the minimal guards**

At the beginning of both child event handlers, return when `settled` is already true:

```js
child.once('error', error => {
  if (settled) return;
  flushProgress();
  finish({ error });
});
child.once('close', (code, signal) => {
  if (settled) return;
  flushProgress();
  // existing close result handling remains unchanged
});
```

- [ ] **Step 2: Run the focused regression and host tests**

Run: `node --test .github/workflows/scripts/antigravity-host.test.mjs`

Expected: 36 tests pass with 0 failures, including the new regression.

### Task 3: Verify, commit, and push

**Files:**
- Verify: `.github/workflows/scripts/antigravity-host.mjs`
- Verify: `.github/workflows/scripts/antigravity-host.test.mjs`
- Include: `docs/superpowers/plans/2026-09-17-antigravity-timeout-progress.md`

**Interfaces:**
- Consumes: The completed implementation and test changes.
- Produces: A clean, pushed commit on the current branch.

- [ ] **Step 1: Run the complete script test suite**

Run: `node --test .github/workflows/scripts/*.test.mjs`

Expected: All script tests pass with 0 failures.

- [ ] **Step 2: Check the patch and repository state**

Run: `git diff --check`, `git diff -- .github/workflows/scripts/antigravity-host.mjs .github/workflows/scripts/antigravity-host.test.mjs docs/superpowers/plans/2026-09-17-antigravity-timeout-progress.md`, and `git status --short`.

Expected: No whitespace errors, only the intended files changed, and no secrets are present in the patch.

- [ ] **Step 3: Commit and push the intended files**

Run: `git add .github/workflows/scripts/antigravity-host.mjs .github/workflows/scripts/antigravity-host.test.mjs docs/superpowers/plans/2026-09-17-antigravity-timeout-progress.md`

Run: `git commit -m "fix: タイムアウト後の進捗出力を抑止"`

Run: `git push origin HEAD`

Expected: The commit succeeds and the current branch is pushed to `origin`.
