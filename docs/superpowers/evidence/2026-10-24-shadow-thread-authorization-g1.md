# Shadow thread authorization: fixed-source G1 evidence (2026-10-24)

## Verdict and tested revision

- Code under test: `3ad8b4a6499315d439e844f7a60a30b15f1a2dd0`.
- Branch: `fix/shadow-thread-host-reauthorization`.
- Audited predecessor: `c899e51d939ec3f37aa0fb9408e902e98b10bc30`.
- Offline regression suite: **PASS**, 569 Node tests and 31 Worker tests.
- Exact-name mapped regressions: **PASS**, 47 unique file/name pairs.
- Full G1 acceptance: **PARTIAL / NOT_ESTABLISHED**.
- Complete atomic-requirement audit: **PARTIAL**.
- Independent G1 assessment: **NOT_RUN**.
- G2/G3/G4 and shadow/enforce operational activation: **NOT_RUN / NOT_GRANTED**.

The source commit was created before evidence capture. Its commit object exists locally, and both tracked
and untracked status were clean at capture start. This record and its logs are a later documentation-only
commit, not part of the tested revision. No self-referential evidence-commit SHA is claimed.

Capture window: `2026-10-24T14:50:59.952Z` through `2026-10-24T14:51:19.389Z`
(23:50:59 through 23:51:19 JST). Exact-name checks and document validation followed;
their timestamps are in [verification.json](2026-10-24-shadow-thread-authorization-g1/verification.json).
Environment: Linux, Node `v26.10.0`, npm `11.19.1`, actionlint `v1.7.12`, Vitest `v4.1.10`,
markdownlint-cli2 `v0.24.0`. Node 20 execution and GitHub Actions execution were **NOT_RUN**.

## Finding assessment and limited plan approval

All script/test paths in this section are relative to `.github/workflows/scripts/`.

