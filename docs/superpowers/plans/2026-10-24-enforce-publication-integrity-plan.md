# Enforce Publication Authorization and Result Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require fresh authorization before each enforce publication mutation and prove that the posted OCR result bytes are exactly the bytes accepted by validation.

**Architecture:** The validator hashes the raw result bytes it parses and publishes the digest as a step output. The audit finalizer compares that digest to the current bytes, records it in routing audit schema v3, and the Publisher plus posting adapter verify the same digest. For each enforce mutation, the post adapter invokes a Publisher callback that fetches current central authorization, revalidates the execution context and Gate, then checks the live PR HEAD immediately before writing.

**Tech Stack:** Node.js ESM, `node:test`, GitHub Actions YAML, Node built-in `crypto`.

**Spec:** `docs/superpowers/specs/2026-10-24-enforce-publication-integrity-design.md`

## Global Constraints

- Direct enforce invocation of the post adapter remains default-deny.
- Central authorization reads use the existing trusted repository identity, fixed protected ref and paths, and central token; no cache fallback is allowed.
- Each enforce mutation gets a fresh registry/dossier read, execution-context revalidation, Gate evaluation, and live expected-HEAD check.
- Authorization GET-to-mutation is not atomic; instantaneous revocation is not guaranteed.
- `RESULT_SHA256` is lowercase SHA-256 hex over raw result bytes, never serialized result content.
- Final routing audit schema is version `3`; `result_sha256` is lowercase SHA-256 hex or `null` for unavailable bytes. Enforce requires a valid digest.
- Off and shadow posting and authorization semantics remain unchanged when no expected digest is supplied.
- No dependency additions, approval-policy changes, rollout activation, PR creation, or merge.

## Review Focus

1. Revocation becomes visible after one successful mutation: later mutations and the summary must be blocked (Task 5).
2. Central authority returns 403, malformed data, expired approval, or a revoked approval: the next mutation must be denied without exposing raw errors (Task 5).
3. Result bytes change after validation but before finalization, Publisher, or adapter read: final audit or publication must fail closed (Tasks 2–4).
4. Validator output is missing, malformed, or does not match readable result bytes: audit validation must not remain `passed`, and enforce Gate must deny (Tasks 2–3).
5. Individual-comment fallback is in progress when authorization is revoked: no later fallback comment or summary may be posted; HEAD mismatch after authorization must still block the write (Task 5).

---

### Task 1: Emit a digest for the exact bytes validated

**Files:**
- Modify: `.github/workflows/scripts/validate-ocr-result.mjs`
- Test: `.github/workflows/scripts/validate-ocr-result.test.mjs`

**Interfaces:**
- Consumes: Existing CLI arguments `<result-path> <expected-reviewable-files> <context-path>` and `GITHUB_OUTPUT`.
- Produces: A `RESULT_SHA256=<lowercase-hex64>` output written after raw bytes are read and before JSON parsing. Validation parses and checks the same `Buffer` used for hashing.

- [ ] **Step 1: Write failing CLI tests** named `emits the raw-byte digest for validated JSON` and `emits the raw-byte digest before rejecting malformed JSON`. Assert valid input emits the exact raw-byte SHA-256 rather than the re-serialized JSON digest, and malformed input still emits the digest before exiting nonzero.
- [ ] **Step 2: Run the targeted test to verify RED.**

Run: `node --test .github/workflows/scripts/validate-ocr-result.test.mjs`

Expected: the new assertion fails because `RESULT_SHA256` is not emitted.

- [ ] **Step 3: Implement raw-byte parsing and output.** Read the result file once as a `Buffer`, compute SHA-256, append only `RESULT_SHA256=<hex>` to `GITHUB_OUTPUT`, parse the same bytes, then call the existing validation logic. Do not emit JSON content.
- [ ] **Step 4: Run the targeted test to verify GREEN.**

Run: `node --test .github/workflows/scripts/validate-ocr-result.test.mjs`

Expected: all validator tests pass, including exact raw-byte digest and existing validation cases.

### Task 2: Version the audit contract and bind validation evidence

**Files:**
- Modify: `.github/workflows/scripts/ocr-routing-audit.mjs`
- Test: `.github/workflows/scripts/ocr-routing-audit.test.mjs`
- Test: `.github/workflows/scripts/routing-audit-contract.test.mjs`
- Update fixtures: `.github/workflows/scripts/routing-remediation.integration.test.mjs`, `.github/workflows/scripts/ocr-routing-entrypoints.test.mjs`

**Interfaces:**
- Consumes: `verifyValidatedResultEvidence({ rawBytes: Buffer | null, validatedResultSha256: string | null, validationStatus: 'passed' | 'failed' | 'not_run' })` and a required `resultSha256` input to `finalizeRoutingAudit()`.
- Produces: `{ reviewValidationStatus: 'passed' | 'failed' | 'not_run', resultSha256: string | null }`; `finalizeRoutingAudit()` writes schema version `'3'` and `result_sha256`.

