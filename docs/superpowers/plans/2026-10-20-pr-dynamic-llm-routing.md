# OCR App — PR別Dynamic LLM Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **THIS DOCUMENT IS A PLAN, NOT IMPLEMENTATION AUTHORIZATION.** Implementation, GitHub writes, OpenRouter API calls, and `shadow/enforce` activation were **not** performed in producing it. Execute only after the Human Owner has reviewed this written plan and selected an execution method. Never treat G0 policy approval as G1/G2/G3/G4 passage.

**Goal:** Preserve the existing OpenCodeReview GitHub Actions pipeline while adding PR-wide, privacy-bounded features, deterministic risk floors, optional OpenRouter Mercury Decide advice, certified-model routing, and auditable publish gating for `enforce`.

**Architecture:** The trusted workflow reads **ALL_CHANGED_FILES** independently of the existing OCR reviewable set, derives `InternalPRFeatures/v3`, projects only strict `DecisionState/v1`, and optionally sends it to the fixed Decisions API after GitHub-authoritative egress authorization. A trusted resolver enforces the capability floor; Antigravity Host retains legacy behavior for `off/shadow` and adds explicit validated fallback and attempt-event auditing for `enforce`. A distinct audit finalizer, successful upload, and publish gate precede all PR mutations in `enforce`.

**Tech Stack:** GitHub Actions YAML; Node.js **20** ESM (`node:test`, `node:assert/strict`, `node:child_process`, native `fetch`, `AbortSignal.timeout`); Git CLI; `agy` through existing Antigravity Host; JSON Schema **Draft 2020-12** with **Ajv 8.17.1** (`ajv/dist/2020.js`); `actions/upload-artifact@v4`; OpenRouter `POST https://openrouter.ai/api/alpha/decisions`; existing Cloudflare Worker/Vitest regression suite. Use `actionlint` for workflow validation. Keep the runtime dependency in a newly pinned `.github/workflows/package.json` / `package-lock.json` (`"ajv":"8.17.1"`), installed with `npm ci --prefix self-repo/.github/workflows --ignore-scripts` in the trusted workflow before any routing step; do not fetch PR-controlled packages.

**Spec:** `ocr-app-pr-dynamic-llm-routing-superpowers-design-r4-20261020.md` (the supplied authoritative R4 Design Spec; intended repository placement: `docs/superpowers/specs/2026-10-20-pr-dynamic-llm-routing-design.md` only after separate authorization). The fixed code baseline is `68c5739c2570039fc62a4ed4814684ac65584791`. R4 G0 handoff accompanies the Spec. If the Spec has not been committed, stage the exact reviewed bytes as a separate document-only action after authorization; do not pretend that the path currently exists in GitHub.

## Global Constraints

- `off` remains the default and must skip **all** new extraction, GitHub visibility, Decision, model-routing, and routing-audit steps; its `runHost`, `runThreadHost`, review JSON, retry/fallback, posting, and Check Run behavior are unchanged.
- `shadow` computes only counterfactual routing. No chosen model/fallback is used for the actual review; observer failures do not block legacy publication; `review_quality_measured=false`.
- `enforce` requires separate Owner activation and G1/G2/G3/G4 gates; only Owner-certified models may execute, and `deep` may never fall back to `fast`.
- Risk uses **ALL_CHANGED_FILES** and `OCR_REVIEWABLE_FILES` is unchanged. `fast` floor is limited to approved non-executable Markdown paths (`README.md`, `docs/**/*.md`) with all §5.1 exclusions; uncertain or non-docs changes require `deep`.
- Never send raw diff, code, PR title/body, filename/path, user/repository identifiers, commit message, Secrets, or an egress grant to Decision API. Outbound `state` is precisely the **15 keys** in `DecisionState/v1`; no string passthrough.
- Decision provider: `inception/mercury-decide:free`, fixed `/api/alpha/decisions`, **one attempt per decision**, **5,000 ms timeout**, no automatic retries or automatic paid-model substitution; responses are advisory.
- `off/shadow` retain the legacy `fallbackModel || ANTIGRAVITY_FALLBACK_MODEL`; `enforce` requires an **own-property** `fallbackModels` array (`[]` explicitly disables fallback). An own-property `undefined`, `null`, or invalid array is rejected **before spawn**.
- Preserve existing result file `/tmp/ocr-result.json` with schema `1.0`; store routing audit at exactly `${RUNNER_TEMP}/ocr-routing/{decision.json,attempts.ndjson,final.json}` and upload as a separate Artifact, never as part of existing `ocr-debug-logs`.
- `enforce` publication order: Host and attempts → existing filter/validation → HEAD check → single final audit seal → successful `upload-artifact@v4` → trusted publish gate → PR mutations and final Check Run. A second HEAD check is required immediately before publication.
- `enforce` must delay **both** `Resolve fixed review threads` and review comments until after its publish gate. The old `off/shadow` order remains unchanged.
- Repository visibility is authoritative only from GitHub REST. Owner-approved allowlist is the only egress approval; unknown visibility and API failures mean **POST 0**.
- G0 basic policies **approved in conversation**: D01 default off/separate rollout; D02 deny-by-default with individual repository grants; D03 risk/review-scope split; D04 block non-reviewed high-risk changes in enforce; D05 certified-only/deep floor; D06 G2 routing-only; D07 free Decision, 30-day routing Artifact retention, central repo read-access visibility. **Not approved**: individual repository grants, specific model certifications, exact secret/identity handling, audit operational deletion/incident procedures, or activation. Their evidence/configurations remain gated.
- Owner decision and implementation proof remain distinct: `G1/G2/G3/G4=NOT_STARTED`; no private repository or model becomes authorized merely because this plan mentions it.

