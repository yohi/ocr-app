# Task 4: Authoritative Egress Authorization

## Status

Implemented and committed with message `feat(ocr): リポジトリ単位で決定egressを承認`.

## Changes

- Added trusted egress policy configuration with an explicit empty repository allowlist, fixed `openrouter-decisions` destination, policy version, and Owner approval reference format.
- Added the canonical RunBinding/v1 environment parser and strict local/serialized comparisons.
- Added an injected-fetch egress authorization module. It uses a GitHub App bearer token for repository lookup, validates the response fields, classifies visibility, checks exact allowlist identity, approval evidence, checkout origin and run HEAD, and returns only fixed denial reasons on failures.
- Added tests covering RunBinding parsing and comparison and egress authorization/denial cases without real network access.

## Verification

- `node --test .github/workflows/scripts/ocr-run-binding.test.mjs .github/workflows/scripts/authorize-decision-egress.test.mjs` — PASS, 29/29.
- `node --test .github/workflows/scripts/*.test.mjs` — PASS, 213/213.
- LSP diagnostics unavailable: TypeScript installation is absent in this workspace.

## Concerns

- No Owner-approved repositories are enabled; authorization correctly denies all repositories until trusted policy configuration is populated.
- Approval references use the documented `OWNER-<approval-id>` syntax and do not represent an actual approval by themselves.

## Fix round 1/5

- `assertSerializedRunBindingMatches` now validates the three required grant binding fields and validates `effective_mode` strictly only when it is present; local binding validators reject malformed or incomplete inputs.
- Egress authorization validates RunBinding/v1 before granting, rejects contradictory visibility as `visibility_unknown`, validates Owner references using the policy's configured format, tolerates malformed allowlist configuration by denying, and aborts a hanging GitHub API call after 10 seconds.
- Added regression tests for grant-shaped bindings, empty/incomplete bindings, invalid modes and identifiers, contradictory visibility, policy-format mismatches, malformed policy and a hanging fetch.
- `node --test .github/workflows/scripts/ocr-run-binding.test.mjs .github/workflows/scripts/authorize-decision-egress.test.mjs` — PASS, 33/33.
- `node --test .github/workflows/scripts/*.test.mjs` — PASS, 217/217.
