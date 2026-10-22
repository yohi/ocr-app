# Routing drift remediation verification — 2026-10-22

## Assessment and code identity

- Audited base commit: `9ef52beabf267510c31bea71ca0d459b568cc1ea`.
- Tested code: remediation commit `9acbf8d09f337d1225703a04c0f5cdf723d4f63e` on
  `fix/ocr-routing-drift-remediation`.
- This verification record is a later documentation-only commit; it is not part
  of the tested source revision.
- Offline regression-suite result: **PASS** — 459 Node tests and 31 Worker tests.
- Full G1 acceptance result: **PARTIAL / NOT_ESTABLISHED**.
- Independent G1 assessment: **NOT_RUN**.
- Complete atomic-requirement audit: **PARTIAL**.
- G2/G3/G4 and shadow/enforce operational activation: **NOT_RUN / NOT_GRANTED**.

The suite result does not certify every acceptance assertion or grant permission
to activate routing. A clean, fixed remediation revision and complete offline
assertion coverage are still prerequisites for a full G1 claim. This record does
not relabel tests from `5564145fdd4ffcef57de8f109771fe3ca1817540` as current-code proof.

The tested candidate source-manifest digest, measured before and after the final
checks, was identical:

```text
sha256:f869d37d140be3aaa69b07aabfdf97a3e0c49853b41ccd5a4ad7bdf80ef02872
```

This uses `hashRoutingSourceManifest` over its fixed runtime/configuration paths
and all workflow scripts, including the new modules and tests. It is a
byte-identity record, **not** an operational approval digest or a claim that the
checkout is clean.

Related input digests (SHA-256):

| Input | Digest |
| --- | --- |
| Design R4 | `cca8d3ec01d49f0760ca3c4d6204b56bec8833a9fb8f48cc18d535d2273bfe59` |
| Updated traceability matrix | `9ffd03d914dc853817d4615ff322a6b0fd11da342de187708fddc94d0f8ef356` |

## Finding-to-regression record

All test paths below are under `.github/workflows/scripts/`.

| Finding | Correction | Executed regression |
| --- | --- | --- |
| FND-001 | Upload exactly decision, attempts and final; exclude private context | `ocr-routing-entrypoints.test.mjs`: routing artifact upload contains exactly the three public audit files |
| FND-002 | Inject the real poster into the single publisher; report success only afterward | `ocr-routing-entrypoints.test.mjs`: production publisher never reports published before a failed real post; production publisher reports success only after its single real posting adapter succeeds |
| FND-003 | Require passed review and HEAD validation for skip as well as nonempty review | `evaluate-routing-publish.test.mjs`: zero-review normal skip is eligible but scope-gap skip is not |
| FND-004 | Fresh authorization precedes the missing-route shadow fallback | `run-routing-review.test.mjs`: shadow missing route cannot bypass freshly revoked activation |
| FND-005 | Delay preparation/model-validator imports until routing needs them | `run-routing-review.test.mjs`: off runs in a clean process with routing dependencies unavailable; production off Host entrypoint in `ocr-routing-entrypoints.test.mjs` |
| FND-006 | Supply protected ref, fetch, time and the central token at runtime authority boundaries | Production shadow Host and skip Gate entrypoints in `ocr-routing-entrypoints.test.mjs` |
| FND-007 | Pass run path, selected route and revalidated certification bundle to finalization | Production finalizer entrypoint in `ocr-routing-entrypoints.test.mjs`; canonical Host stream in `routing-audit-contract.test.mjs` |
| FND-008 | Keep skip attempts zero bytes and allow that stream through upload reauthorization | Zero-review recorder in `routing-audit-contract.test.mjs`; production upload reauthorization in `ocr-routing-entrypoints.test.mjs` |
| FND-009 | Authorized shadow observation failure can continue legacy Host without consuming a missing context | Missing-route/context regression in `run-routing-review.test.mjs`; production shadow Host entrypoint |
| DOC-001 | Qualify the historical overall PASS and retain explicit current coverage gaps | Correction notice in the historical record; this scoped record and updated traceability mappings |

The attempt artifact now contains only the nine fields of
`ReviewAttemptEvent/v1` and the three Host event types. It contains no synthetic
startup/publication records or GitHub `run_attempt` fields. Run/HEAD/mode identity
remains in the separately validated decision, route, private context and final
audit. The finalizer compares the supplied attempt sequence with the on-disk
sequence. Tests reject mismatched opaque attempt IDs, reordered/incomplete
events, post-success attempts, invalid models and invalid fallback order.

New regressions were observed failing before their owning corrections: skip
validation, shadow missing-route authorization/continuation, clean-process off
imports, nine-key event serialization, production finalizer wiring, zero-byte
upload authorization, publication output order and the four-file upload list.
Those RED results were session observations; they are not reconstructed as
historical log files. The retained logs below record the final GREEN run.

## Commands and results

Verification window: 2026-10-22, following the source-manifest measurement at
`2026-10-22T10:55:22Z`. Environment: Linux, Node `v26.10.0`, npm `11.19.1`,
actionlint `v1.7.12`, Vitest `v4.1.10`.

| Command | Exit | Result | Log |
| --- | --- | --- | --- |
| `node --test --test-reporter=spec --test-reporter-destination=docs/superpowers/evidence/2026-10-22-routing-drift-remediation-g1/node-test-workflow.log .github/workflows/scripts/*.test.mjs` | 0 | 459 passed, 0 failed, 0 skipped | [Node](2026-10-22-routing-drift-remediation-g1/node-test-workflow.log) |
| `npm test --prefix cloudflare-worker` | 0 | 31 passed | [Worker](2026-10-22-routing-drift-remediation-g1/worker-test.log) |
| `actionlint .github/workflows/ocr-engine.yml` | 0 | No diagnostics | [actionlint](2026-10-22-routing-drift-remediation-g1/actionlint.log) |
| `git diff --check` | 0 | No whitespace errors | [diff check](2026-10-22-routing-drift-remediation-g1/git-diff-check.log) |
| `npx --offline markdownlint-cli2 docs/superpowers/evidence/2026-10-21-pr-dynamic-routing-g1.md docs/superpowers/evidence/2026-10-22-routing-drift-remediation-g1.md` | 0 | 0 issues (markdownlint-cli2 0.24.0) | Observed command output |

The Worker log replaces the machine-specific workspace root with `[workspace]`.
Its shell pipeline uses `pipefail` to retain the actual test exit status. Empty
lint/diff logs mean no diagnostics; their successful command outcomes were
observed separately. Log hashes are in the
[manifest](2026-10-22-routing-drift-remediation-g1/log-manifest.sha256).

Dependencies already existed locally; no dependency installation or remote CI
run was performed. Node 20 execution was **NOT_RUN** in this environment.

## Remaining evidence and authorization limits

The canonical acceptance mapping remains
`.github/workflows/config/routing-traceability.json`. Its 39 IDs retain their
meanings and their honest status: 2 COVERED, 32 PARTIAL and 5 NOT_RUN. New targeted
regressions extend the mappings without converting partial acceptance coverage
into an overall PASS. Historical pre-dependency evidence and unmapped assertion
gaps have not been invented or retroactively executed.

Owner acceptance of plan-level contracts is not established by this test run.
Startup approvals/activations and the egress allowlist remain empty; model
certifications remain pending and the certification index remains empty.
The fixes do not issue any approval or change the default `off` mode.

External effects were simulated. There was no actual Decision request, model
execution, PR publication, routing artifact upload, deployment or GitHub write.
These tests do not prove live permissions, cancellation of already-running
effects, atomic revocation, provider model identity or runtime readiness.
