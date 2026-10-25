# OCR App A/B R2 limited correction — independent review handoff

**Status: `AUTHOR_R2_CORRECTION_IN_PROPOSAL / FRESH_INDEPENDENT_R2_REVIEW_REQUIRED`**

This is an author-side R2 candidate record. It is not an independent PASS, finding closure, G1 acceptance, G2/G3/G4 approval, activation authorization, or merge approval.

## Fixed source and branch

- Repository: `yohi/ocr-app`
- R1 review base: `1c85d4979ae0153f3f5848e9dbf489dc124b98b1`
- R2 branch: `fix/shadow-graphql-post-scope-guards`
- R2 fixed source checkpoint (code, tests, R1 evidence correction, and R2 artifacts): `6aceb8daf1a62d263f45febde9f4e19ecbd59870` (`PERFORMED` and pushed to the approved origin branch).
- A subsequent documentation-only commit records this Handoff's source checkpoint. Its final branch-tip SHA is included in the author's final report; it does not alter the source manifest or test inputs.
- R2 source changes are restricted to `resolve-threads.mjs`, its unit/integration tests, the EVD correction in the existing R1 evidence document, and this new R2 evidence directory.
- R1 `node-tests.log` and `source-manifest.sha256` remain unchanged. B-R1 files, publisher, workflow, Host, Worker, routing authorization, policy, catalog, and schemas are not changed; see `r2-protected-files.md`.

## Finding mapping

| Finding | R2 candidate correction | Author status | Independent review |
| --- | --- | --- | --- |
| `A-R1-001` | Validate all required thread/comment/page fields before bot/resolution filtering. Reject incomplete/null thread and comment nodes; preserve allowed nullable `author`, `line`, `originalLine`, and empty `body`. | `AUTHOR_CORRECTED` | Required |
| `A-R1-002` | Reject invalid/repeated cursors and stop at a fixed 200-page limit. Page 200 may end normally; if it requests another page, fail before request 201 and discard accumulated results. | `AUTHOR_CORRECTED` | Required |
| `A-R1-003` | Production GraphQL transport accepts a strict option; only shadow rejects non-integer/non-2xx statuses and suppresses raw response bodies in parse/transport failures. Off retains the legacy status/parse path. | `AUTHOR_CORRECTED` | Required |
| `A-R1-004` | Shadow reply requires a non-empty string comment ID; resolve requires exact requested thread ID plus `isResolved === true`. Failures stop further mutations/threads, without rollback claims. | `AUTHOR_CORRECTED` | Required |
| `EVD-R1-001` | Existing R1 evidence now records the R1 commit/push as performed and PR/merge as not run, separately. Original R1 logs/manifest are preserved. | `AUTHOR_CORRECTED` | Required |
| `B-R1` | No B implementation or B test changes in R2. | `B_R1_PASS_STATIC_INHERITED_AS_REVIEW_RESULT / NO_R2_CHANGES` | Preserve as R1 result only |

## Test evidence

Node runtime: `v26.10.0`; npm: `11.19.1`.

| Check | Candidate result |
| --- | --- |
| RED, targeted resolver unit + integration tests before production edits | 98 tests; 43 failed as expected; 55 passed; 0 cancelled. Full output: `r2-red.log`. |
| GREEN, targeted resolver unit + integration tests | 98 passed; 0 failed. Full output: `r2-targeted-green.log`. |
| B regression (`post-ocr-comments.test.mjs` + `publish-routing-review.test.mjs`) | 73 passed; 0 failed. Full output: `r2-b-regression.log`. |
| Full `.github/workflows/scripts/*.test.mjs` suite | 651 passed; 0 failed. Full output: `r2-full-script-tests.log`. |
| `actionlint .github/workflows/*.yml` | Passed with no diagnostics; output: `r2-actionlint.log`. |
| `git diff --check` | Passed; output: `r2-diff-check.log`. |
| Off-mode callback interface characterization | RED: 1 failed when off passed an undefined third argument; GREEN: 1 passed after restoring the two-argument callback invocation. Logs: `r2-off-interface-red.log`, `r2-off-interface-green.log`. |