## Review Focus

1. **Git metadata parser** — NUL filenames, rename old/new, binary stats, symlinks/submodules, unknown status, malformed base and output truncation produce a complete classification or `features_incomplete=true` with `deep`, never a false `fast` (Task 2).
2. **Egress spoofing** — forged dispatch visibility/name, invalid API JSON, mismatch of numeric repository ID or checkout HEAD, and stale grant must yield zero Decision POSTs (Task 4).
3. **Host fallback / observation** — legacy mode and retries are byte-for-byte behaviorally compatible; `enforce` with `fallbackModels:[]` never implicitly executes an env fallback; observer failure blocks `enforce` only (Task 7).
4. **Post/audit sequencing** — failed/missing Artifact, absent Check Run, HEAD race, failed audit seal, or thread-mutation path cannot publish or complete success in `enforce` (Tasks 8–9).
5. **Schema / data leakage** — internal paths and identifiers, extra keys, undefined values, and prototype properties cannot enter Decisions API body or routing audit; failed projection means zero POSTs (Tasks 3 and 5).

---

## File and Responsibility Map

| Responsibility | File(s) | Owner task |
|---|---|---|
| Certifiable catalog and strict schema | **Create** `.github/workflows/package.json`, `.github/workflows/package-lock.json`, `.github/workflows/config/review-model-catalog.json`, `.github/workflows/config/review-model-catalog.schema.json`, `.github/workflows/scripts/validate-review-model-catalog.mjs`, `.github/workflows/scripts/validate-review-model-catalog.test.mjs` | 1 |
| Exhaustive untrusted Git metadata | **Create** `.github/workflows/scripts/extract-pr-review-features.mjs`, `.github/workflows/scripts/extract-pr-review-features.test.mjs` | 2 |
| Strict local classification and outbound state | **Create** `.github/workflows/config/review-risk-policy.json`, `.github/workflows/scripts/classify-pr-review-risk.mjs`, `.github/workflows/scripts/classify-pr-review-risk.test.mjs`, `.github/workflows/scripts/build-decision-state.mjs`, `.github/workflows/scripts/build-decision-state.test.mjs` | 3 |
| GitHub-authoritative egress grants | **Create** `.github/workflows/config/decision-egress-policy.json`, `.github/workflows/scripts/authorize-decision-egress.mjs`, `.github/workflows/scripts/authorize-decision-egress.test.mjs` | 4 |
| Mercury Decisions API adapter | **Create** `.github/workflows/scripts/decision-provider.mjs`, `.github/workflows/scripts/decision-provider.test.mjs` | 5 |
| Capability-floor route resolver, CLI output | **Create** `.github/workflows/scripts/select-review-model.mjs`, `.github/workflows/scripts/select-review-model.test.mjs` | 6 |
| Host explicit fallback and separate attempts | **Modify** `.github/workflows/scripts/antigravity-host.mjs`, `.github/workflows/scripts/antigravity-host.test.mjs` | 7 |
| Immutable routing audit and publication evaluation | **Create** `.github/workflows/scripts/ocr-routing-audit.mjs`, `.github/workflows/scripts/ocr-routing-audit.test.mjs`, `.github/workflows/scripts/evaluate-routing-publish.mjs`, `.github/workflows/scripts/evaluate-routing-publish.test.mjs` | 8 |
| Workflow wiring, Check Run states and integration | **Modify** `.github/workflows/ocr-engine.yml`, `.github/workflows/scripts/update-check-run.mjs`, `.github/workflows/scripts/update-check-run.test.mjs`, `.github/workflows/scripts/antigravity-policy.test.mjs`; **create** `.github/workflows/scripts/ocr-routing-workflow.test.mjs` | 9 |
| End-to-end static gates and independent handoff | **Create only after authorization** `docs/superpowers/evidence/2026-10-20-pr-dynamic-routing-g1.md` and review record; do not activate | 10 |

**No file changes** to `cloudflare-worker/src/index.ts`, `.github/workflows/scripts/prepare-ocr-review-context.mjs`, `.github/workflows/config/markdown-review-rules.json`, `.github/workflows/scripts/resolve-threads.mjs`, `.github/workflows/scripts/post-ocr-comments.mjs`, or the OCR review result schema; modify only if a subsequent independent review specifically authorizes a scoped deviation.

## Common Interfaces and Data Contracts

These names/shapes are canonical for task handoffs. Use JSDoc typedefs or named exports in Node ESM; do not add a TypeScript compilation pipeline solely for this feature.

