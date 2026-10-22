# Routing notification follow-up — 2026-10-23 JST

## Scope and revision

- Addresses DOC-NTF-001 and TARGET-NTF-001/002/003 from the read-only audit.
- Base revision: `0a42550e4c191d62c4c8bb90cbf3f734ba40f52d`.
- Code revision: `925a2d8f045937b147f75644511864ee9a30f93e`.
- Tests ran against the working-tree source subsequently committed unchanged as
  the code revision. A post-commit diff against that revision confirmed identical
  source under `.github/workflows/` and `cloudflare-worker/`.
- The [source manifest](2026-10-23-routing-notification-follow-up/source-manifest.sha256)
  identifies all 85 tracked files under those roots, including the new CLI test.
  Its SHA-256 is `8dcf9b13834717eafd34476669a8436dff99389d0a85fe31e2ae483e1a5ea32f`.
- This document is a later evidence revision, not part of the code revision.
  The [original 483-test record](2026-10-23-routing-notification-remediation.md)
  and its source/log manifests remain historical evidence of that earlier source.

## Finding disposition

| Audit ID | Correction | Verification boundary |
| --- | --- | --- |
| DOC-NTF-001 | Original notification evidence uses NOTIFY-001/002; TARGET-001/002 retain their original plan meanings. | Documentation inspection and Markdown lint. |
| TARGET-NTF-001 | Startup writes a fixed denial reason. Completion receives startup reason/outcome as the lowest-priority failure fallback; failed startup without outputs also reports ROUTING_ACTIVATION_DENIED. | Real startup output file is passed through actual YAML output references into the real Check Run PATCH builder. |
| TARGET-NTF-002 | Publisher HEAD retrieval exceptions return HEAD_VALIDATION_FAILED. A confirmed mismatch remains internal HEAD_MISMATCH, displayed as HEAD_CHANGED. | Production publisher entrypoint reports distinct reasons and invokes no posting adapter on either HEAD failure path. |
| TARGET-NTF-003 | Enforce Check Run CLI failures log only CHECK_UPDATE_FAILED and exit 1. | Actual CLI subprocesses cover malformed JSON, file read failure, HTTP rejection and network exceptions. |

Gate denial, workflow HEAD failure, publisher reason and publisher-outcome fallback
all retain precedence over startup failure. Every displayed reason still passes
the fixed public allowlist. Startup authorization and publication conditions are
unchanged. Off/shadow Check Run exception diagnostics retain their prior behavior.

The original notification evidence's NOTIFY-001/002 are not replacements for the
remediation plan's TARGET-001/002 or the audit's TARGET-NTF IDs.

## Executed checks

Verification completed before `2026-10-22T19:24:17Z` (2026-10-23 JST), apart from
the subsequent manifest, documentation and Git checks. Environment: Linux,
Node `v26.10.0`, npm `11.19.1`, actionlint `v1.7.12`, Vitest `v4.1.10`.

| Check | Exit | Observed result | Retained evidence |
| --- | --- | --- | --- |
| Initial focused RED | 1 | 40 tests: 33 passed, 7 failed for the audited notification defects | Session output only |
| Focused notification/startup/publisher suite | 0 | 65 passed, 0 failed | Session output; tests included in full log |
| Full workflow Node suite | 0 | 497 passed, 0 failed, 0 skipped | [Node log](2026-10-23-routing-notification-follow-up/node-tests.log) |
| Worker suite | 0 | 31 passed | [Worker log](2026-10-23-routing-notification-follow-up/worker-tests.log) |
| actionlint | 0 | No diagnostics | Session output only |
| Node syntax checks for all five changed/new JavaScript files | 0 | No diagnostics | Session output only |
| Source-manifest verification | 0 | All 85 listed files match | Session output only |
| Markdown lint on this record and the corrected original record | 0 | 0 errors | Session output only |
| `git diff --check` | 0 | No whitespace diagnostics | Session output only |

Commands run from the repository root:

```sh
node --test .github/workflows/scripts/ocr-routing-entrypoints.test.mjs .github/workflows/scripts/update-check-run-cli.test.mjs
node --test .github/workflows/scripts/ocr-routing-entrypoints.test.mjs .github/workflows/scripts/update-check-run-cli.test.mjs .github/workflows/scripts/authorize-routing-start.test.mjs .github/workflows/scripts/publish-routing-review.test.mjs .github/workflows/scripts/update-check-run.test.mjs
node --test --test-reporter=spec --test-reporter-destination=docs/superpowers/evidence/2026-10-23-routing-notification-follow-up/node-tests.log .github/workflows/scripts/*.test.mjs
npm test --prefix cloudflare-worker
actionlint .github/workflows/ocr-engine.yml
node --check .github/workflows/scripts/authorize-routing-start.mjs
node --check .github/workflows/scripts/publish-routing-review.mjs
node --check .github/workflows/scripts/update-check-run.mjs
node --check .github/workflows/scripts/ocr-routing-entrypoints.test.mjs
node --check .github/workflows/scripts/update-check-run-cli.test.mjs
GIT_MASTER=1 git ls-files -z -- .github/workflows cloudflare-worker | xargs -0 sha256sum > docs/superpowers/evidence/2026-10-23-routing-notification-follow-up/source-manifest.sha256
sha256sum --check --quiet docs/superpowers/evidence/2026-10-23-routing-notification-follow-up/source-manifest.sha256
npx --offline markdownlint-cli2 docs/superpowers/evidence/2026-10-23-routing-notification-remediation.md docs/superpowers/evidence/2026-10-23-routing-notification-follow-up.md
GIT_MASTER=1 git diff --check
```

The Worker log reproduces the observed terminal output with its machine-specific
repository prefix replaced by `$REPO_ROOT`. The Node log is the test reporter's
direct output. [Log digests](2026-10-23-routing-notification-follow-up/log-manifest.sha256)
bind these files and the source manifest.

## Assessment limits

- Offline regression for these notification changes: **PASS**.
- Full atomic-requirement audit: **PARTIAL**; the 39-ID traceability matrix is
  unchanged and is not a denominator for all atomic requirements.
- Full G1 acceptance: **NOT_ESTABLISHED**. Independent G1 acceptance: **NOT_RUN**.
- Node 20, real Actions condition evaluation and live Check Run/PR API mutations
  were not exercised by these tests; HTTP operations use controlled adapters.
- Owner grants, model certification, Decision API permissions, and G2/G3/G4 or
  shadow/enforce operational activation are not established by these results.
