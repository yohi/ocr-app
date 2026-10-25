# Shadow thread GraphQL and publisher scope candidate evidence (2026-10-25)

## Status

`AUTHOR_IMPLEMENTATION_READY_FOR_INDEPENDENT_REVIEW`

This is an author implementation candidate only. No independent PASS, formal Gate acceptance, or runtime activation is claimed.

## Starting point

- Required base SHA: `cabf66411018c8a3ff1ff9b702a4df0781a0832c`
- Starting HEAD in candidate worktree: `cabf66411018c8a3ff1ff9b702a4df0781a0832c`
- Starting branch: `fix/shadow-graphql-post-scope-guards`
- Candidate branch was created from the required base; initial `git status --porcelain=v1` was empty.
- Protected checkout remained on `master` at `ce477332aaef8068a94cfc8cc7343971ae045488`. Its user-provided handoff file was untracked at start and was left untouched.
- At initial evidence capture, candidate HEAD was still the base SHA and the implementation had not yet been committed.
- The implementation was subsequently committed as `79eb1c39e2400e43af3bd450afce0c77f1bfa111` and pushed to `origin/fix/shadow-graphql-post-scope-guards`.
- Before adding the four evidence artifacts, `git diff --stat cabf66411018c8a3ff1ff9b702a4df0781a0832c` reported 9 tracked source/config/design files, 444 insertions, and 19 deletions.

## Implemented candidate scope

### A — `TARGET-NEW-001`

`resolve-threads.mjs` now injects its GraphQL function through the thread fetch path. Only `shadow` uses strict GraphQL handling: fetch/transport/API errors, malformed required thread data or pagination, and reply/resolve errors fail with exit code 1. Pagination failure discards accumulated partial threads before Host processing. Mutation failure stops remaining thread handling. A valid empty thread list remains exit 0. Reauthorization refusal and exception remain fail-closed. `off` retains the legacy fetch and mutation error behavior.

### B — `UNV-NEW-002`

`post-ocr-comments.mjs` validates `--repo` and `TARGET_REPO` before result processing and any GitHub API access in `shadow` and `enforce`. Both must be ASCII `owner/repo` strings and match case-insensitively. Missing, malformed, unequal, or unknown-mode values throw a fixed scope error before the injected authorization callback or API adapter can run. `off` bypasses the new guard. The enforce publisher regression asserts that `publish-routing-review.mjs` passes the same `TARGET_REPO` value in its CLI args and environment while preserving its gate.

The design and remediation plan contain dated, limited A/B exception addenda. Their original restrictions remain in force outside the exact exception scope. The design digest in `routing-traceability.json` was refreshed because the design addendum changed that file's bytes.

## Test-first evidence

- Baseline before implementation: resolver unit + posting adapter suites, `71/71` passed; resolver integration suite, `3/3` passed.
- A regression tests were run before production changes and failed on the expected shadow fetch, pagination, malformed-response, transport, and mutation failure behaviors. The final red run reported `10` failing tests.
- B regression tests were run before production changes and failed on the five expected scope-mismatch / missing / malformed / unknown-mode cases. The final red run reported `5` failing tests.
- After implementation, targeted A/B, integration, adapter, and publisher tests passed: `114/114`.

## Final verification

All commands below were run locally with Node `v26.10.0` and npm `11.19.1` unless stated otherwise.

| Command | Result |
| --- | --- |
| `node --test .github/workflows/scripts/resolve-threads.test.mjs .github/workflows/scripts/resolve-threads.integration.test.mjs .github/workflows/scripts/post-ocr-comments.test.mjs .github/workflows/scripts/publish-routing-review.test.mjs` | PASS, 114 tests, 0 failed |
| `node --test .github/workflows/scripts/*.test.mjs` | PASS, 594 tests, 0 failed; complete combined output is in `node-tests.log` |
| `actionlint .github/workflows/*.yml` | PASS, no diagnostics; output is in `actionlint.log` |
| `git diff --check` | PASS, no whitespace errors |
| `node --test .github/workflows/scripts/routing-traceability.test.mjs` | PASS, 1 test, 0 failed after updating the pinned design digest |