- `InternalPRFeatures/v3`: `schema_version:'3'`, trusted-local `head_sha`, `all_changed_files`, `ocr_reviewable_paths`, counts/additions/deletions as numbers or null, `change_size`, `language_families`, `change_areas`, `test_files_changed`, `security_signal`, `migration_signal`, `classification_status`, `features_incomplete`, `review_scope_gap`, `risk_floor` (§4.2).
- `DecisionState/v1`: exactly `schema_version`, `all_changed_file_count_bucket`, `reviewable_file_count_bucket`, `excluded_file_count_bucket`, `additions_bucket`, `deletions_bucket`, `change_size`, `language_families`, `change_areas`, `test_files_changed`, `security_signal`, `migration_signal`, `review_scope_gap`, `features_incomplete`, `classification_status`; all **15 keys required** (§4.3).
- `EgressAuthorization/v1`: local only, exactly the fields in R4 §6.1; `allowed=true` is meaningful only with verified `repo_id`, `full_name`, `head_sha`, `workflow_run_id`, `run_attempt`, destination, policy/version and approval reference.
- `ReviewAttemptEvent/v1`: `onAttemptEvent(event)` receives version, `run_attempt_id`, `attempt_index`, event, model, result, UTC timestamp, duration, host_status; no raw error/prompt. Exact R4 §7.2 enum.
- `RoutingAudit/v2`: exact required fields in R4 §11.2; local `audit_status='sealed'` **does not** assert upload success.
- `AuditDeliveryOutcome/v1`: workflow-local `{outcome:'success'|'failure'|'skipped',artifactId:string|null,runId:string,runAttempt:number}`; never amend the sealed `final.json` after upload.

**Dependencies:** Task 1 → Task 6/7; Task 2 → Task 3 → Tasks 5/6; Task 4 → Task 5; Tasks 5–7 → Task 8 → Task 9 → Task 10. Test seams use injected `fetchImpl`, `runGit`, `spawn` and pure transforms; do not need actual GitHub/OpenRouter/Agy credentials in G1.

### Task 1: Trusted Model Catalog + Certification Gate

**Files:** Create `review-model-catalog.json`, `review-model-catalog.schema.json`, `validate-review-model-catalog.mjs`, `validate-review-model-catalog.test.mjs` at paths above, plus `.github/workflows/package.json` and `.github/workflows/package-lock.json` with exactly `ajv@8.17.1` pinned.

**Interfaces:** `validateCatalogShape(catalog): void`, `validateCatalogSemantics(catalog, {verifiedCertificationRefs, cliAvailableModels}): void`, `resolveCertifiedModels(catalog, strategy, evidence): {primaryModelId, allowedFallbackModels, capabilityTier}`; callers must catch validation failures and fail closed. The Design §7.0 Draft 2020-12 JSON Schema is the only normative schema; include **all six required model fields** and root `catalog_version`. `verifiedCertificationRefs` is trusted evidence verification, not a boolean flag derived from catalog text alone.

- [ ] **RED 1:** Test root/model unknown properties; duplicate model IDs; stale/mismatched catalog version; fallback cycles/self-reference; absent preferred/fallback IDs; `pending/suspended/revoked` primary and fallback; unverifiable `sha256:` certification; unavailable `deep` model. Assert invalid catalog rejects and no model ID is returned (T-019/T-020).
- [ ] **RED 2:** Run `node --test .github/workflows/scripts/validate-review-model-catalog.test.mjs`. Expected **FAIL** because production validator/module/config does not yet exist.
- [ ] **GREEN 1:** Copy R4 §7.0 Draft 2020-12 schema **verbatim** into `review-model-catalog.schema.json`; create the isolated `.github/workflows` package with Ajv **8.17.1**, record its `npm` lockfile and use `Ajv2020` from `ajv/dist/2020.js` (`allErrors:true`, `strict:false` only if the existing R4 schema compilation demands it); add catalog example with the two R4 candidates in `pending` only, **not certified**. Implement schema validation plus semantic cross-references and `resolveCertifiedModels`; perform explicit numeric rank `fast=0`, `deep=1` without trusting model name.
- [ ] **GREEN 2:** Run `npm ci --prefix .github/workflows --ignore-scripts` followed by the same test. Expected **PASS**; `resolveCertifiedModels(...,'deep',...)` raises `review_model_unavailable` while all candidate models are pending.
- [ ] **REFACTOR:** Remove duplicate version/tier tests, retain stable fail-closed messages; ensure no runtime network call in validators.
- [ ] **COMMIT (future execution only):** `git add .github/workflows/package.json .github/workflows/package-lock.json .github/workflows/config/review-model-catalog* .github/workflows/scripts/validate-review-model-catalog* && git commit -m 'feat(ocr): define certified review model catalog'`.

### Task 2: PR-Wide Git Feature Extractor

**Files:** Create `extract-pr-review-features.mjs` and its `.test.mjs`.

**Interfaces:** `parseNulGitChangeRecords({nameStatus, numstat, rawMode}): ChangedFile[]`; `extractPRFeatures({cwd,baseRef,headSha,preview,runGit}): Promise<InternalPRFeatures/v3>`; `runGit(command,args,{cwd})` returns **Buffer** (not decoded textual lines). `ChangedFile` contains safe local `{oldPath?,path,status,mode,additions:null|number,deletions:null|number,binary:boolean}`; supports rename/copy counts and mode-only changes.

