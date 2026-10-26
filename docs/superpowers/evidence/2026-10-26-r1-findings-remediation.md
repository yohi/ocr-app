# PR #100 R1 Findings Remediation Evidence

- Date: 2026-10-26
- Branch: `fix/shadow-graphql-post-scope-guards`
- Base Commit (Pre-correction HEAD): `6b08251170265c444ce8957377e6bfca23b21fd7`
- PR: `#100`

## Remediation Summary

### FND-100-R1-001 (Safe rejection of review thread comments exceeding 50 items)
- In `.github/workflows/scripts/resolve-threads.mjs`:
  - Updated GraphQL `comments(first: 50)` query to request `pageInfo { hasNextPage }`.
  - Added strict shape and boolean validation of `comments.pageInfo` in `validateReviewThread`.
  - Fail-closed if `pageInfo` is missing, malformed, or if `hasNextPage !== false` (`hasNextPage === true` rejects with `THREAD_FETCH_FAILED`).
  - Halts execution immediately, preventing any partial thread payload from reaching the LLM host and avoiding any mutations across all threads.
  - Preserves normal behavior for thread comments <= 50 (`hasNextPage === false`) and preserves compatibility with off-mode.

### FND-100-R1-002 (Revalidate PR HEAD before review thread mutations)
- In `.github/workflows/ocr-engine.yml`:
  - Added pre-validation step `Revalidate PR head before thread resolution` (`id: validate-head-before-resolve`) running `check-pr-head.mjs` before `Resolve fixed review threads`.
  - Guarded thread resolution execution with `steps.validate-head-before-resolve.outcome == 'success'`.
  - Passed trusted `EXPECTED_SHA: ${{ github.event.client_payload.commit_sha }}` from workflow event payload.
  - Retained existing post-resolver step `Revalidate PR head before publishing` (`id: validate-head`).
- In `.github/workflows/scripts/resolve-threads.mjs`:
  - Injected `checkHead = fetchCurrentHead` dependency in `run()`.
  - Added `verifyHead` checks immediately before GraphQL `addPullRequestReviewThreadReply` mutation and independently before `resolveReviewThread` mutation when `EXPECTED_SHA` is provided.
  - Verifies `EXPECTED_SHA` format (40 hex characters) and checks that `currentHead === expectedSha`.
  - Aborts on mismatch, fetch error, or malformed expected SHA with non-zero exit code (`operationFailed = true`, `break`).
  - Prevents subsequent thread mutations on verification failure.
  - Sanitizes output: does not leak untrusted tokens or responses.
  - Note: REST HEAD GET and GraphQL POST mutations are independent GitHub API calls; pre-mutation verification minimizes the race condition window but does not provide distributed atomicity.

## File Manifest (SHA-256)

```
c32dbf1ebdee27be028401815b920042b0501890ca67f46f823f85a14ef17253  .github/workflows/ocr-engine.yml
f81bcd969769e9a321629c47ab595d8a7d69fdd5c9b1d99b765ed90e6c05bf90  .github/workflows/scripts/resolve-threads.mjs
1991ad319ceab7f6259fabb522a145b267716895a003b5652b86280291786d8e  .github/workflows/scripts/resolve-threads.test.mjs
54d453eed34b752cd27b20bd06ea997b310becce46eb0a3e3666f14157b1f5ac  .github/workflows/scripts/resolve-threads.integration.test.mjs
```

## Verification

- **Script Test Suite**: `node --test .github/workflows/scripts/*.test.mjs`
  - Tests: 662
  - Pass: 662
  - Fail: 0
  - Duration: ~10s
- **Resolver Unit & Integration Tests**:
  - `node --test .github/workflows/scripts/resolve-threads*.test.mjs`: 101 tests pass (0 fail).
- **Workflow Actionlint**: `actionlint .github/workflows/*.yml` -> 0 errors.
- **Git Diff Format**: `git diff --check` -> Clean (no trailing whitespace or conflict markers).
- **Runtime Environment**: Node.js `v26.10.0` (Linux x86_64). Node.js 20 binary was not locally installed in this environment.
