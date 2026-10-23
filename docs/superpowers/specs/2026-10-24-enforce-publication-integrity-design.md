# Enforce Publication Authorization and Result Integrity

**Status:** Draft for review
**Date:** 2026-10-24
**Target branch:** `feature/routing-authorization-hardening`
**Baseline:** `df9a361680d482aa4968c6198e531b7e3f4f058f`

## Purpose

Close two remaining verification gaps in the enforce publication path:

1. Re-evaluate current central authorization before every GitHub mutation, rather than reuse the authorization state captured by the initial Publisher Gate.
2. Bind the raw OCR result bytes that passed validation to the bytes ultimately parsed and posted by the publication adapter.

This design does not authorize operational rollout or claim instantaneous revocation.

## Current Behavior and Gaps

`publishRoutingReview()` fetches central authorization, revalidates the sealed execution context, evaluates publication eligibility, and checks the current PR HEAD. It then passes `authorizeBeforeMutation` to `post-ocr-comments.mjs`. That callback currently reads the already-computed `gateResult.authorized` and `currentHead`, so later mutation calls do not observe central revocation.

The post adapter may perform several independent mutations: a batch review, individual-comment fallback, and a summary comment. It calls the authorization callback before each mutation, and checks the expected PR HEAD before each write. The enforce callback must therefore perform a fresh authorization check on every invocation.

Separately, `validate-ocr-result.mjs` parses and validates `/tmp/ocr-result.json`, the audit finalizer later reads that path again, and `post-ocr-comments.mjs` reads it again when invoked. No digest currently binds those reads. The final audit records validation status but not the identity of the validated result bytes.

## Requirements

### Per-mutation enforce authorization

- Keep direct enforce invocation of the post adapter denied by default.
- Only `publishRoutingReview()` may supply an enforce mutation-authorization callback, and only after its initial Gate and HEAD checks pass.
- On every callback invocation, fetch the current central registry and operational dossiers from the fixed protected ref and paths using the existing trusted repository identity and central token.
- Revalidate the sealed execution context, current policy/catalog/source-manifest bindings, expiration, revocation, approval scope, and—when the review requires a model—the installed CLI identity.
- Re-evaluate the complete publication Gate using the newly revalidated authorization.
- Return authorization only when every fresh check succeeds. Fetch errors, malformed authority, expired/revoked approval, context mismatch, and Gate denial fail closed for that mutation.
- For each mutation, finish the fresh authorization callback first, then perform the adapter's live expected-HEAD check, then issue the GitHub mutation. This keeps the HEAD read directly adjacent to its write while ensuring both checks are repeated per effect.
- A failed mutation authorization must prevent that mutation and every later mutation in the current publication call.

The authorization read and a GitHub mutation cannot be atomic. Revocation becoming visible after the fresh GET but before the mutation remains an acknowledged race, as documented in Remediation Plan §A.

### Validated-result byte binding

- The validator reads the result file as raw bytes once, computes lowercase SHA-256 over those exact bytes, parses those bytes, and validates the parsed value.
- The validator exposes the digest as `RESULT_SHA256` in `GITHUB_OUTPUT`; it must not place result contents in step output. It computes and emits the digest after reading raw bytes and before parsing, so later validation failure does not erase the digest of bytes that were present.
- The audit finalizer receives the step output as `VALIDATED_RESULT_SHA256`, re-hashes the current result bytes, and compares the two. A missing or mismatched digest changes the audit's `review_validation_status` to `failed`; it must not record `passed` based on the earlier workflow-step status alone.
- Add `result_sha256` to the final routing audit and increment its schema version from `2` to `3`. The field is lowercase SHA-256 hex for readable result bytes, or `null` when the result file was unavailable. Schema validation permits null for incomplete/non-publishable audits; the enforce Gate requires a valid digest.
- The enforce Publisher requires a valid `result_sha256`, verifies the current result file against it before invoking the adapter, and passes it as `expectedResultSha256`.
- The adapter reads the result bytes once, verifies the expected digest before any GitHub API call, and parses that same in-memory byte buffer for all review and summary mutations. A mismatch fails closed and makes no GitHub request.
- Existing off and shadow behavior remains compatible when no expected digest is supplied. Their mutation authorization behavior remains unchanged.

## Intended Data Flow

1. `validate-ocr-result.mjs` reads raw result bytes, validates their parsed value, and emits the digest.
2. The audit finalizer confirms the current result bytes still match the validator digest and records `result_sha256` in the versioned audit.
3. The enforce Publisher validates the audit and confirms the result file still matches `result_sha256`.
4. The post adapter independently verifies the same digest while loading the result, before reading PR data or performing mutations.
5. Before each GitHub write, the adapter invokes the Publisher-provided callback, then checks the expected PR HEAD, then issues the write. The callback fetches current authority and re-runs execution-context validation and the publication Gate.
6. Any failed check stops the current write and all following writes.

## Error Handling

- Authorization GET, context, identity, and Gate failures return `false` from the enforce mutation callback; raw exception details are not emitted.
- Result digest absence or mismatch maps to the existing fixed publication failure path. It does not create a new arbitrary error string in the Check Run output.
- Existing shadow audit best-effort semantics are preserved. Missing or invalid result evidence may produce a null digest and an incomplete audit, but cannot make enforce eligible.
- A successful first mutation does not imply authorization for later mutations; each later mutation independently repeats the current authorization check.

## Testing Requirements

- Publisher callback test: fresh authorization is fetched and the Gate is re-evaluated for each callback invocation.
- Revocation test: the first mutation is authorized, the central authority changes before a later mutation, and the later mutation plus all subsequent writes are denied.
- Failure tests: authorization GET failure, context revalidation failure, and fresh Gate denial prevent the write.
- Validator/finalizer test: changing result bytes after validation prevents a passed final audit.
- Publisher test: a missing or mismatched final-audit digest prevents invoking the posting adapter.
- Adapter test: a mismatched expected digest prevents all GitHub API calls; matching bytes are parsed and posted successfully.
- Preserve default-deny tests for direct enforce adapter calls, expected-HEAD checks, and existing off/shadow behavior.
- Run the complete workflow-script test suite and `actionlint` for the workflow.

## Scope and Non-Goals

- No change to Owner approval policy, allowed effects, model certification, or enforce activation requirements.
- No atomic instantaneous revocation guarantee; the accepted GET-to-mutation race remains.
- No change to shadow's existing best-effort posting and audit behavior.
- No PR creation, merge, or operational activation is included.

## Acceptance Criteria

1. Every enforce GitHub mutation is preceded by a fresh central authorization read, execution-context revalidation, Gate evaluation, and expected-HEAD verification.
2. A revocation or authority-read failure between two mutations prevents the later mutation.
3. The final audit binds the exact result bytes accepted by the validator.
4. Publisher and adapter reject any result bytes that differ from the validated digest before posting.
5. Direct enforce adapter calls remain denied, while the authorized Publisher path can post.
6. All workflow-script tests and workflow lint pass.