- [ ] **RED 1:** Add test fixtures with NUL-containing name-status streams, spaces/tabs/newlines in filenames, rename old/new, deletion, copy, `-` binary, symlink 120000, submodule 160000, executable bit change, unknown status, malformed Git refs, missing merge-base, and output-cap overflow. Assert count correctness or `features_incomplete=true`, `risk_floor='deep'`; no accidental `fast` (T-001/T-003/T-004).
- [ ] **RED 2:** Run `node --test .github/workflows/scripts/extract-pr-review-features.test.mjs`. Expected **FAIL** (module absent).
- [ ] **GREEN 1:** Execute fixed argument-array `git diff` using `--no-ext-diff`, `--no-textconv`, `--name-status -z`, `--numstat -z`, raw mode info and the verified `origin/<baseRef>...<headSha>` range. Validate SHA, base ref, merge-base, and returned output length; do not execute PR scripts. Use `cwd=target-repo`, never select files using OCR reviewable patterns.
- [ ] **GREEN 2:** Run the test; expected **PASS**. For reviewable count 0, still extract all Git metadata while leaving API invocation to later gate; mark `review_scope_gap` for unreviewed risk, never expand reviewable scope.
- [ ] **REFACTOR:** Bound parsed path/record sizes and refuse count overflow; use `Buffer` NUL framing and explicit rename grammars, never split linewise.
- [ ] **COMMIT (future):** `git add .github/workflows/scripts/extract-pr-review-features* && git commit -m 'feat(ocr): extract all PR change metadata'`.

### Task 3: Deterministic Risk Classification + Exact Outbound Projection

**Files:** Create `review-risk-policy.json`, `classify-pr-review-risk.mjs`/`.test.mjs`, `build-decision-state.mjs`/`.test.mjs`.

**Interfaces:** `classifyPRRisk(features, trustedRiskPolicy): InternalPRFeatures/v3` (pure, fills class/risk_floor), `buildDecisionState(features): DecisionState/v1` (pure strict projection; throws on incomplete/invalid/oversize) and `validateDecisionState(state): void`.

- [ ] **RED 1:** Assert `README.md` alone A/M is only eligible `fast` if OCR gap false, while `docs/security-policy.md`, `AGENTS.md`, `.github/`, `src/util.ts`, mixed docs+code, rename, binary, executable/mode changes and unknown metadata are `deep`; `metadata_not_observed` is not proof of safe code (T-001/T-003).
- [ ] **RED 2:** Assert exported Decision State has precisely **15 own keys** with §4.3 enum/bucket boundaries; no `head_sha`, paths, repo ID/name or internal-only array; unknown keys, inherited properties, strings outside the enum, non-finite counts, `null` and bogus bucket cause projection exception (T-005/T-006). Compare R4 §4.3 and §6.2 example states by JSON deep-equality in fixture.
- [ ] **RED 3:** Run `node --test .github/workflows/scripts/classify-pr-review-risk.test.mjs .github/workflows/scripts/build-decision-state.test.mjs`. Expected **FAIL** (missing modules).
- [ ] **GREEN 1:** Encode the R4 §5.1–5.2 ordered classes and allow/deny paths in **trusted** risk policy; deny precedence over allow; unknown/incomplete always deep. Define array enum/sort/max and bucket boundaries **exactly** as §4.3; values copied into fresh object one key at a time, never spread/blacklist.
- [ ] **GREEN 2:** Run both tests, expected **PASS**. Incomplete features must make the caller skip Decision POST and use local deep rather than mapping unknown numbers to zero.
- [ ] **REFACTOR:** Limit risk-policy regex use to bounded, trusted path rules; no generic user-supplied glob executor.
- [ ] **COMMIT (future):** `git add .github/workflows/config/review-risk-policy.json .github/workflows/scripts/classify-pr-review-risk* .github/workflows/scripts/build-decision-state* && git commit -m 'feat(ocr): enforce deterministic risk floor and strict projection'`.

### Task 4: Authoritative Egress Authorization

**Files:** Create `decision-egress-policy.json`, `authorize-decision-egress.mjs` and `.test.mjs`.

**Interfaces:** `authorizeDecisionEgress({targetRepo,headSha,checkoutRepo,workflowRunId,runAttempt,installationToken,policy,fetchImpl}): Promise<EgressAuthorization/v1>`; `policy` is trusted configuration with exact repository numeric `id` and `full_name`, destination `openrouter-decisions`, approval reference and version; disallow wildcards. Output local-only grant (success/denial enum), no event-controlled authority.