Two initial test-harness attempts were interrupted while bounding the pre-fix repeated-cursor loop and completing the mock HTTP response queue. They are not submitted as verification logs. The definitive bounded RED run is `r2-red.log` and completed with the counts above. Two lines emitted by off-mode tests used static synthetic GraphQL error fixtures; their payload text is replaced with `[synthetic error redacted]` in the saved log. Trailing horizontal whitespace in captured failure output was removed; test names, assertion messages, and pass/fail counts were retained.

## Manifest and complete change

- R1 manifest digest: `sha256:9f937a1d275a64a13a19566fc0c9a11063e40cf3d4ad20c14fe31ba04a1506cd`.
- R2 manifest: `source-manifest-r2.sha256`; its independently recomputed digest is `sha256:ab70ee43934afeb29e497ca180dcab9ac0b57488b74fc055d851f20c52609b2c`.
- R1→R2 source entries (raw file SHA-256):
  - `.github/workflows/scripts/resolve-threads.integration.test.mjs`: `1d8d5fd95e9954c0510471b9da3ddda25f796f2c8d267381931ac78eb546bdd3` → `5f61d4d68193632bd8bb6908d89da42b4e2b50b682f36f43b5dc37262224d669`
  - `.github/workflows/scripts/resolve-threads.mjs`: `c68f670995482a0252d7444c09f3c33e0abd7b7e9a7d9f11b7e5383dc3167256` → `95eb71a36cef1575b4308149f189904bf0a857bc19834cbf713c0a47b73bb482`
  - `.github/workflows/scripts/resolve-threads.test.mjs`: `77a5077902eecc9ae25e267addfb627978f4582eea39620cff61991cbbe98646` → `947221f8048522103db660f97401d4ee0743bd2fbea4f15f5d4ba4663e96eb6a`
- `r2-source-diff.patch` records the tracked R1→R2 source/test/existing-evidence diff; new R2 evidence files are listed separately.
- `r2-artifact-sha256sums.txt` contains SHA-256 digests for the R2 logs, manifest, source diff, start/protected-file records, and corrected R1 evidence (excluding the checksum file and this handoff to avoid self-reference).

## Changed-file inventory

Tracked files changed:

- `.github/workflows/scripts/resolve-threads.mjs`
- `.github/workflows/scripts/resolve-threads.test.mjs`
- `.github/workflows/scripts/resolve-threads.integration.test.mjs`
- `docs/superpowers/evidence/2026-10-25-shadow-thread-graphql-post-scope/implementation-evidence.md`

New files in this R2 evidence directory:

- `r2-actionlint.log`
- `r2-artifact-sha256sums.txt`
- `r2-b-regression.log`
- `r2-diff-check.log`
- `r2-full-script-tests.log`
- `r2-handoff.md`
- `r2-protected-files.md`
- `r2-red.log`
- `r2-off-interface-red.log`
- `r2-off-interface-green.log`
- `r2-source-diff.patch`
- `r2-start.md`
- `r2-targeted-green.log`
- `source-manifest-r2.sha256`

No design/plan, routing-traceability, B implementation/test, publisher, workflow, Host, Worker, authorization implementation/config, policy, catalog, schema, or `master` files were changed.

## Not run / not authorized

- Node.js 20: `NOT_RUN`; no Node 20 executable was available in the environment.
- GitHub Actions: `NOT_RUN`.
- Cloudflare Worker tests: `NOT_RUN`; Worker changes and Worker-side operations are outside scope.
- Real GitHub REST/GraphQL mutation, real PR/thread resolve, and real model Host/Decision API: `NOT_RUN`.
- Owner registries, runtime grants, G1/G2/G3/G4, shadow/enforce activation, formal finding closure, PR creation, and merge: not performed/not authorized.
- Push may trigger repository automation; no manual Actions run was started and no CI result is treated as Gate acceptance.

## Independent review handoff

The independent R2 reviewer should fetch the final pushed branch, pin the 40-character source/final SHA reported by the author, compare it to R1 base `1c85d4979ae0153f3f5848e9dbf489dc124b98b1`, verify all protected-file blob/tree hashes, and assess only A-R1-001–004 and EVD-R1-001. Do not elevate inherited B-R1 `PASS_STATIC` to an R2 pass. The author does not adjudicate formal closure or operational gates.
