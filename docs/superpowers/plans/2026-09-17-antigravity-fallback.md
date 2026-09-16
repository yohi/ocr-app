# Antigravity Capacity Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Gemini as the primary review model while bounding stalled provider calls and falling back to the previously working Claude model.

**Architecture:** Extend the trusted Antigravity host with an ordered primary/fallback model policy. Capacity and timeout errors move directly to the next model; other transient errors retain bounded retry behavior. The workflow supplies the fallback and an explicit five-minute print timeout.

**Tech Stack:** Node.js ESM, `node:test`, GitHub Actions YAML, `agy` CLI.

## Global Constraints

- Preserve the review and thread output schemas (`schema_version: "1.0"`).
- Do not expose prompts, tokens, or child-process output in failure results.
- Keep `gemini-3.8-flash-medium` as the primary model.
- Use `claude-opus-4-6-thinking` as the default fallback model.
- Capacity and timeout failures must not retry the same model.
- The production `agy` print timeout and host timeout are 300000 ms.
- Preserve unrelated user modifications in the working tree.

---

### Task 1: Host fallback policy

**Files:**
- Modify: `.github/workflows/scripts/antigravity-host.mjs:162-294`
- Test: `.github/workflows/scripts/antigravity-host.test.mjs:307-356`

**Interfaces:**
- Add `resolvePrintTimeoutMs(env, fallback)` for an explicit bounded `agy` print timeout.
- Extend `runHost` and `runThreadHost` options with `fallbackModel` and `printTimeoutMs` through `runMode`.
- Keep `runHost(options)` and `runThreadHost(options)` return schemas unchanged.

- [ ] **Step 1: Write failing tests**

Add tests that make the injected `spawn` return a capacity error for the primary and `validReview` for the fallback, then assert two spawned commands and the fallback `--model`. Add a timeout/empty-response case, a both-models-fail case, duplicate-model case, and `resolvePrintTimeoutMs({}) === 300000`.

- [ ] **Step 2: Run the focused tests**

Run: `node --test .github/workflows/scripts/antigravity-host.test.mjs`

Expected: the new fallback and print-timeout tests fail while the existing tests pass.

- [ ] **Step 3: Implement the minimal policy**

Add model candidate iteration around the existing attempt loop. Match capacity/unavailable/rate-limit/print-timeout/host-timeout messages before the generic transient retry branch. Move to the next unique model without retrying the current candidate. Pass `printTimeoutMs` to `readChild` and use it for `--print-timeout`; default it to 300000 ms. Log only sanitized model names and failure categories when switching.

- [ ] **Step 4: Run the focused tests again**

Run: `node --test .github/workflows/scripts/antigravity-host.test.mjs`

Expected: all host tests pass, including fallback, bounded timeout, duplicate suppression, and existing retry tests.

### Task 2: Workflow configuration

**Files:**
- Modify: `.github/workflows/ocr-engine.yml:185-215`

**Interfaces:**
- The review host receives `ANTIGRAVITY_FALLBACK_MODEL`, `ANTIGRAVITY_PRINT_TIMEOUT_MS`, and `ANTIGRAVITY_MAX_RETRIES` through its environment.
- The thread resolver receives the same fallback policy without changing its command-line interface.

- [ ] **Step 1: Add explicit environment configuration**

Set the review host environment as follows:

```yaml
ANTIGRAVITY_FALLBACK_MODEL: ${{ vars.ANTIGRAVITY_FALLBACK_MODEL || 'claude-opus-4-6-thinking' }}
ANTIGRAVITY_PRINT_TIMEOUT_MS: ${{ vars.ANTIGRAVITY_PRINT_TIMEOUT_MS || '300000' }}
ANTIGRAVITY_MAX_RETRIES: ${{ vars.ANTIGRAVITY_MAX_RETRIES || '1' }}
```

Add the same fallback and print-timeout variables to the thread resolver environment. Do not change the primary `OCR_LLM_MODEL` mapping.

- [ ] **Step 2: Validate the workflow syntax**

Run: `actionlint .github/workflows/ocr-engine.yml`

Expected: no workflow syntax or expression errors.

### Task 3: Operational timeout variable

**Files:**
- External repository configuration: Actions variable `ANTIGRAVITY_TIMEOUT_MS`

- [ ] **Step 1: Set the production host timeout to five minutes**

Run: `gh variable set ANTIGRAVITY_TIMEOUT_MS --repo yohi/ocr-app --body 300000`

Expected: `gh variable list --repo yohi/ocr-app` reports `ANTIGRAVITY_TIMEOUT_MS` as `300000`.

- [ ] **Step 2: Verify no secret values were changed**

Run: `gh variable list --repo yohi/ocr-app`

Expected: only the intended timeout value differs from the pre-change snapshot; no secret is printed or modified.

### Task 4: Full verification

**Files:**
- Test: `.github/workflows/scripts/*.test.mjs`
- Validate: `.github/workflows/ocr-engine.yml`

- [ ] **Step 1: Run all workflow script tests**

Run: `node --test .github/workflows/scripts/*.test.mjs`

Expected: zero failed tests.

- [ ] **Step 2: Run syntax and whitespace checks**

Run: `actionlint .github/workflows/ocr-engine.yml` and `git diff --check`

Expected: both commands exit successfully without modifying files.

- [ ] **Step 3: Inspect the final diff and worktree**

Run: `git diff -- .github/workflows/ocr-engine.yml .github/workflows/scripts/antigravity-host.mjs .github/workflows/scripts/antigravity-host.test.mjs` and `git status --short`

Expected: only the intended fallback changes are present; existing user changes remain untouched.