- [ ] **RED 1:** Test GitHub REST `GET /repos/{owner}/{repo}` response with `private=false && visibility=public`, private, internal, contradictory visibility, 403/404/5xx/timeout/broken JSON, numeric ID mismatch, full_name mismatch, untrusted dispatch `visibility=public`, checkout origin mismatch, stale head, unauthorized public repository and missing/invalid Owner reference. Assert `allowed=false`, and downstream spy POST count remains **0** (T-007–T-009).
- [ ] **RED 2:** Run `node --test .github/workflows/scripts/authorize-decision-egress.test.mjs`. Expected **FAIL** (module absent).
- [ ] **GREEN 1:** Implement trusted `GET /repos/{owner}/{repo}` using **GitHub App installation token**, bind fetched ID/full_name + checkout verified origin/HEAD + run ID/attempt to grant; repository name is for lookup, never an authorization statement. `policy` defaults to an explicit **empty allowed repository list** for public and restricted alike until individual Owner approval. Never persist grant in API payload.
- [ ] **GREEN 2:** Run test, expected **PASS**. Unknown visibility/API error/approval not found => `egress_denied` without throwing an unsafe permissive default.
- [ ] **REFACTOR:** Keep API response logging limited to fixed error enum; redact token and arbitrary response body.
- [ ] **COMMIT (future):** `git add .github/workflows/config/decision-egress-policy.json .github/workflows/scripts/authorize-decision-egress* && git commit -m 'feat(ocr): authorize decision egress per repository'`.

### Task 5: Mercury Decide Provider Adapter

**Files:** Create `decision-provider.mjs` and `.test.mjs`.

**Interfaces:** `requestReviewDecision({decisionState,grant,expectedBinding,apiKey,fetchImpl,timeoutMs=5000}): Promise<{status,choice,probabilities,confidence,latencyMs,reason}>`; state is strict `DecisionState/v1`, grant is the trusted Task 4 output, expectedBinding is trusted `{headSha,workflowRunId,runAttempt,destination:'openrouter-decisions'}`. Provider result is normalized enum only; `choice` and probabilities are null on failure.

- [ ] **RED 1:** Inject fake `fetchImpl`; test missing key, denied/stale grant, malformed state/extra field, timeout, HTTP 401/402/429/5xx, malformed JSON, wrong `answers.review_strategy.type`, unknown choice, NaN/out-of-range probabilities, non-unit sum, invalid optional confidence. Assert **0 HTTP calls** when state/grant invalid; otherwise **≤1** call, no retry or paid model; sanitized fixed reason enum (T-005/T-006/T-009/T-010).
- [ ] **RED 2:** Run `node --test .github/workflows/scripts/decision-provider.test.mjs`. Expected **FAIL** (module absent).
- [ ] **GREEN 1:** POST **only** `{model:'inception/mercury-decide:free',state,questions:{review_strategy:{type:'choice',instructions:<R4 trusted constant>,criteria:{fast:<R4>,deep:<R4>}}}}` to the fixed HTTPS URL; Bearer key in HTTP header only. Use `AbortSignal.timeout(5000)` and an explicit response-byte bound; no raw error bodies in logs. Parse and verify probabilities (`0..1`, sum approximately 1) and confidence only when present. Wire a single API attempt per decision.
- [ ] **GREEN 2:** Run adapter test, expected **PASS**. A denied egress is `egress_denied`, not `api_unavailable`; no key is a deterministic non-send condition.
- [ ] **REFACTOR:** Keep the provider unaware of raw PR, path, diff or GitHub event; isolate all HTTP logic here.
- [ ] **COMMIT (future):** `git add .github/workflows/scripts/decision-provider* && git commit -m 'feat(ocr): adapt Mercury Decisions API safely'`.

### Task 6: Trusted Model Resolver / Decision Selection

**Files:** Create `select-review-model.mjs` and `.test.mjs`.

**Interfaces:** `selectReviewRoute({mode,features,decision,certifiedCatalog,runBinding}): {selectedStrategy,proposedStrategy,selectedReviewModel,proposedReviewModel,fallbackModels,routeSource,decisionStatus,humanAttention}`. CLI `main({env,readJson,writeOutput})` reads trusted local files and writes sanitized fixed strings/JSON array to `GITHUB_OUTPUT`; never a raw API model name as Antigravity model ID.

- [ ] **RED 1:** Tests: if `risk_floor=deep`, a Decision `fast` never downgrades; low confidence (`P(choice)<0.65` or margin `<0.15`) selects deep; invalid/429/missing key uses local floor; docs-only can fast; uncertified deep candidates reject; `fallbackModels=[]` remains explicit; unknown mode fails; `off` is **not invoked** by workflow (T-010/T-011/T-020).
- [ ] **RED 2:** Run `node --test .github/workflows/scripts/select-review-model.test.mjs`. Expected **FAIL** (module absent).
- [ ] **GREEN 1:** Resolve strategy using deterministic risk floor with Decision only able to **increase** depth; choose only trusted `preferred_model_id` and its certified allowed fallback(s), requiring min capability. Produce `route_source` and confidence/error enums without raw response. In `shadow`, compute proposal but **do not** hand it to Host.
- [ ] **GREEN 2:** Run test, expected **PASS**, including missing Model certification → `review_model_unavailable` under enforce with zero Host spawns.
- [ ] **REFACTOR:** Ensure every CLI output has fixed enum or validated catalog ID; bound JSON output sizes and forbid newline injection.
- [ ] **COMMIT (future):** `git add .github/workflows/scripts/select-review-model* && git commit -m 'feat(ocr): resolve review strategy within certified floor'`.