- [ ] **Step 1: Write failing tests** named `preserves passed validation for matching result bytes`, `fails passed validation for missing or mismatching validator digest`, `does not promote non-passed validation`, and `records null digest when result bytes are unavailable`. Assert returned `reviewValidationStatus` and `resultSha256` exactly for each input class.
- [ ] **Step 2: Run audit tests to verify RED.**

Run: `node --test .github/workflows/scripts/ocr-routing-audit.test.mjs .github/workflows/scripts/routing-audit-contract.test.mjs`

Expected: new evidence-binding tests fail because the helper and schema-v3 field do not exist.

- [ ] **Step 3: Implement the evidence-binding helper and schema v3 in `ocr-routing-audit.mjs`.** Add `result_sha256` to `AUDIT_KEYS`, validate it as lowercase hex64 or `null`, and set `schema_version: '3'`. Keep `null` valid only for non-publishable/incomplete records.
- [ ] **Step 4: Update audit fixtures and run the targeted audit tests.** Update `finalizeRoutingAudit()` call fixtures in the listed tests to supply a representative digest or `null` as appropriate; retain explicit tests for null/incomplete audits.

Run: `node --test .github/workflows/scripts/ocr-routing-audit.test.mjs .github/workflows/scripts/routing-audit-contract.test.mjs`

Expected: all targeted audit tests pass.

### Task 3: Wire validator evidence through finalization and the enforce Gate

**Files:**
- Modify: `.github/workflows/ocr-engine.yml`
- Modify: `.github/workflows/scripts/evaluate-routing-publish.mjs`
- Test: `.github/workflows/scripts/evaluate-routing-publish.test.mjs`
- Test: `.github/workflows/scripts/ocr-routing-workflow.test.mjs`
- Test: `.github/workflows/scripts/routing-remediation.integration.test.mjs`
- Update fixtures: `.github/workflows/scripts/ocr-routing-entrypoints.test.mjs`

**Interfaces:**
- Consumes: `steps.validate-review.outputs.RESULT_SHA256` from Task 1 and `verifyValidatedResultEvidence()` from Task 2.
- Produces: Finalizer environment input `VALIDATED_RESULT_SHA256`; final audit has `review_validation_status` and `result_sha256` derived from a comparison of validator output with current raw bytes. Enforce Gate accepts only a valid digest and passed validation.

- [ ] **Step 1: Write failing tests** named `enforce Gate rejects absent or malformed result digest` and `finalizer fails validation when current result differs from validator output`. Assert Gate is unauthorized and the final audit cannot contain `review_validation_status: 'passed'` for a changed digest.
- [ ] **Step 2: Run the targeted tests to verify RED.**

Run: `node --test .github/workflows/scripts/evaluate-routing-publish.test.mjs .github/workflows/scripts/ocr-routing-workflow.test.mjs .github/workflows/scripts/routing-remediation.integration.test.mjs`

Expected: new digest-binding assertions fail against schema-v2/frozen validation status behavior.

- [ ] **Step 3: Wire the digest into workflow finalization.** Pass `steps.validate-review.outputs.RESULT_SHA256` as `VALIDATED_RESULT_SHA256`; finalizer reads raw bytes, invokes `verifyValidatedResultEvidence()`, and supplies its status/digest to `finalizeRoutingAudit()`.
- [ ] **Step 4: Require a valid digest in enforce Gate evaluation.** Return the existing fixed audit-incomplete denial for null or invalid digest; do not add raw result bytes to the audit or step outputs.
- [ ] **Step 5: Update schema-v3 Gate fixtures and run the targeted workflow/Gate tests.**

Run: `node --test .github/workflows/scripts/evaluate-routing-publish.test.mjs .github/workflows/scripts/ocr-routing-workflow.test.mjs .github/workflows/scripts/routing-remediation.integration.test.mjs .github/workflows/scripts/ocr-routing-entrypoints.test.mjs .github/workflows/scripts/routing-audit-contract.test.mjs`

Expected: all targeted tests pass; a changed result between validator and finalizer cannot produce passed audit evidence or an authorized Gate.

### Task 4: Verify result bytes in the Publisher and post adapter

**Files:**
- Modify: `.github/workflows/scripts/publish-routing-review.mjs`
- Modify: `.github/workflows/scripts/post-ocr-comments.mjs`
- Test: `.github/workflows/scripts/publish-routing-review.test.mjs`
- Test: `.github/workflows/scripts/post-ocr-comments.test.mjs`
- Test: `.github/workflows/scripts/routing-remediation.integration.test.mjs`

**Interfaces:**
- Consumes: `finalAudit.result_sha256` from Task 3.
- Produces: `publishRoutingReview()` verifies the result file digest before calling `postReview()` and passes `expectedResultSha256`; `run({ expectedResultSha256 })` reads bytes once, checks the digest, and parses that same buffer.

- [ ] **Step 1: Write failing Publisher tests** named `does not call post adapter for missing result digest` and `does not call post adapter for changed result bytes`. Assert `postReview` is never called.
- [ ] **Step 2: Run Publisher tests to verify RED.**