| Finding | Assessment and correction | Executed proof |
| --- | --- | --- |
| FND-PLAN-001 | Historical plan deviation confirmed. The Owner explicitly accepted the limited resolver exception on 2026-10-24. Earlier prohibitions and the historical deviation remain recorded. | [Approved exception](../plans/2026-10-21-pr-dynamic-routing-remediation.md#2026-10-24-drift-follow-up-approved-limited-resolver-exception) in the tested commit. This is not an independent finding-closure decision. |
| FND-STATUS-001 | Confirmed: Host authorization refusal/exception previously returned CLI success. The resolver now records denial, stops subsequent threads, and exits 1. | `resolve-threads.test.mjs`: first-attempt refusal, authority exception, and retry revocation; `resolve-threads.integration.test.mjs`: actual CLI denial fails the Check despite a successful main review offline. |
| FND-SCOPE-001 | Confirmed defense gap, without a demonstrated production exploit. Non-off invocation now validates CLI repo and `TARGET_REPO` before thread fetch. Names match case-insensitively; missing, malformed or different targets deny. Enforce direct invocation also denies. | `resolve-threads.test.mjs`: mismatch/missing/malformed scope and enforce rejection; integration tests exercise authorized case-insensitive shadow and legacy off behavior. |

The actual resolver CLI test starts a separate Node process with the production resolver, fetcher and Host.
Only external GitHub/process I/O is replaced. Missing fresh authority prevents Host spawn and thread mutation;
the CLI exits 1. The test feeds that outcome through the workflow's job-status-to-conclusion mapping into the
production Check updater, which emits `failure` even when the main review result was `success`.
The GitHub Actions scheduler itself was not executed.

The Owner's statement, "承認します", accepts the limited plan exception. It does not approve all prior plan-level
contracts, issue operational dossiers, certify this G1 record, or grant routing activation.
The per-effect freshness and already-running Host limitations remain in force.

## Commands and retained results

All commands ran at the repository root, sequentially. Git commands used `GIT_MASTER=1`.
The Node glob below was expanded into the explicit, sorted list of 39 test files recorded in `verification.json`.

| Command | Exit | Result | Log |
| --- | --- | --- | --- |
| `npm ci --prefix .github/workflows --ignore-scripts` | 0 | Locked dependencies installed | [workflow install](2026-10-24-shadow-thread-authorization-g1/npm-ci-workflow.log) |
| `node --test .github/workflows/scripts/*.test.mjs` | 0 | 569 passed, 0 failed, 0 skipped | [Node](2026-10-24-shadow-thread-authorization-g1/node-test-workflow.log) |
| `npm ci --prefix cloudflare-worker --ignore-scripts` | 0 | Locked dependencies installed | [Worker install](2026-10-24-shadow-thread-authorization-g1/npm-ci-worker.log) |
| `npm test --prefix cloudflare-worker` | 0 | 31 passed, 1 test file | [Worker](2026-10-24-shadow-thread-authorization-g1/worker-test.log) |
| `actionlint .github/workflows/ocr-engine.yml` | 0 | No diagnostics | [actionlint](2026-10-24-shadow-thread-authorization-g1/actionlint.log) |
| `git diff --check` | 0 | No diagnostics | [diff check](2026-10-24-shadow-thread-authorization-g1/git-diff-check.log) |
| `node --test --test-name-pattern='<escaped exact name anchored with ^ and $>' <mapped file>` | 0 each | All 47 unique mapped names executed and passed | [mapped tests](2026-10-24-shadow-thread-authorization-g1/mapped-assertions.log) |
| `npx --offline markdownlint-cli2 <three changed documents>` | 0 | Plan, historical evidence link, and this record validated | [Markdown](2026-10-24-shadow-thread-authorization-g1/markdownlint.log) |

Each mapped test's exact argv, exit code and pass/fail/skipped counts are in `verification.json`.
The traceability validator also runs every mapped name; it now matches escaped, anchored names rather than
assuming a parameterized test's runtime name must occur literally in source.
Its initial pre-commit failure on a generated name was observed during this follow-up, not reconstructed as a
historical log. The retained logs capture the fixed, committed GREEN revision.

Both dependency installations reported existing audit findings: workflow dependencies, 1 moderate;
Worker dependencies, 3 moderate and 10 high, with deprecated-package notices. These are install output,
not an independently verified vulnerability assessment. No dependency changes were made in this follow-up.

Logs retain sanitized stdout followed by stderr, so cross-stream chronology is not asserted. ANSI color was
removed; machine-specific workspace/home paths were replaced with `[workspace]` / `[home]`.
Extra blank lines at the end of the mapped-test and Worker logs were removed for Git whitespace checks.
Empty lint logs mean no diagnostics; exit status is recorded separately. All retained files, including metadata,
are covered by [log-manifest.sha256](2026-10-24-shadow-thread-authorization-g1/log-manifest.sha256).

The [initial Markdown run](2026-10-24-shadow-thread-authorization-g1/markdownlint-initial.log) exited 1 because
the added historical notice separated consecutive blockquotes with a blank line (MD028). The separator was
corrected in documentation only; the final Markdown run above passed. Both outcomes remain in the metadata.

## Source identity and evidence integrity

Production `hashRoutingSourceManifest` returned the same digest before and after dependency installation and
all suite checks:

```text
sha256:ca83d488596531500a675b69a6c50e66865ac01bc1ec4972f31f8399ecf25ce3
```

The function covers its seven fixed runtime/configuration paths and every tracked file under
`.github/workflows/scripts/`, including the new integration test and traceability validator.
Documentation/evidence and the traceability JSON are outside that function's selected paths. Their input hashes
are recorded separately; a matching runtime manifest alone does not prove all documentation/configuration bytes.
Tracked source remained clean at the end of suite capture. Documentation finalization rechecked the source
manifest and fixed HEAD without rerunning or relabeling the suites.

| Additional input | SHA-256 |
| --- | --- |
| Current Design | `e0e389e5908c9606a9e2de94e912fda0312ac7822c20fb617ffe3ec6c4687304` |
| Accepted remediation plan | `e04bd60602321f2ab6f67d8bdc3ea348dbd3943b592af89f7e421a674802c6f7` |
| Updated traceability matrix | `747d73c289fa69d7272b02743c93a40503601a11b0c1f6b892964850a2c74ed2` |
| Startup authorization registry | `1aeed895c9283a489dede73b32bf5b718d7fcb6ecef65069bd992b4a7a17f71d` |

Policy, model catalog, certification-index and Worker package/lock digests are also in `verification.json`.
The historical [2026-10-21](2026-10-21-pr-dynamic-routing-g1.md) and
[2026-10-22](2026-10-22-routing-drift-remediation-g1.md) results remain tied to their own tested revisions.

## Approval consistency and remaining gates

The current central `master` registry was read with a GitHub **GET**, not a mutation:

```sh
gh api --method GET 'repos/yohi/ocr-app/contents/.github/workflows/config/routing-authorization.json?ref=master'
```

The response was observed at `2026-10-24T14:51:19.375Z`; its Git blob SHA is
`7da342b849b561ff97f1f1298181de28e2060fee`. Decoded bytes match the tested local registry exactly.
The [retained response](2026-10-24-shadow-thread-authorization-g1/central-registry-read.log) and metadata
distinguish this live read from the fixed source checkout. It is a point-in-time observation, not a durable grant.

| Authority/input | Observed state | Consequence |
| --- | --- | --- |
| Limited resolver plan exception | Owner accepted, recorded in fixed source commit | The missing exception approval is resolved prospectively; historical deviation remains documented. |
| Local and live central startup registry | 0 approvals, 0 activations; byte-identical | No registry-backed shadow/enforce authorization exists to bind to this source manifest. |
| Decision egress policy | 0 allowed repositories | No per-repository Decision egress grant is established. |
| Certification index | 0 certifications, null CLI inventory | No production model/CLI certification is established. |
| Independent G1 approval | Not established by this record | The local suite PASS is not independent approval or complete acceptance. |

The matrix retains 39 IDs: **2 COVERED, 32 PARTIAL, 5 NOT_RUN**. T-023, T-027 and REM-002 gain executed
regression mappings without status promotion. Thirteen IDs still have no exact-name assertion mapping:
T-007, T-009, T-013, T-014, T-017, T-018, T-019, T-022, T-025, T-026, T-030, T-034 and REM-005.
The successful Worker/Node/lint runs are cross-suite evidence, not a substitute for each atomic requirement's
mapping; T-017's matrix status is therefore not silently promoted. Existing PARTIAL mappings also retain their
explicit limits. Historical pre-dependency execution and live model/permission assertions cannot be inferred.

Before activation, complete the remaining acceptance mapping and independent assessment, then obtain the
required stage-specific operational dossiers/grants bound to the exact source-manifest, policy and catalog
digests. Neither the plan exception nor these logs supply those grants. No Decision/model execution, PR/thread
mutation, artifact upload, deployment, workflow rerun, remote push or merge occurred during evidence capture.