### Task 7: Antigravity Host Explicit Fallback and Attempt Observer

**Files:** Modify `antigravity-host.mjs` and `antigravity-host.test.mjs` **only**.

**Interfaces:** Existing `runHost({prompt,cwd,spawn,model,fallbackModel,maxRetries,onProgress,...})` remains backward compatible. Add optional `fallbackModels`, `onAttemptEvent(event)`, and trusted model-eligibility context for enforce only. **Own property absent** means legacy; `[]` no fallback; populated array ordered; own `null`/`undefined`/invalid rejects before `spawn` in enforce. `onAttemptEvent` is synchronous and observer-only; do **not** change result JSON shape.

- [ ] **RED 1:** Extend tests for absent/[]/array/own `undefined`/own `null`, duplicates and unauthorized/wrong-tier IDs; verify env fallback never resurrects an empty explicit list. Test `spawn` calls remain 0 on invalid enforce options (T-011).
- [ ] **RED 2:** Test sequence `attempt_started`→`attempt_completed` for every retry/fallback→one `host_completed`, emitted exact model IDs from actual `agy --model` arguments, valid UTC timestamps/results; no prompt/stderr/secret leakage. Simulate observer exception: swallow and record unavailable in `shadow`, make `enforce` audit incomplete and publication-ineligible. Preserve returned OCR JSON (T-012–T-014).
- [ ] **RED 3:** Run `node --test .github/workflows/scripts/antigravity-host.test.mjs`. Expected **FAIL** on new tests; existing tests **PASS** before implementation.
- [ ] **GREEN 1:** Extend existing `runMode` model list build with own-property tri-state; validate catalog authorization with trusted context in enforce, retain `runThreadHost` and original retry taxonomy. Emit bounded event payloads at spawn and completion points; a failed spawn emits a completed failure; ensure one terminal event even on exceptions.
- [ ] **GREEN 2:** Run same test, expected **PASS** all legacy and new tests. Explicitly compare `runHost` deep-equality to pre-change result contract and `runThreadHost` fixtures.
- [ ] **REFACTOR:** Extract only the model-list selection and bounded event emitter into small internal helpers; no unrelated rewrite of `antigravity-host.mjs`.
- [ ] **COMMIT (future):** `git add .github/workflows/scripts/antigravity-host.mjs .github/workflows/scripts/antigravity-host.test.mjs && git commit -m 'feat(ocr): audit model attempts and constrain enforce fallback'`.

### Task 8: Routing Audit Finalizer + Immutable Publish Gate

**Files:** Create `ocr-routing-audit.mjs`/`.test.mjs` and `evaluate-routing-publish.mjs`/`.test.mjs`.

**Interfaces:** `recordAttemptEvent(event, sink): void` writes strict `ReviewAttemptEvent/v1` NDJSON; `finalizeRoutingAudit({decision,attempts,reviewResult,validation,headCheck,runBinding,policy}): RoutingAudit/v2` validates and **seals once**, writing `final.json` with `audit_status='sealed'`. `evaluatePublishEligibility({mode,finalAudit,delivery:AuditDeliveryOutcome/v1,checkRunId,ownerDecisions,headSha}): {authorized:boolean,reason:enum}`; deny-by-default. No sealed audit mutation on upload result.

- [ ] **RED 1:** Test exact three paths and immutable seal; missing attempt, invalid order, failed/skipped Host, validation failure, stale SHA ⇒ `executed_review_model=null`; only matching completed `host_validated_success` with downstream validation + HEAD pass qualifies. Strip all raw diff, paths, secret, provider response or arbitrary strings (T-012–T-014/T-024).
- [ ] **RED 2:** Test `AuditDeliveryOutcome` `success/failure/skipped`, wrong run_id/run_attempt, no artifact ID, missing Check Run, D04 scope gap blocking, `decision.json` mismatch, unapproved egress grant, uncertified model ⇒ `authorized=false`, reason fixed enum. `audit_status='sealed'` alone **never** grants publishing (T-015/T-021/T-022).
- [ ] **RED 3:** Run `node --test .github/workflows/scripts/ocr-routing-audit.test.mjs .github/workflows/scripts/evaluate-routing-publish.test.mjs`. Expected **FAIL** before new modules.
- [ ] **GREEN 1:** Write bounded, schema-verified audit files at `RUNNER_TEMP/ocr-routing` with `0700/0600`; finalization freeze before uploading. Use only the R4 §11.2 fields; distinguish `host_success_model` from `executed_review_model`. Implement pure gate with explicit reason enum, run/HEAD match, certified tier and Owner D04 rule; no publication side effects.
- [ ] **GREEN 2:** Run both tests; expected **PASS**. Artifact upload success enters only through the external delivery object; no rewriting sealed bytes.
- [ ] **REFACTOR:** Reject `prototype`/extra keys in all serialized objects and keep enum reason codes centralized.
- [ ] **COMMIT (future):** `git add .github/workflows/scripts/ocr-routing-audit* .github/workflows/scripts/evaluate-routing-publish* && git commit -m 'feat(ocr): seal audit and gate publication'`.