Captured artifact digests: `node-tests.log` = `a46674b2ace1f82627f4af9d97e88e5c0d0113b6d95e154b0f783c922b08336c`; `actionlint.log` = `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty stdout on success); `source-manifest.sha256` = `9f937a1d275a64a13a19566fc0c9a11063e40cf3d4ad20c14fe31ba04a1506cd`.

`node --test` and actionlint tests were offline; their external effects were stubbed or absent. The workflow-local Ajv dependency was installed from npm's local cache with `npm install --offline --no-save --package-lock=false`; no package manifest or lockfile was changed. A Cloudflare Worker `npm install --offline` was attempted but could not run because `@octokit/auth-app` was not cached (`ENOTCACHED`); Worker tests are `NOT_RUN`.

## Not run / authority boundaries

- Node.js 20: `NOT_RUN`; no `node20`, `node20.19`, or `node20.18` executable is available. The active runtime is Node `v26.10.0`.
- GitHub Actions / live Check Run: `NOT_RUN`.
- Real GitHub REST/GraphQL, PR/thread writes, resolve operations, and model Host: `NOT_RUN`.
- Owner registry, runtime grants, shadow/enforce activation, G1/G2/G3/G4 gate operations: `NOT_RUN`.
- Push, PR creation, and merge: `NOT_RUN`.
- Markdown lint: `NOT_RUN`; no `markdownlint-cli2` or `markdownlint` executable was available.

## Fixed-source manifest

Manifest definition follows the remediation plan: sorted tracked `.github/workflows/scripts/**` plus fixed workflow, package, routing policy, egress policy, model catalog, and catalog schema paths; each line is `<path> <raw-file-sha256>\n`, and the manifest digest is SHA-256 of those UTF-8 lines.

- Base (`cabf66411018c8a3ff1ff9b702a4df0781a0832c`): `sha256:ca83d488596531500a675b69a6c50e66865ac01bc1ec4972f31f8399ecf25ce3`
- Candidate worktree: `sha256:9f937a1d275a64a13a19566fc0c9a11063e40cf3d4ad20c14fe31ba04a1506cd`
- Changed files in the manifest: `post-ocr-comments.mjs`, `post-ocr-comments.test.mjs`, `publish-routing-review.test.mjs`, `resolve-threads.integration.test.mjs`, `resolve-threads.mjs`, `resolve-threads.test.mjs`.
- The full candidate per-file manifest is `source-manifest.sha256`; its file SHA-256 is `9f937a1d275a64a13a19566fc0c9a11063e40cf3d4ad20c14fe31ba04a1506cd`, equal to the candidate manifest digest above.
- Changed manifest entries (base SHA-256 → candidate SHA-256):
  - `.github/workflows/scripts/post-ocr-comments.mjs`: `0b3d1b4caf26b43dd6856171e2dcd8bf1cf91e5ea5e28460e51d5bd0c7a303f1` → `61c1cb3de692ab6207f22ef0ebf601780c9c8b674edfaf7e828186f7a3201ec2`
  - `.github/workflows/scripts/post-ocr-comments.test.mjs`: `8200ac368fbb6b5eafc86bade78d2b6883739f870d0a666b1f1ae72a287edc8b` → `e701560befc9707d54d69c81f87664069921ef6ee4d631ff54248ff4d0febc4d`
  - `.github/workflows/scripts/publish-routing-review.test.mjs`: `5972864620dcc754e0b647bc07254b5f8298b686de042d3f71cab2162aeb3b39` → `f00d9db9ff5d4026aacec0fe40bfa7b60dce8f6a9e8f3e5250db8613c84d4bee`
  - `.github/workflows/scripts/resolve-threads.integration.test.mjs`: `4f709db40792fc6ef3a4fa432e1e73b66da6e1978ef6db70e7c4e193b0107206` → `1d8d5fd95e9954c0510471b9da3ddda25f796f2c8d267381931ac78eb546bdd3`
  - `.github/workflows/scripts/resolve-threads.mjs`: `1f0c3d9a4f230997843946362f8f129054c9c6081131fe25ce3f7e9dd33aa1c5` → `c68f670995482a0252d7444c09f3c33e0abd7b7e9a7d9f11b7e5383dc3167256`
  - `.github/workflows/scripts/resolve-threads.test.mjs`: `dfa7d41cbcc84719fe9c069cf07002034d9d175fe439ea74bcb73357f380bf17` → `77a5077902eecc9ae25e267addfb627978f4582eea39620cff61991cbbe98646`

## Changed files

- `.github/workflows/config/routing-traceability.json`
- `.github/workflows/scripts/post-ocr-comments.mjs`
- `.github/workflows/scripts/post-ocr-comments.test.mjs`
- `.github/workflows/scripts/publish-routing-review.test.mjs`
- `.github/workflows/scripts/resolve-threads.integration.test.mjs`
- `.github/workflows/scripts/resolve-threads.mjs`
- `.github/workflows/scripts/resolve-threads.test.mjs`
- `docs/superpowers/plans/2026-10-21-pr-dynamic-routing-remediation.md`
- `docs/superpowers/specs/2026-10-20-pr-dynamic-llm-routing-design.md`
- This evidence directory (`implementation-evidence.md`, `node-tests.log`, `actionlint.log`, and the source manifest).

## Review handoff

Fresh review should check the exact base SHA above against this candidate diff, A/B contract coverage, `off` compatibility, publisher gate behavior, and the source-manifest digest. The review must not infer independent acceptance, runtime authorization, or a Gate release from this implementation report.
