# PR #100 R2 Finding Remediation Evidence

- Date: 2026-10-26
- Branch: `fix/shadow-graphql-post-scope-guards`
- Base Commit (Pre-correction HEAD): `fa3f8cd1e943887d886f1be836b0aeaecd34b26d`
- PR: `#100`

## Remediation Summary

### FND-100-R2-001 (Enforce EXPECTED_SHA verification in shadow mode mutations)
- In `.github/workflows/scripts/resolve-threads.mjs`:
  - Updated `verifyHead` guard:
    - In `shadow` mode (`strictGraphqlFailure === true`), `EXPECTED_SHA` is strictly required before mutations.
    - If `EXPECTED_SHA` is unset, not a string, empty string, or does not match 40-hex pattern, throws `HEAD_VALIDATION_FAILED`.
    - Reply and Resolve mutations are strictly prohibited without verified matching HEAD.
    - If HEAD check fails, halts execution immediately (`operationFailed = true`, `break`) and exits non-zero, preventing subsequent thread mutations.
    - If threads list is empty, exits cleanly without invoking HEAD checks or mutations.
    - In `off` mode, preserves backward compatibility: if `EXPECTED_SHA` is provided, enforces HEAD match; if omitted in `off`, preserves legacy behavior. In production workflow (`ocr-engine.yml`), `EXPECTED_SHA: ${{ github.event.client_payload.commit_sha }}` is explicitly provided to both the pre-validation step and the thread resolver step.
    - HEAD check exceptions and token details remain sanitized and are never leaked to logs.

## File Manifest (SHA-256)

```
2b2c57823011d1521de0963185af93e7a1cfd0e86bd868f6bb19aa19a01955fa  .github/workflows/scripts/resolve-threads.mjs
4e44b153227faf1c7f324bb22562c687da18947233a91759e5c64367a285164b  .github/workflows/scripts/resolve-threads.test.mjs
605991a890239f1ad519a3b10542fc4a9039476595c734d8214403e16e0d6680  .github/workflows/scripts/resolve-threads.integration.test.mjs
```

## Verification

- **Script Test Suite**: `node --test .github/workflows/scripts/*.test.mjs`
  - Tests: 665
  - Pass: 665
  - Fail: 0
  - Duration: ~10s
- **Resolver Unit & Integration Tests**:
  - `node --test .github/workflows/scripts/resolve-threads*.test.mjs`: 112 tests pass (0 fail).
    - Unit (`resolve-threads.test.mjs`): 107 tests pass.
    - Integration (`resolve-threads.integration.test.mjs`): 5 tests pass.
- **Workflow Actionlint**: `actionlint .github/workflows/*.yml` -> 0 errors.
- **Git Diff Format**: `git diff --check` -> Clean (no trailing whitespace or conflict markers).
- **Runtime Environment**: Node.js `v26.10.0` (Linux x86_64).