### Task 9: Workflow Wiring, Check Run Reasons, All-PR-Mutation Gate

**Files:** Modify `.github/workflows/ocr-engine.yml`, `.github/workflows/scripts/update-check-run.mjs`, `.github/workflows/scripts/update-check-run.test.mjs`, `.github/workflows/scripts/antigravity-policy.test.mjs`; create `.github/workflows/scripts/ocr-routing-workflow.test.mjs`.

**Interfaces:** `DECISION_ROUTING_MODE` is trusted Actions variable, empty means `off`, unknown invalid. Extractor/decision steps produce sanitized `GITHUB_OUTPUT` fields; `SELECTED_REVIEW_MODEL`, `SELECTED_REVIEW_FALLBACK_MODELS_JSON` consumed only in enforce. `upload-artifact@v4` outputs `artifact-id` to `AuditDeliveryOutcome/v1`, and the raw step `outcome` (not success-coerced `conclusion`) is checked. Extend `buildCheckRunUpdate({...routingFailureReason?})` with an optional fixed enum for enforce, default absent preserves legacy output.

- [ ] **RED 1:** Write workflow structural tests asserting `off` skips new steps, `shadow` uses legacy Host/post/thread order and ignores audit failure, `enforce` runs extractor→GitHub repo auth→Decision→resolver→Host→filter+validate→HEAD→final seal→upload→publish gate→thread resolver + post; second HEAD check before PR mutation. Check fail/delay state with `if: always()` cannot accidentally publish (T-015/T-016/T-021–T-023).
- [ ] **RED 2:** Extend Check Run tests for `ROUTING_AUDIT_MISSING`, `PUBLISH_FAILED`, `HEAD_CHANGED`, `CHECK_RUN_MISSING`; arbitrary strings cannot be injected; legacy 3 tests remain unchanged. Run `node --test .github/workflows/scripts/ocr-routing-workflow.test.mjs .github/workflows/scripts/update-check-run.test.mjs`, expected **FAIL** on the new contract.
- [ ] **GREEN 1:** Add trusted dependency install (`npm ci --prefix self-repo/.github/workflows --ignore-scripts`) and `Select PR review model` integration immediately after `Prepare trusted review context`, only when mode `shadow|enforce`. Use only installation-token repo authorization and `OPENROUTER_API_KEY` in the Decision step. Unknown mode must fail explicitly. In enforce, pass validated `model`, explicit `fallbackModels` and observer to Host; in off/shadow invoke existing `runHost({cwd,prompt,onProgress})` semantically unchanged.
- [ ] **GREEN 2:** Rewire **enforce only** with routing finalizer and strict publish gate: set Artifact name `ocr-routing-audit-${{ github.run_id }}-${{ github.run_attempt }}`, `retention-days: 30` **only after Owner approval evidence**, `if-no-files-found: error`; use `continue-on-error` solely to reach failure notification and explicitly mark job failure. Place both thread reply/resolve and post behind gate, maintain existing per-post HEAD safety check. Never treat evidence collection `always()` as authorization. If Check Run ID absent, gate fails before post.
- [ ] **GREEN 3:** Extend `update-check-run.mjs` for sanitized routing failure reasons while preserving legacy skip `neutral`, success and failure behaviors. Check job failure on upload/send/Check Run update failure; preserve `/tmp/ocr-result.json` and existing `ocr-debug-logs`. Run the two test commands; expected **PASS**.
- [ ] **REFACTOR:** Validate YAML via `actionlint .github/workflows/ocr-engine.yml`, expected exit **0**. Check `node --test .github/workflows/scripts/antigravity-policy.test.mjs`, expected **PASS**; retain existing Antigravity deny-all tools policy.
- [ ] **COMMIT (future):** `git add .github/workflows/ocr-engine.yml .github/workflows/scripts/update-check-run* .github/workflows/scripts/antigravity-policy.test.mjs .github/workflows/scripts/ocr-routing-workflow.test.mjs && git commit -m 'feat(ocr): wire audited routing behind enforce publish gate'`.

### Task 10: Offline G1 Regression Evidence and Operational Handoff

**Files:** Create `docs/superpowers/evidence/2026-10-20-pr-dynamic-routing-g1.md` (execution evidence **only after** tasks 1–9 have been authorized and run), plus a review record alongside it. Neither is produced by this Plan drafting task.

**Interfaces:** `G1_STATUS='PASS'|'FAIL'|'NOT_RUN'` and `G2_STATUS='NOT_STARTED'` in evidence; every test must link test ID to actual command and recorded output/commit. Record version/hash of committed catalog, owner policy, artifact conditions and model certification placeholders separately; never fabricate executed results.

