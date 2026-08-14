# Antigravity Delegation Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans` task-by-task.

**Goal:** Use `agy` as the OpenCodeReview Delegation Mode host in the central review engine.

**Architecture:** `agy` runs the delegate skill and calls `ocr delegate` plus read-only Git.
Node.js launches `agy`, validates its JSON, then retains GitHub comment and GraphQL duties.

**Tech Stack:** GitHub Actions, Node.js native test runner, OpenCodeReview CLI, Antigravity CLI.

## Global Constraints

- Run only on internal PRs; skip external forks before restoring Secrets.
- Treat OAuth restoration as experimental and never log credential data or full prompts.
- Do not create or commit a project `.agents/` directory.
- Install the delegate skill at runtime under `~/.gemini/antigravity-cli/skills/`.
- Never use `--dangerously-skip-permissions`; permit only required OCR and read-only Git work.
- Findings remain non-blocking; operational failures fail the Check Run.

---

## File Structure

- Modify: `.github/workflows/ocr-engine.yml` — replace proxy/OCR LLM steps and configure host.
- Create: `.github/workflows/scripts/antigravity-host.mjs` — invoke `agy` and validate JSON.
- Create: `.github/workflows/scripts/antigravity-host.test.mjs` — host-runner fixtures/tests.
- Modify: `.github/workflows/scripts/resolve-threads.mjs` — replace HTTP LLM evaluation.
- Modify: `.github/workflows/scripts/resolve-threads.test.mjs` — conservative host decisions.
- Modify: `.github/workflows/scripts/post-ocr-comments.mjs` — upsert marked summary.
- Modify: `.github/workflows/scripts/post-ocr-comments.test.mjs` — summary upsert tests.

### Task 1: Host runner and contract

**Files:** Create `antigravity-host.mjs`, `antigravity-host.test.mjs`.

**Interfaces:** Export `runHost({ prompt, cwd, timeoutMs, spawn })` returning
normalized `{ status, coverage, findings, message }` (with `schema_version: "1.0"`, `mode: "review"`).
`status` is `success`, `skipped`, or `failed`. Export `runThreadHost({ prompt, cwd, timeoutMs, spawn })`
or dedicated adapter returning `{ status, decision, reason, message }` (with `schema_version: "1.0"`, `mode: "thread"`).

- [ ] Write fixtures for valid review JSON, malformed JSON, invalid severity, and an invalid
  diff line; add failing tests for schema validation and timeout handling.
- [ ] Add secret-sanitization tests: simulate child process emitting dummy OAuth/token strings in
  stdout/stderr and triggering timeout-error paths. Assert that those secrets are strictly absent
  from returned messages, logs, and failure objects while preserving sanitized error diagnostics.
- [ ] Implement `runHost` and `runThreadHost` using `agy -p`, `--output-format json`, and JSON schema validators.
- [ ] Validate coverage, severity, relative paths, clamped batch variables, and changed-line positions; return
  sanitized failures without process output containing secrets.
- [ ] Run `node --test .github/workflows/scripts/antigravity-host.test.mjs`.
- [ ] Commit: `feat: Antigravityホストランナーを追加`.

### Task 2: Central workflow migration

**Files:** Modify `.github/workflows/ocr-engine.yml`, create/modify permission and checkout tests.

- [ ] Add a PR metadata step that compares head and base repositories before any secret use.
- [ ] Enforce Trusted Checkout execution boundary: check out only trusted base revision for workflow,
  scripts, and configuration execution; treat PR head strictly as passive diff data.
- [ ] Add a successful skipped-result path for fork PRs and zero reviewable files.
- [ ] Replace the LLM proxy, OCR configuration, and `ocr review` steps with tested pinned
  OCR/Antigravity installation, OAuth restoration, runtime skill installation, and `agy`.
- [ ] Write a restrictive Antigravity settings file: allow `ocr delegate preview/rule` and
  Git `diff`, `show`, `status`, `rev-parse`; deny writes, push, `rm`, `sudo`, network fetch,
  unsandboxed commands, and dangerous permission bypass.
- [ ] Add automated permission-policy and execution-boundary tests: verify allowed OCR delegation
  and read-only Git commands succeed, and verify `rm`, `sudo`, `git push`, network fetch, and
  `--dangerously-skip-permissions` are rejected.
- [ ] Add head SHA revalidation check before comment publishing to prevent posting stale results.
- [ ] Preserve artifact upload and Check Run failure for auth, CLI, schema, and API failures.
- [ ] Validate workflow syntax and run all workflow-script tests.
- [ ] Commit: `feat: OCRエンジンをAntigravity委譲へ移行`.

### Task 3: Conservative thread resolution

**Files:** Modify `resolve-threads.mjs`, `resolve-threads.test.mjs`.

- [ ] Add failing tests for host JSON `{ "schema_version": "1.0", "mode": "thread", "decision": "resolve|keep", "reason": string }`.
- [ ] Replace `callLlmEvaluation` and `OCR_LLM_*` configuration with `runThreadHost` (or thread adapter).
- [ ] Preserve GraphQL retrieval; only resolve after an explicit valid `resolve` response.
- [ ] Keep malformed output, missing files, timeout, and ambiguous output unresolved.
- [ ] Run `node --test .github/workflows/scripts/resolve-threads.test.mjs`.
- [ ] Commit: `feat: スレッド解決をAntigravityへ移行`.

### Task 4: Idempotent summary comments

**Files:** Modify `post-ocr-comments.mjs`, `post-ocr-comments.test.mjs`.

- [ ] Add failing tests for locating and PATCHing an exact matching
  `<!-- antigravity-ocr-summary -->` comment verified to be owned by the expected bot login.
- [ ] Add tests verifying that user comments containing similar text are never modified, and concurrent runs
  do not create duplicate bot summaries.
- [ ] Fetch existing issue comments, update a matching bot summary, and POST only when absent.
- [ ] Retain inline GitHub Review posting and existing result compatibility.
- [ ] Run `node --test .github/workflows/scripts/post-ocr-comments.test.mjs`.
- [ ] Commit: `feat: レビューサマリーを冪等更新`.

### Task 5: End-to-end verification

- [ ] Run every workflow-script test with `node --test .github/workflows/scripts/*.test.mjs`.
- [ ] Validate an internal test PR, a fork skip, zero targets, failed auth, malformed host JSON,
  High finding, and one fixed versus one ambiguous OCR thread.
- [ ] Confirm no Secret, OAuth artifact, complete prompt, or complete diff appears in logs/artifacts.
- [ ] Confirm a sub-500-line internal PR completes within three minutes.

## Self-Review

Each approved requirement maps to Tasks 1–5: host delegation, fork boundary, OAuth handling,
restricted permissions, comment upsert, non-blocking findings, and fail-safe resolution.
The plan contains no placeholder tasks; exact interfaces and verification commands are stated.
