# Routing notification remediation — 2026-10-23 JST

## Scope and assessment

- Scope: TARGET-001 (final Check Run failure reasons) and TARGET-002
  (untrusted exception diagnostics in enforce upload and publication gates).
- Base HEAD: `42d11f5cef6e6c751791982d94daeafb212353ce`.
- Tested source: the **uncommitted working-tree snapshot**, not the base HEAD.
  The [source manifest](2026-10-23-routing-notification-remediation/source-manifest.sha256)
  hashes every tracked file under `.github/workflows/` and `cloudflare-worker/`,
  including the six modified source/test files. There were no untracked source
  files in those roots. Evidence files are outside those roots.
- Source-manifest SHA-256:
  `ff483e234720b4059e0339fe690380278e7a4e1a5da95e89eeb395df7e04041b`.
- Manifest verified after the regression run with `sha256sum --check --quiet`.
- Offline regression: **PASS**, 483 Node tests and 31 Worker tests.
- Full atomic-requirement audit: **PARTIAL**, not performed by this remediation.
- Full G1 acceptance: **NOT_ESTABLISHED**; independent G1 assessment: **NOT_RUN**.
- G2/G3/G4 and shadow/enforce operational activation: **NOT_RUN / NOT_GRANTED**.

This snapshot record does not claim that the unchanged base commit passes the
new suite, and does not reuse the earlier 459-test record as current proof.
It identifies exact tested bytes without inventing a new commit SHA.

## Corrections

### TARGET-001: final Check Run reasons

The completed Check Run receives the gate reason, publisher reason, final HEAD
revalidation outcome, and publisher outcome from the actual workflow steps.
The final reason is selected in this order:

1. Nonempty gate denial reason.
2. Failed final HEAD revalidation: its fixed reason, defaulting to
   `HEAD_VALIDATION_FAILED` if no reason was delivered.
3. Nonempty publisher reason.
4. Failed publisher without an output: `PUBLISH_FAILED`.
5. Otherwise, the fixed fallback `REVIEW_EXECUTION_FAILED`.

Before display, `ARTIFACT_UPLOAD_FAILED` and `MISSING_ARTIFACT_ID` map to
`ROUTING_AUDIT_MISSING`; `HEAD_MISMATCH` maps to `HEAD_CHANGED`. Known activation,
authority, execution-context and attempt denials are accepted by the fixed
allowlist. Unknown strings always map to `REVIEW_EXECUTION_FAILED`.
Internal gate enums and sealed audit records retain their existing meanings.
The final HEAD CLI distinguishes a confirmed mismatch (`HEAD_CHANGED`) from
inability to validate (`HEAD_VALIDATION_FAILED`), emitting only a fixed enum in
enforce mode. Off/shadow CLI diagnostics retain their previous behavior.

### TARGET-002: enforce diagnostics

Upload reauthorization in enforce and the enforce publish gate log only the
fixed denial `ROUTING_ACTIVATION_DENIED`, without interpolating exception
`message` or `code`. Shadow upload diagnostics retain their previous behavior.

A regression also exposed JSON parsing before `publishRoutingReview` was called.
The enforce publisher entrypoint now catches preparation failures, logs the
fixed `PUBLISH_FAILED`, emits that reason, and sets its exit code to failure.
No post is attempted on that path.

## Regression boundaries

The workflow entrypoint tests execute the inline Node bodies extracted from
`ocr-engine.yml`, using controlled filesystem and external-operation adapters.
They resolve the completed step's real Actions output references and pass the
resulting environment into the real `updateCheckRun`, inspecting its PATCH body.
They do not execute GitHub Actions expression evaluation or remote APIs.

Covered negative cases include:

- Failed real publisher adapter result and final HEAD revalidation failure.
- Actual HEAD CLI subprocesses with controlled fetch: SHA mismatch versus API
  exception, including fixed log/output reasons and sentinel suppression.
- HEAD change detected inside the publisher after the workflow recheck.
- Artifact upload failure and missing artifact ID through the real gate.
- Filesystem, JSON parsing, API exceptions, and arbitrary exception codes at
  both authorization catches, using synthetic PR/secret-like sentinel text.
- Publisher preparation JSON failure and failed publisher without outputs.
- Gate denial retained when later publication steps are skipped.
- Unknown public reasons rejected and known trusted denial enums retained.

Existing off/shadow Host tests and publication-success tests remain passing.
A new shadow upload diagnostic test explicitly checks compatibility.

## Commands and retained results

Verification date: 2026-10-23 JST (2026-10-22 UTC); results were inspected before
`2026-10-22T18:57:22Z`. Environment: Linux, Node `v26.10.0`, npm `11.19.1`,
actionlint `v1.7.12`, Vitest `v4.1.10`.

Commands run from the repository root:

```sh
EVIDENCE=docs/superpowers/evidence/2026-10-23-routing-notification-remediation
git ls-files -z -- .github/workflows cloudflare-worker |
  xargs -0 sha256sum > "$EVIDENCE/source-manifest.sha256"
node --test --test-reporter=spec \
  --test-reporter-destination="$EVIDENCE/node-tests.log" \
  .github/workflows/scripts/*.test.mjs
npm test --prefix cloudflare-worker > "$EVIDENCE/worker-tests.log" 2>&1
actionlint .github/workflows/ocr-engine.yml > "$EVIDENCE/actionlint.log" 2>&1
sha256sum --check --quiet "$EVIDENCE/source-manifest.sha256"
git diff --check
```

| Check | Exit | Result | Evidence |
| --- | --- | --- | --- |
| Initial focused RED | 1 | 28 tests: 12 passed, 16 failed | Session output; initial failure details were not retained |
| Final focused suite | 0 | 38 passed, 0 failed | Session output; included in full suite |
| Full workflow Node suite | 0 | 483 passed, 0 failed, 0 skipped | [Node log](2026-10-23-routing-notification-remediation/node-tests.log) |
| Worker suite | 0 | 31 passed | [Worker log](2026-10-23-routing-notification-remediation/worker-tests.log) |
| actionlint | 0 | No diagnostics | [actionlint log](2026-10-23-routing-notification-remediation/actionlint.log) |
| Source-manifest verification | 0 | All listed bytes unchanged | Session output |
| `git diff --check` | 0 | No whitespace diagnostics | Session output |
| `npx --offline markdownlint-cli2` on this record | 0 | 0 issues | Session output |

The publisher-preparation JSON case was observed throwing a `SyntaxError` before
its correction; that intermediate failure is recorded in session output.
Review then identified the conflation of final HEAD API failure with a
confirmed SHA change; three added cases were observed failing before the final
HEAD correction. Read-only follow-up review found no important remaining issue
in that correction. These observations are in session output. The final Node
log covers all final cases. Machine-specific repository
prefixes in RED and Worker logs were replaced with `$REPO_ROOT`; test results and
counts were not changed. [Log digests](2026-10-23-routing-notification-remediation/log-manifest.sha256)
refer to these normalized logs.

## Remaining evidence gaps

Node 20, real Actions execution, live GitHub writes, real Decision API calls,
CLI/model execution, complete atomic traceability, and independent G1 acceptance
remain unverified by this offline run. The base-HEAD-only suite was not rerun;
the new results belong to the source snapshot identified above. No operational
authorization or routing configuration was changed.