Run: `node --test .github/workflows/scripts/publish-routing-review.test.mjs`

Expected: the new tests fail because publication does not compare result bytes to `finalAudit.result_sha256`.

- [ ] **Step 3: Write failing adapter tests** named `rejects mismatched expected result digest before any GitHub request` and `posts parsed result bytes when expected digest matches`. Assert mismatch causes zero GitHub API calls and match preserves the existing posting result.
- [ ] **Step 4: Run adapter tests to verify RED.**

Run: `node --test .github/workflows/scripts/post-ocr-comments.test.mjs`

Expected: the mismatch test fails because `run()` ignores `expectedResultSha256`.

- [ ] **Step 5: Implement Publisher and adapter byte checks.** Publisher compares exact file bytes with `finalAudit.result_sha256`; adapter independently reads bytes once, compares before constructing/using the GitHub API, and parses the same buffer.
- [ ] **Step 6: Run Publisher, adapter, and integration tests.**

Run: `node --test .github/workflows/scripts/publish-routing-review.test.mjs .github/workflows/scripts/post-ocr-comments.test.mjs .github/workflows/scripts/routing-remediation.integration.test.mjs`

Expected: mismatches are denied before any GitHub request; matching bytes follow existing publication behavior.

### Task 5: Reauthorize each enforce mutation and stop after denial

**Files:**
- Modify: `.github/workflows/scripts/publish-routing-review.mjs`
- Modify: `.github/workflows/scripts/post-ocr-comments.mjs`
- Test: `.github/workflows/scripts/publish-routing-review.test.mjs`
- Test: `.github/workflows/scripts/post-ocr-comments.test.mjs`
- Test: `.github/workflows/scripts/routing-remediation.integration.test.mjs`

**Interfaces:**
- Consumes: Existing `fetchAuthorization`, `revalidateExecutionContext`, `evaluateGate`, trusted inputs, and `authorizeBeforeMutation` adapter seam.
- Produces: Each callback invocation performs a new central GET and re-runs context validation and the full Gate; the adapter invokes authorization first, then live expected-HEAD validation, then the mutation. Authorization denial stops all later mutation attempts.

- [ ] **Step 1: Write failing tests** in `publish-routing-review.test.mjs` named `re-fetches central authority for each mutation callback` and table-driven `denies mutation when fresh authority, context, CLI identity, or Gate fails`. Assert each callback performs a new GET and returns `false` for every denied/failing case. In `post-ocr-comments.test.mjs`, add `stops individual fallback and summary after fresh authorization denial`; deny a selected fallback callback and assert later writes are absent, and record order to prove the live HEAD GET follows authorization immediately before the attempted write.
- [ ] **Step 2: Run Publisher and adapter tests to verify RED.**

Run: `node --test .github/workflows/scripts/publish-routing-review.test.mjs .github/workflows/scripts/post-ocr-comments.test.mjs`

Expected: Publisher callback tests observe stale authorization/no new GET; adapter tests observe old ordering and/or continued fallback after denial.

- [ ] **Step 3: Implement per-callback authorization in `publishRoutingReview()`.** Reuse the fixed central repo/ref/token and trusted inputs; use a fresh timestamp, fetch registry/dossiers, re-read CLI identity when required, revalidate the sealed context, then re-evaluate the Gate. Catch failures and return `false` without exposing raw errors.
- [ ] **Step 4: Reorder and stop adapter effects.** In each mutation path call the authorization callback, then `assertExpectedHead()`, then write. Treat authorization denial as terminal rather than continuing the individual-comment fallback loop.
- [ ] **Step 5: Run Publisher, adapter, and integration tests.** Preserve existing off/shadow tests proving behavior remains unchanged without an expected digest.

Run: `node --test .github/workflows/scripts/publish-routing-review.test.mjs .github/workflows/scripts/post-ocr-comments.test.mjs .github/workflows/scripts/routing-remediation.integration.test.mjs`

Expected: revocation between mutations prevents the next and all later writes; expected-HEAD mismatch still prevents the current write.

### Task 6: Run complete workflow verification

**Files:**
- Verify: `.github/workflows/scripts/*.test.mjs`
- Verify: `.github/workflows/ocr-engine.yml`

**Interfaces:**
- Consumes: All completed implementation tasks.
- Produces: Complete local test and workflow-syntax evidence for the final branch.

- [ ] **Step 1: Run all workflow-script tests.**

Run: `node --test .github/workflows/scripts/*.test.mjs`

Expected: all tests pass, including schema-v3 fixtures and the new negative cases.

- [ ] **Step 2: Run workflow lint.**

Run: `actionlint .github/workflows/ocr-engine.yml`

Expected: exit code 0 with no diagnostics.

- [ ] **Step 3: Check whitespace and final branch diff.**

Run: `git diff --check`

Expected: exit code 0; only files listed by the approved spec and tasks are changed.