- [ ] **RED 1:** Before implementing any code, preserve current baseline results and run documented **existing** regressions for comparison: `npm ci --prefix .github/workflows --ignore-scripts && node --test .github/workflows/scripts/*.test.mjs`, `(cd cloudflare-worker && npm ci && npm test)`, `actionlint .github/workflows/ocr-engine.yml`, `git diff --check`. If a tool is unavailable, record `NOT_RUN` rather than PASS; do not claim G1 success from theoretical tests.
- [ ] **GREEN 1:** After tasks 1–9 in a separately authorized execution, rerun all above and the new tests, plus `node --test .github/workflows/scripts/{validate-review-model-catalog,extract-pr-review-features,classify-pr-review-risk,build-decision-state,authorize-decision-egress,decision-provider,select-review-model,ocr-routing-audit,evaluate-routing-publish,ocr-routing-workflow}.test.mjs` (shell brace expansion). Expected zero failures before marking G1 PASS.
- [ ] **GREEN 2:** Document the exact `T-001…T-024` coverage, and all missed/unexecutable tests as OPEN, not inferred successes. Recheck `off/shadow` PR output, `runThreadHost`, Check Run, no external calls in `off`, and no PR mutation before gate in enforce (mock E2E only for G1).
- [ ] **REFACTOR:** Have a **fresh independent reviewer** perform 6-axis Design↔Plan and spec→test traceability review, and compare the signed-off G0 basic policies versus still-pending per-repo/per-model/retention operational evidence. Correct Plan or code only through a separately approved review cycle.
- [ ] **COMMIT (future, after evidence exists):** `git add docs/superpowers/evidence/2026-10-20-pr-dynamic-routing-g1.md && git commit -m 'test(ocr): document offline routing gate evidence'`.

## Traceability and Gate Matrix

| R4 Requirement / test | Plan task | Required proof | Current state |
|---|---|---|---|
| Risk all files, OCR selection unchanged: T-001–004 | 2–3,9 | NUL fixtures, scope-gap, workflow tests | NOT_RUN |
| Strict internal v3→Decision v1: T-005–006 | 3,5 | Deep equal examples, 15-key strict projection, POST0 negatives | NOT_RUN |
| GitHub repo authority, exact allowlist: T-007–009 | 4–5 | Mock 403/404/spoof/stale, POST0 | NOT_RUN |
| Decisions API and deterministic fallback: T-010 | 5–6 | 429/error/invalid-confidence mock, no paid retry | NOT_RUN |
| fallback tri-state, observer, model evidence: T-011–014 | 1,7–8 | CLI spawn mock, exact attempts, no result schema change | NOT_RUN |
| Seal/upload/publish/legacy regression: T-015–018 | 8–10 | YAML and mock E2E, Node+Worker+actionlint | NOT_RUN |
| Certified catalog: T-019–020 | 1,6 | Schema + digest-backed evidence + Owner approval | NOT_RUN |
| Publication failure/race: T-021–024 | 8–10 | Missing artifact, wrong run attempt, repeat HEAD, no PR write | NOT_RUN |
| G0-D01–D07 (basic policies) | All | User's in-conversation approval; no activation implied | POLICY_APPROVED |
| Per-repository egress grant, exact model certification, audit operational procedures | 1,4,9,10 | Distinct Owner records and tests | PENDING |
| G1 static / G2 shadow / G3 comparison / G4 rollout | 10 / future authorized work | Actual recorded evidence | NOT_STARTED |

## Six-Axis Design ↔ Plan Self-Review (planning-stage only)

1. **Scope:** Risk input all changed files; OCR reviewable selection remains unchanged; only `enforce` reorders mutation steps. All tasks map to a single R4 subsystem and named files.
2. **Terminology / states:** `off/shadow/enforce`, classification classes, Decision `unavailable` versus egress `denied`, `host_success_model` versus `executed_review_model`, local sealed audit versus external delivery stay distinct.
3. **Types / interfaces:** Internal v3, Decision v1 15 keys, Egress grant v1, Attempt Event v1, Catalog v1, Routing Audit v2, Delivery Outcome v1 have named producers/consumers.
4. **Errors:** Fail closed for schema/Git/egress/model/audit/gate; `off` and `shadow` preserve legacy behavior; no paid Decision fallback.
5. **Tests:** T-001–024 map to Tasks 1–10, with RED expected failures, GREEN PASS criteria and existing regressions. **Not executed**.
6. **Non-functional:** 5-second Decision deadline; at most one outbound attempt; bounded inputs/results; no sensitive artifacts; 30-day approved proposal subject to operational proof, runtime egress and secrets boundaries intact.

**Self-review result:** `DESIGN_PLAN_CONSISTENCY = AUTHOR_SELF_REVIEW_ONLY` pending **independent** review; no claim of `PASS`, G1 proof, deployment or actual GitHub modification. Any mismatch found on independent review must be reconciled before implementation.

## Execution Authorization Handoff

The Human Owner has accepted the seven **basic policy choices** in chat. That approval does **not** authorize task execution, repository writes, operational egress, `shadow` or `enforce`. The next steps are: Owner reviews this **written Plan**; a separate reviewer evaluates its 6 axes against the **exact R4 Spec**; Owner chooses **subagent-driven** or **native** execution; then, and only then, an isolated branch/worktree may be created. Recommend **subagent-driven**, because tasks cross security, billing/privacy, model capability, and PR write boundaries; each task benefits from a fresh reviewer before the next interface consumes it.
