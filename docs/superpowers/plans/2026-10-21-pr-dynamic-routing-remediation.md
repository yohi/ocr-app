# PR Dynamic Routing Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct TARGET-001–003, the missing independent checkout check, and G1 traceability without enabling routing.

**Architecture:** Add a trusted, stage-specific startup authorization boundary before routing side effects.
Verify owner-backed certification bytes and CLI inventory independently from the model catalog, and pass a private,
run-bound execution context through preparation, Host, finalization, and publication.
Keep seal, upload, publication authorization, and final HEAD checking separate; allow a certified fallback success.

**Tech Stack:** Node.js 20 ESM, `node:test`, `node:assert/strict`, native crypto/fs/child_process, Git CLI,
existing Ajv 8.17.1, GitHub Actions, `actions/upload-artifact@v4`, actionlint, existing Worker/Vitest tests.
No new runtime dependency or TypeScript pipeline is required.

**Spec:** [Design R4](../specs/2026-10-20-pr-dynamic-llm-routing-design.md), especially §§6.1, 7, 8, 11, 13, 15.2;
[original implementation plan](2026-10-20-pr-dynamic-llm-routing.md).
Task 1 reviews and freezes the remediation contracts **within this plan** and requires explicit Owner review
before Tasks 2–16. No separate remediation specification file is created in this revision.
The contracts proposed below are not already approved amendments to R4.

## Global Constraints

- Planning baseline: `f057743ba226655bb772a58185e08816ca28b973` on `master`, inspected on 2026-10-21.
- This document authorizes neither implementation nor operational activation. Review this plan and select an execution
  method; after Task 1, obtain explicit Owner acceptance of the **plan-level contracts** before proceeding with code.
- This plan-only correction addresses review findings RMP-001–005; Design R4 and the original plan remain unchanged.
  Record any normative conflict with R4 and require a separate Owner decision before implementing it.
- Plan authoring and offline implementation validation perform no GitHub writes, merge, deployment, actual
  Decision API call, or actual model invocation. Commit checkpoints are proposals: run them only when the user
  explicitly authorizes commits. The runtime contracts below describe separately authorized workflow execution;
  they do not authorize live effects during this work. On a denied or failed runtime path, the sole permitted
  GitHub write is a sanitized failure update to an existing Check Run; never report review success on that path.
- `off` remains the default and skips every new routing check, lookup, extraction, artifact, and context read.
- `shadow` never executes a proposed model; authorized shadow preserves legacy retry/fallback/publication behavior.
  `review_quality_measured=false`. Startup denial is intentionally blocking, not a best-effort observer failure.
- `enforce` requires separate Owner activation; do not infer it from a variable, G0 basic policy, or a passing test.
  Only Owner-certified models execute. Tier order is `fast=0`, `deep=1`; deep-to-fast fallback is forbidden.
- `DecisionState/v1` remains exactly 15 keys; `SelectedReviewRoute/v1` remains exactly 15 keys.
  `RoutingDecisionRecord/v1` and `RoutingAudit/v2` retain their existing schemas.
- Preserve `/tmp/ocr-result.json`, schema `1.0`, OCR reviewable scope, existing filtering, deduplication, and rules.
- Decision provider remains `inception/mercury-decide:free`, one attempt, 5,000 ms timeout, no paid substitution.
- Repo egress remains a separate exact ID/full_name grant, default deny for public and restricted repositories.
- Startup authorization precedes Decision POST, review Host spawn, and routing audit creation/upload.
  GitHub identity GETs and fresh central approval/withdrawal GETs are permitted for establishing authority;
  old cached approval never substitutes for a failed GET. Only on denial or failure may the runtime update an
  existing Check Run with a sanitized failure notification, under the exception above.
- Routing artifact remains exactly `decision.json`, `attempts.ndjson`, `final.json`, retention `30` days,
  name `ocr-routing-audit-${run_id}-${run_attempt}`. Private execution context is never uploaded.
- Enforce order remains Host/attempts → filter/validation → HEAD check → immutable seal → upload → Gate →
  immediate HEAD recheck → review post. Enforce thread reply/resolve count remains zero.
- Normal zero-review skip needs startup authorization but no certified model, CLI inventory, or Host spawn.
- Current catalog entries remain `pending`, egress allowlist remains empty, new approval registries remain empty.
  Synthetic approvals/certifications exist only in tests. Local G1 evidence does not grant G2/G3/G4 permission.
- Preserve historical documents as historical evidence; do not relabel an old SHA or old test command as a new PASS.

## Review Focus

1. **Always-run bypass:** startup failure must prevent shadow resolver/post and routing upload even under `always()`;
   an absent output is not approval (Tasks 3, 12, 13).
2. **Stale authorization:** expiry, revocation, repo mismatch, policy/catalog digest mismatch, or retry-binding mismatch
   between preparation and publication must fail closed (Tasks 2, 6, 8, 10).
3. **Evidence self-endorsement:** catalog status, arbitrary reference strings, or catalog-derived CLI model lists
   cannot manufacture certification; evidence needs independent approved bytes and a matching installed CLI digest
   (Tasks 5, 7).
4. **Valid skip versus missing proof:** zero-review skip bypasses model proof only; failed validation, scope gap,
   or missing startup approval still prevents publication (Tasks 7, 10, 13).
5. **Fallback identity:** actual successful fallback may differ from the selected primary, but must belong to the
   saved permitted chain with matching certified tier and complete attempt events (Tasks 8–11, 13).

---

## Scope, approval, and execution sequence

This is one remediation project: startup, model selection, execution, and publication share one trusted boundary.
Splitting them into independently shipped features would leave partially protected paths.
Sixteen reviewable tasks replace the earlier rough estimate; validation is attached to each deliverable.
Tasks 13–15 supply cross-boundary proof rather than substituting for component tests.

Task 1 reviews plan-level contracts only, not a new specification. The Owner must accept the contracts before Task 2;
this does not grant implementation writes, operational approvals, or activation. Rejected contracts require plan revision.
Do not silently choose a different authority source, revocation policy, evidence store, or CLI mechanism.
**Intermediate Task 2–11 checkpoints are non-deployable/non-mergeable.** Their component tests may pass while
workflow consumers are not yet migrated (notably Task 4 → Task 7). Do not run Actions from a partial branch,
or regard it as integrated until Task 12 and Tasks 13–14 pass.

Dependency order:

```text
1 → 2 → 3
1 → 4
1 → 5 → 6
2 + 4 + 5 + 6 → 7 → 8 → 9 → 10 → 11
3 + 7 + 8 + 9 + 10 + 11 → 12 → 13 → 14 → 15 → 16
```

Before Task 2, establish an isolated execution worktree using the worktree skill and record its clean baseline.
Use `git rev-parse HEAD`, `git status --short`, the Node suite, Worker suite, actionlint, and `git diff --check`.
Install existing workflow dependencies with `npm ci --prefix .github/workflows --ignore-scripts` only if needed;
do not reuse the original plan's claim that this package does not exist. It already exists at this baseline.
There is no project `.devcontainer/` at the planning baseline.

## File and responsibility map

Paths below are repository-relative. `S/` means `.github/workflows/scripts/`; `C/` means
`.github/workflows/config/`. Expand these aliases to full paths in code, evidence, and staging commands.
New files listed here are application workflow configuration/code, not AI agent configuration.

| Files | Responsibility | Tasks |
| --- | --- | --- |
| `docs/superpowers/plans/2026-10-21-pr-dynamic-routing-remediation.md` | Review/freeze plan-level contracts; no new spec file | 1 |
| `C/routing-authorization.json`, approved `C/routing-approvals/` dossiers, `S/routing-authorization.mjs`, matching test | Fresh Owner registry, operational dossiers and stage checks | 2 |
| `S/authorize-routing-start.mjs`, matching test; `ocr-engine.yml` | Early workflow startup authorization | 3, 12 |
| `S/read-checkout-identity.mjs`, matching test; `S/authorize-decision-egress.mjs`, matching test | Git origin/HEAD and REST identity | 4 |
| `C/review-certification-index.json`, `S/load-review-certification.mjs`, matching test | Evidence digest/provenance verification | 5 |
| `S/routing-execution-context.mjs`, matching test | Private run-bound context codec/revalidation | 6 |
| `S/prepare-review-routing.mjs`, matching test | Connect authorization, identity, and certified bundle | 7 |
| `S/run-routing-review.mjs`, matching test | Production Host boundary currently inline in YAML | 8 |
| `S/ocr-routing-audit.mjs`, matching test | Finalize against permitted route and attempt stream | 9 |
| `S/evaluate-routing-publish.mjs`, matching test | Startup, evidence, fallback, and delivery conditions | 10 |
| `S/publish-routing-review.mjs`, matching test | Executable final authorization/HEAD/post boundary | 11 |
| `.github/workflows/ocr-engine.yml`, `S/ocr-routing-workflow.test.mjs` | Wire tested entrypoints and fail-closed conditions | 12 |
| `S/routing-remediation.integration.test.mjs` | Execute production functions with fake effects | 13 |
| Existing Host, policy, routing workflow, Check, resolver, posting tests | Off/authorized-shadow compatibility | 14 |
| `docs/superpowers/evidence/2026-10-21-routing-test-traceability.json`, `S/routing-traceability.test.mjs` | Stable T-ID/assertion mapping | 15 |
| `docs/superpowers/evidence/2026-10-21-pr-dynamic-routing-g1.md` and sibling log directory | New fixed-code-SHA evidence | 16 |
| Existing `2026-10-20-pr-dynamic-routing-g1.md` | Append correction notice; retain original assertions | 16 |

Do not modify Worker production code, review result schema, Markdown review rules, `resolve-threads.mjs`, or
`post-ocr-comments.mjs`. Execute existing post code through an adapter; do not duplicate its deduplication logic.
Do not rewrite the large existing Host module; keep its `runHost` and `runThreadHost` contracts.
Keep new modules focused; if a task needs more than 250 source lines, split validator from its step adapter.

## Proposed contracts for the Task 1 specification

These proposed implementation contracts are explicit so workers do not invent security policy. Task 1 freezes
them within this plan; effective Design R4 remains unchanged unless the Owner separately decides a divergence.
Plan review is not an operational activation grant.

### A. Trusted approval registry and staged activation

Use the central `self-repo` checkout pinned to `github.sha` for code, policy, catalog and source manifest,
never the target PR or dispatch contents. **The pinned checkout is not the live revocation authority.**
On every non-off authorization boundary, fetch the current `routing-authorization.json` and its operational
dossiers from the Owner-controlled `refs/heads/master` of the central repository via authenticated GitHub REST.
Use a trusted central repository ID/full name, fixed branch and fixed paths; no PR-controlled ref or fallback
on missing/stale responses. The central protected-branch maintenance policy and API read permissions are
operational preconditions to activation; verify them rather than assuming branch protection exists.
A digest proves byte identity, not who approved it; a solo Owner-recorded `security` assessment is not an
independent second-human Security approval. No new signature service, evidence database or approval issuer.

`RoutingAuthorizationRegistry/v1` has exactly `schema_version:'1'`, `approvals:Approval[]`,
`activations:Activation[]`, `revoked_refs:string[]`; initialize both arrays empty and revocations empty.
References match `OWNER-[A-Z0-9][A-Z0-9._-]{0,95}` and are unique within the registry.
Records are plain objects, all keys required, no inherited/extra/undefined properties.

`fetchCurrentRoutingAuthorization({centralRepoId,centralRepoFullName,protectedRef,token,fetchImpl,now})`
performs bounded authenticated GETs for the central REST repository identity, the latest registry and approved
dossiers at fixed paths; verify identity, path/type, decoded raw bytes and strict schemas. On 403/404/429/5xx,
timeout, malformed response, missing file or changed authority, return `ROUTING_AUTHORITY_UNAVAILABLE` and deny
the **next** effect. No cached/pinned-registry fallback, success-string authorization or automatic retry.
Revalidate approval scopes, pinned code manifest and current policy/catalog bytes against the new read.
This is per-effect revocation detection, **not** atomic instantaneous revocation: GitHub read visibility,
updates between GET and effect, and already-running Hosts remain residual races. Never claim an external
request can be undone after it begins; document this explicit limit in operation review.

`Approval` has exactly `ref`, `kind`, `repo_id`, `full_name`, `subject_sha256`, `issued_at`, `expires_at`.
Kinds are `owner_operation`, `security`, `audit_operation`, `g1`, `g2`, `g3`, `g4`, `model`, `cli_inventory`.
IDs are positive safe integers, full_name is exact GitHub REST spelling, subject is `sha256:<lowercase hex64>`.
Dates are canonical UTC ISO strings; accept only `issued_at <= now < expires_at` with no clock-skew grace.
An approval points to exact subject bytes or a reviewed operational dossier digest, not merely a PASS label.
For `owner_operation`, `security` and `audit_operation`, require distinct `RoutingOperationalDossier/v1` raw JSON
bytes at fixed approved central paths under `C/routing-approvals/`. Each dossier binds its reference/kind,
issuer and explicit Owner decision, repo ID/name, allowed mode/effects, pinned source-manifest/policy/catalog
digests, issuance and expiry, and revocation linkage. Its raw SHA-256 must equal that approval's
`subject_sha256`; verify all dossier fields against the activation and executing context. Absent, altered,
expired, wrong-kind/scope/issuer dossiers deny, and one dossier cannot satisfy different approval kinds.
For `g1`–`g4`, the subject is the tested source manifest below; model and CLI approvals bind their evidence
bytes per contract C. `security` here means a documented solo-Owner assessment, not independent personnel
certification. Real decisions require a separately authorized Owner change; fixtures cannot grant activation.

`Activation` has exactly `repo_id`, `full_name`, `mode`, `issued_at`, `expires_at`, `policy_sha256`,
`catalog_sha256`, `approval_refs`. Mode is `shadow|enforce`. Digests hash raw egress-policy/catalog file bytes.
`approval_refs` has unique references and exactly one reference of each required kind, with no unrelated kinds.
Every referenced approval must share repo scope and be valid/non-revoked.
`g1`–`g4` subjects are the tested code revision's source manifest digest; record that digest in the reviewed dossier
and compare it to the executing trusted code manifest (excluding approval/evidence/documentation files).
The exact source manifest is sorted tracked paths under `.github/workflows/scripts/`, plus `ocr-engine.yml`,
workflow package/lock, risk policy, egress policy, catalog, and catalog schema; hash each raw file, then hash the
UTF-8 lines `<relative-path> <sha256hex>\n`. Missing paths, duplicates, symlinks, or different bytes deny.
This avoids approvals becoming invalid merely because an approval-only commit changes `github.sha`.

| Stage | Required approval kinds | Result |
| --- | --- | --- |
| `shadow` | `owner_operation`, `security`, `audit_operation`, `g1` | Counterfactual routing only |
| G3 comparison | Outside `ocr-engine.yml`; separately approved controlled experiment | Cannot publish through this workflow |
| `enforce` | `owner_operation`, `security`, `audit_operation`, `g1`, `g2`, `g3`, `g4` | Eligible to attempt the enforce pipeline |

G4 is not a prerequisite for shadow or G3 evidence generation. The runtime variable selects a requested mode only.
Fetch and re-evaluate **fresh central registry/dossier bytes** at startup, preparation, immediately before
Decision POST and Host spawn, before routing audit upload, at Gate and immediately before review post.
Revalidate time, scope, policy/catalog and pinned source manifest each time; an unavailable GET denies.
Startup denial produces fixed `ROUTING_ACTIVATION_DENIED`; no review, thread mutation, or routing upload.
New revocation cannot retroactively cancel a Decision request or Host process already started.
Only on denial or failure may notification update an existing Check Run; this is the sole GitHub write exception
on that blocked path. It must not display review success or raw exception data, or permit review/thread mutations.

### B. Checkout identity

`readCheckoutIdentity({cwd, expectedRepo, expectedHeadSha, runGit}):Promise<CheckoutIdentity>` runs only
`git config --get remote.origin.url` and `git rev-parse --verify HEAD` with array arguments and bounded output.
The production `runGit` uses `execFile`, fixed arguments, a 10,000 ms timeout, and a 4,096-byte output cap.
Accept only `https://github.com/OWNER/REPO[.git]` or `git@github.com:OWNER/REPO[.git]`, no credentials,
query, fragment, alternate host, local path, multiple lines, or extra path segment.
Normalize `.git` suffix and repo-name case for comparison only; compare HEAD as lowercase hex40.
Return `{fullName:string,headSha:string}`. Mismatch/unknown throws `CHECKOUT_IDENTITY_MISMATCH`.
Git remote is a separate observation of checkout configuration, not cryptographic proof of Git object origin.
REST numeric ID, allowlist, action checkout constraints, and RunBinding remain necessary independent checks.

### C. Certification evidence and CLI availability

`ReviewCertificationIndex/v1` has exactly `schema_version:'1'`, `certifications`, `cli_inventory`.
Default is `certifications:[]`, `cli_inventory:null`.
Each certification reference entry has exactly `path`, `sha256`, `approval_ref`.
The index's `cli_inventory` is either `null` or a reference entry with exactly those same three keys;
it does not embed the CLI inventory document. Its `sha256` hashes the referenced document's raw JSON bytes,
and its `approval_ref` identifies the matching `cli_inventory` approval for that digest and repo scope.
Paths are relative to `C/routing-evidence/`, plain regular files, no symlink/traversal; reads are limited to 64 KiB.
The initial empty index does not require creating that directory or synthetic evidence files.

Certification raw JSON bytes hash to the catalog's `certification_reference`.
Its exact fields are `schema_version:'1'`, `model_id`, `capability_tier:'fast'|'deep'`, `catalog_version`,
`issued_at`, `expires_at`, `capability_evidence_sha256`, `cli_evidence_sha256`.
The index's `model` approval must match the digest and repo; evidence dates and approval dates must be valid.
`capability_evidence_sha256` identifies the independently reviewed capability dossier; require a matching
non-revoked `model` approval for that dossier as well. Self-written status or a digest alone cannot certify a model.

The referenced CLI inventory document (not the index entry) has exactly `schema_version:'1'`, `cli_version`,
`cli_binary_sha256`, `models:string[]`,
`observed_at`, `expires_at`. Require a matching `cli_inventory` approval and nonempty unique bounded model IDs.
Require canonical UTC dates and `observed_at <= now < expires_at`; reject inventories observed in the future.
Verify the installed `agy` executable digest independently. The adapter uses the workflow's fixed installation
path `$HOME/.local/bin/agy`, resolves it with `realpath`, requires a regular executable file and hashes its bytes.
Ignore target-controlled PATH entries; reject an executable resolved inside the target checkout.
**The enforce Host must spawn that exact verified absolute realpath**, not a later `PATH` lookup of `agy`.
Immediately before spawn recheck canonical path and digest; a changed/writable substitute fails closed.
Provide an enforce-only `cliExecutablePath` parameter to the existing Host; `off/shadow` retain `spawn('agy', ...)`.
Launcher hashing alone does not establish identity of dynamically loaded dependencies: require reviewed
installation/package provenance and dependency-manifest evidence before G2/G3 runtime approval, and record
remaining filesystem TOCTOU. Do not claim cryptographic process attestation.
The approved binary hash remains mandatory even for a valid regular file; do not execute a guessed CLI command.
The inventory is an Owner-approved observation of CLI-supported IDs tied to that installation, not a claim of
current provider capacity or of the provider's internal model identity. Actual transport failures still use fallback.
Producing real inventory/capability evidence is a later authorized G2/G3/operator activity, not a G1 mock action.

`loadVerifiedCertification({catalog,index,registry,repoIdentity,now,readEvidence,cliBinarySha256})` returns
`{verifiedCertificationRefs,cliAvailableModels}` in the shape already accepted by `resolveCertifiedModels`.
`readEvidence(relativePath):Buffer` is synchronous and production-bound to the fixed evidence root.
Verify current catalog semantics, but do not manufacture arrays from `catalog.models`.
Failure is fixed `REVIEW_CERTIFICATION_INVALID`; unavailable CLI is `REVIEW_CLI_UNAVAILABLE`.
All currently certified catalog entries require verified evidence; retain the existing whole-catalog availability
semantics rather than silently changing eligibility policy in this remediation.
Shadow and zero-review skip do not load certification or inventory.

### D. Private execution context and publication

`RoutingExecutionContext/v1` has exactly `schema_version:'1'`, `binding:RunBinding/v1`,
`repo_identity:{repoId:number,fullName:string,headSha:string}`, `authorization:{policy_sha256,catalog_sha256,
source_manifest_sha256,approval_refs:string[]}`, `certification_refs:string[]`, `cli_inventory_sha256:string|null`,
`cli_binary_sha256:string|null`. Zero-review and shadow contexts use empty certification refs and null CLI fields.
Store at `${RUNNER_TEMP}/ocr-routing-execution-context.json`, atomic no-overwrite write, mode `0600`,
outside the artifact directory. Read paths are fixed; callers cannot supply a PR-selected context filename.
Use `lstat`, reject symlinks/non-regular files, bound size to 64 KiB, validate exact keys and binding.
Re-fetch current central authorization/dossier bytes on every side-effect boundary while verifying the pinned
trusted policy/catalog/index/source-manifest bytes, digests and expiry. Stored refs, previous API responses
and output strings are not authority; remote failure denies the subsequent effect.
The context records provenance, not the external grant or Secret. It never changes the 15-key selected route.

Keep `evaluatePublishEligibility` pure. Replace unused `ownerDecisions` with `startupAuthorization`, add
`selectedRoute`, `attempts`, and `certifiedBundle:{catalog,evidence}|null`.
Callers re-fetch central authority and independently revalidate provenance before providing
`startupAuthorization` and bundle, not catalog flags. The pure Gate rejects a missing/failed fresh
result; a previous authorization boolean is never enough.
For nonempty review, require selected primary/fallback to equal the current certified resolved route, enforce
`selected_strategy >= risk_floor`, validate strict attempt order, one final Host success, and actual executed model
in `[selected_model_id,...fallback_models]`. Repeated attempts of the same model are allowed; transitions must
follow the saved fallback array in order without returning to an earlier model. Duplicate route
fallback IDs, an unauthorized attempted model, continued attempts after success, or a second success are rejected.
For normal skip require no model selection, no attempts, null Host/executed model, successful validation/HEAD,
no scope gap, authorized startup, delivered artifact, and Check ID. Never require model proof just for skip.
Retain existing egress approval checks and immutable final/upload separation.

## Task 1: Freeze the plan-only remediation contracts and Owner decisions

**Files:** Review and, if necessary, modify only this remediation plan; do not create another specification.
Keep Design R4 and the original implementation plan unchanged as inputs.

**Interfaces:** Consume the corrected audit, contracts A–D and RMP-001–005; maintain mapping to
`REM-001`–`REM-005`. This is not a new operational approval.

- [ ] **Step 1:** Confirm contracts for live central revocation reads, per-kind operational approval
  subject bytes, exact spawned CLI identity, one enforce publisher and non-deployable intermediate commits.
  Identify any contract that conflicts with effective Design R4.
- [ ] **Step 2:** Verify each grant's issuer, source, approved subject, scope, expiry, revocation consumer,
  side effects and failure outcome. Document solo-Owner trust limits, GitHub API freshness/TOCTOU,
  and already-running Host cancellation limits; G3 comparison remains outside this workflow.
- [ ] **Step 3:** Validate this plan as text (`markdownlint-cli2` where available, `git diff --check`);
  unavailable tooling is NOT_RUN, not PASS. Do not edit specification, source, workflow or config files.
- [ ] **Step 4:** Ask the Owner to explicitly accept the plan-level contracts; STOP before Task 2 until
  accepted. Plan acceptance grants no implementation GitHub write, certification, egress or activation.
- [ ] **Step 5:** If a contract changes effective R4 policy, obtain a **separate** Owner design decision
  before implementation. Do not infer that this plan amends R4 or create a new specification file.

## Task 2: Implement strict startup authorization

**Files:** Create `C/routing-authorization.json`, `S/routing-authorization.mjs`, and its `.test.mjs`.

**Interfaces:** `evaluateRoutingStartup({mode,repoIdentity,registry,operationalDossiers,policySha256,catalogSha256,
sourceManifestSha256,now}):StartupAuthorization` is pure. A trusted caller supplies **fresh** verified bytes.
`StartupAuthorization` is `{authorized:boolean,reason:'ROUTING_ACTIVATION_AUTHORIZED'|
'ROUTING_ACTIVATION_DENIED',approvalRefs:string[]}`. Off callers do not invoke it.
Also export `hashRoutingSourceManifest({trustedRoot,readFile,listTrackedPaths}):string` and the bounded
`fetchCurrentRoutingAuthorization` adapter per contract A.

- [ ] **Step 1:** Add `startup rejects missing stale revoked and wrong-stage approvals` with a valid synthetic
  shadow registry and variants for `{}`, `now===expires_at`, revoked reference, wrong repo ID/name, changed source,
  policy/catalog hashes, missing security/audit approval, wrong issuer, altered per-kind dossier subject,
  duplicates, inherited/extra keys, and `undefined`.
  Assert every variant returns `authorized===false`; valid shadow passes without g2/g3/g4; enforce does not.

  ```javascript
  assert.equal(evaluateRoutingStartup(validShadowInput).authorized, true);
  assert.equal(evaluateRoutingStartup({ ...validShadowInput, mode: 'enforce' }).authorized, false);
  assert.equal(evaluateRoutingStartup(expiredInput).reason, 'ROUTING_ACTIVATION_DENIED');
  ```

- [ ] **Step 2:** Run `node --test .github/workflows/scripts/routing-authorization.test.mjs`;
  expected FAIL on the new missing export/assertions, not dependency installation failure.
- [ ] **Step 3:** Implement contract A, operational dossier digests, bounded central REST GET and exact source
  manifest; create only the empty default registry. Test 403/404/429/5xx/timeout and scope mismatch with
  zero subsequent effects. Synthetic enforce requires g1/g2/g3/g4; `basic_policy_approved` is not authority.
- [ ] **Step 4:** Rerun the test; expected PASS including changed source manifest after a one-byte source mutation.
- [ ] **Step 5:** If authorized, stage only this task's files; commit `feat(ocr): 起動認可を段階別に検証`.

## Task 3: Add the early startup step adapter

**Files:** Create `S/authorize-routing-start.mjs` and its test. Modify the mode-validation/startup portion of
`.github/workflows/ocr-engine.yml` (baseline lines 134–166; relocate ahead of PR checkout/tool setup).

**Interfaces:** `authorizeRoutingStart({env,readTrustedConfig,fetchRepoIdentity,
fetchCurrentAuthorization,now,writeOutput}):Promise<void>`.
It reads expected scope from validated target metadata plus GitHub REST, never dispatch visibility.
Write `ROUTING_START_AUTHORIZED=true|false` exactly once; on denial throw fixed `ROUTING_ACTIVATION_DENIED`.
Export the CLI adapter only behind a main-module guard so tests can import it without effects.

- [ ] **Step 1:** Add `startup step never endorses absent approvals` asserting the empty registry writes `false`,
  throws the fixed enum, and never requests a Decision credential. Add `off skips startup reads` asserting no
  config read, GitHub GET, or output write. Unknown mode rejects before tool install or review.

  ```javascript
  await assert.rejects(authorizeRoutingStart(deniedInput), { message: 'ROUTING_ACTIVATION_DENIED' });
  assert.deepEqual(outputs, ['ROUTING_START_AUTHORIZED=false']);
  assert.equal(decisionCredentialReads, 0);
  ```

- [ ] **Step 2:** Run `node --test .github/workflows/scripts/authorize-routing-start.test.mjs`; expected FAIL.
- [ ] **Step 3:** Implement the adapter using Task 2, central checkout, and App token REST identity.
  Put the step after App token generation and a Node 20 setup step but before PR checkout, CLI install, OAuth
  restoration and preview. Use the central job `github.token` for central authority reads, not the
  target-scoped App token; check permissions before activation.
  Startup step is not `continue-on-error` in either shadow or enforce. No new dependency installation is needed.
- [ ] **Step 4:** Run its test and `actionlint .github/workflows/ocr-engine.yml`; expected PASS/clean.
  Full downstream `always()` protection is completed in Task 12; do not run/activate intermediate workflow revisions.
- [ ] **Step 5:** If authorized, stage only this task's files; commit `feat(ocr): ルーティング開始前に認可を強制`.

## Task 4: Observe actual checkout repo and HEAD

**Files:** Create `S/read-checkout-identity.mjs` and its test; modify `S/authorize-decision-egress.mjs:24–27,62–80`
and `S/authorize-decision-egress.test.mjs`.

**Interfaces:** Consume contract B's `readCheckoutIdentity`.
Change `authorizeDecisionEgress` to consume `checkoutIdentity:{fullName,headSha}` instead of `checkoutRepo:string`;
all other parameters and the existing EgressAuthorization/v1 output remain unchanged.

- [ ] **Step 1:** Add `checkout identity is independent of dispatch` with expected `owner/repo` but fake Git
  origin `other/repo`; assert `CHECKOUT_IDENTITY_MISMATCH` even if dispatch TARGET_REPO/CHECKOUT_REPO agree.
  Test stale actual HEAD, missing remote, credential URL, local path, query/fragment, multiline and output cap.
  Test valid HTTPS/SSH origins and case-normalized comparison. Assert egress denial and Decision POST count 0.

  ```javascript
  await assert.rejects(readCheckoutIdentity(wrongOriginInput), { message: 'CHECKOUT_IDENTITY_MISMATCH' });
  assert.equal(decisionPosts, 0);
  assert.deepEqual(await readCheckoutIdentity(validOriginInput), {
    fullName: 'owner/repo', headSha: 'a'.repeat(40),
  });
  ```

- [ ] **Step 2:** Run `node --test .github/workflows/scripts/read-checkout-identity.test.mjs
  .github/workflows/scripts/authorize-decision-egress.test.mjs` as one shell command; expected FAIL.
- [ ] **Step 3:** Implement bounded array-argument Git reads and the independent HEAD comparison.
  Update egress tests/callers to pass observed identity; remove authority from CHECKOUT_REPO env.
- [ ] **Step 4:** Rerun both tests; expected PASS. REST ID/visibility and exact allowlist checks remain required.
- [ ] **Step 5:** If authorized, stage only this task's files; commit `fix(ocr): checkout実体と送信対象を独立照合`.

## Task 5: Verify certification and CLI inventory provenance

**Files:** Create `C/review-certification-index.json`, `S/load-review-certification.mjs`, matching test.
Consume existing `S/validate-review-model-catalog.mjs:82–135`; keep its resolver evidence shape.

**Interfaces:** Export contract C's `loadVerifiedCertification` and
`readInstalledCliIdentity({env,targetRoot,resolveExecutable,readFile}):{resolvedPath:string,binarySha256:string}`.
The inventory supplies the approved version; binary identity itself never invents a version string.
Production executable reads are bounded at 256 MiB and fail closed on resolution/read/hash errors.

- [ ] **Step 1:** Add `catalog cannot certify itself` asserting catalog certified flags/digests without approved
  index bytes fail `REVIEW_CERTIFICATION_INVALID`. Verify one-byte tamper, expired/revoked Owner refs, wrong
  model/tier/version, wrong binary digest, path escape/symlink, oversize evidence, duplicate inventory IDs,
  swapped `PATH` binary and changed realpath/digest immediately before spawn reject.
  Valid synthetic evidence must produce exact resolver arrays, not booleans or extra keys.

  ```javascript
  assert.throws(() => loadVerifiedCertification(selfEndorsedInput), { message: 'REVIEW_CERTIFICATION_INVALID' });
  assert.deepEqual(loadVerifiedCertification(validEvidenceInput), expectedResolverEvidence);
  ```

- [ ] **Step 2:** Run `node --test .github/workflows/scripts/load-review-certification.test.mjs`; expected FAIL.
- [ ] **Step 3:** Implement raw-byte hashing and independent registry/index binding, dates, bounded file reads,
  installed CLI digest check, and dossier approval lookup. Create only the empty default index.
  Add `CLI inventory does not claim live provider capacity`; no live model invocation/discovery during tests.
- [ ] **Step 4:** Run this test plus `node --test .github/workflows/scripts/validate-review-model-catalog.test.mjs`;
  expected PASS. Real pending catalog remains unusable for nonempty enforce review.
- [ ] **Step 5:** If authorized, stage only this task's files; commit `feat(ocr): モデル認定証拠とCLI証跡を検証`.

## Task 6: Preserve private, run-bound execution provenance

**Files:** Create `S/routing-execution-context.mjs` and matching test.

**Interfaces:** `writeRoutingExecutionContext({runTemp,context,fileSystem}):void`;
`readRoutingExecutionContext({runTemp,expectedBinding,fileSystem}):RoutingExecutionContext`;
`revalidateRoutingExecutionContext({context,expectedBinding,trustedInputs,repoIdentity,now,
cliBinarySha256}):{startupAuthorization,certifiedBundle}`.
`trustedInputs` contains current raw config/manifest digests, parsed registry/index/catalog and `readEvidence`.
For shadow/zero-review, `certifiedBundle=null`; consumer explicitly specifies `needsModel:boolean` in trustedInputs.

- [ ] **Step 1:** Add `execution context rejects tampering and stale authorization` asserting extra keys,
  numeric run ID, string attempt, retry/head/mode mismatch, altered manifest/catalog hashes, expiry/revocation,
  symlink, partial JSON, overwrite and changed CLI digest reject before any consumer callback.
  Assert file `0600`, atomic no-overwrite, and no context content in selected-route serialization or artifacts.

  ```javascript
  assert.equal(readRoutingExecutionContext(validReadInput).binding.workflowRunId, '9007199254740993');
  assert.throws(() => revalidateRoutingExecutionContext(revokedContextInput));
  assert.equal(consumerCalls, 0);
  ```

- [ ] **Step 2:** Run `node --test .github/workflows/scripts/routing-execution-context.test.mjs`; expected FAIL.
- [ ] **Step 3:** Implement contract D; use same-directory temporary creation plus atomic link/no-overwrite
  publication and cleanup. Revalidation calls Tasks 2/5 using newly fetched central approval/dossier bytes and pinned trusted
  code/policy/catalog bytes, not saved arrays as authority; 429/timeout never reuse earlier approval.
  Normalize all failures to fixed `ROUTING_EXECUTION_CONTEXT_INVALID` or `ROUTING_ACTIVATION_DENIED`.
- [ ] **Step 4:** Rerun the test; expected PASS, including exact large run ID `9007199254740993` and skip/null bundle.
- [ ] **Step 5:** If authorized, stage only this task's files; commit `feat(ocr): 実行証跡をrunに拘束して保持`.

## Task 7: Connect trusted preparation to the resolver

**Files:** Modify `S/prepare-review-routing.mjs:110–143`, matching test; consume Tasks 2, 4–6.

**Interfaces:** Preserve `prepareRoutingStep`'s existing return `{route,decisionRecord,egressStatus}`.
Extend input with `trustedInputs`, `now`, `readEvidence`, `readCliIdentity`, `fetchRepoIdentity` test seams;
production defaults load fixed central policy/catalog and freshly fetched central approvals.
  Existing `runGit` and `fetchImpl` seams remain.
Feed `selectReviewRoute` exactly `{catalog,evidence}` in nonempty enforce, plain catalog in shadow/skip.

- [ ] **Step 1:** Add `enforce preparation uses verified bundle end to end`: synthetic approved scope, observed
  checkout, certified primary/fallback and independent evidence must produce the expected selected route.
  Omitting evidence must throw before any Host callback, not silently accept a certified catalog flag.
  Add denied-startup test with counters: Decision POST=0, routing writes=0, model-evidence reads=0.

  ```javascript
  assert.equal((await prepareRoutingStep(validEnforceInput)).route.selected_model_id, 'certified-primary');
  await assert.rejects(prepareRoutingStep(deniedStartupInput));
  assert.deepEqual(deniedCounters, { decisionPosts: 0, routingWrites: 0, modelEvidenceReads: 0 });
  ```

- [ ] **Step 2:** Run `node --test .github/workflows/scripts/prepare-review-routing.test.mjs`; expected FAIL on new
  tests. Existing shadow/skip tests must be updated with synthetic startup approval, never real registry edits.
- [ ] **Step 3:** Enforce startup before extraction/egress/route/audit writes. Read actual checkout identity;
  preserve all-change classification and 15-key projection. Write the private context after route resolution.
  Fetch fresh central approval and re-evaluate startup immediately before Decision POST regardless of elapsed
  time; revocation can occur before expiry. Skip model evidence for shadow/zero-review.
- [ ] **Step 4:** Run preparation, selector, egress, and Decision provider tests; expected PASS.
  Assert zero-review has POST=0 and no model/CLI lookup; GitHub identity GETs are allowed and counted separately.
- [ ] **Step 5:** If authorized, stage only this task's files; commit `fix(ocr): 認定証拠をルート選択へ接続`.

## Task 8: Guard the actual Host consumer

**Files:** Create `S/run-routing-review.mjs` and matching test. The workflow's baseline inline Host logic
at lines 225–307 moves here in Task 12. Existing `S/antigravity-host.mjs` remains the execution engine.

**Interfaces:** `runRoutingReview({env,context,prompt,runHost,readRoute,readDecision,readExecutionContext,
revalidateExecutionContext,readInstalledCliIdentity,createRecorder,writeResult,writeOutput,onProgress}):Promise<ReviewResult>`.
CLI defaults call existing implementations; injection seams perform no effects until invoked.
Off branches before dynamic routing imports/reads and calls legacy Host with identical options.

- [ ] **Step 1:** Add `Host revalidates authority before spawn`: after successful preparation, expire/revoke the
  activation or alter binding/context/evidence; assert runHost=0, result.status=`failed`, fixed reason only.
  Test authorized nonempty enforce receives exact selected model and own fallback array, observer and runAttemptId;
  `onProgress` is absent. Pending/invalid evidence cannot reach the engine's catalog-flag-only check. Add a fake `PATH` executable:
  enforce must spawn the attested absolute realpath or spawn zero; off/shadow retain the legacy command.

  ```javascript
  assert.equal((await runRoutingReview(revokedHostInput)).status, 'failed');
  assert.equal(hostCalls.length, 0);
  await runRoutingReview(validHostInput);
  assert.deepEqual(hostCalls[0].fallbackModels, ['certified-fallback']);
  assert.equal(hostCalls[0].onProgress, undefined);
  ```

- [ ] **Step 2:** Run `node --test .github/workflows/scripts/run-routing-review.test.mjs`; expected FAIL.
- [ ] **Step 3:** Move existing boundary behavior without rewriting prompt or Host engine. Revalidate Task 6
  using fresh central authority before enforce spawn; assert permitted route equals `resolveCertifiedModels`
  output. Add the minimal enforce-only executable-path seam to `readChild` so spawn uses the verified
  absolute `agy` path; off/shadow continue legacy `spawn('agy', ...)`.
  Preserve shadow binding-mismatch spawn 0 and pure observer-failure legacy continuation.
  Authorized zero-review enforce creates the existing trusted skipped JSON and seals an empty attempt stream.
- [ ] **Step 4:** Run the new test plus existing Host/preparation tests; expected PASS, no real `agy` spawn.
- [ ] **Step 5:** If authorized, stage only this task's files; commit `fix(ocr): Host直前に認可とモデル証拠を再検証`.

## Task 9: Validate final audit against the actual permitted attempt chain

**Files:** Modify `S/ocr-routing-audit.mjs:159–219` and matching test.
If extracting the shared validator, create `S/validate-routing-attempts.mjs` with its own test in this task.

**Interfaces:** Export `validateRoutingAttempts({attempts,selectedRoute,certifiedBundle}):
{attemptedModels:string[],successModel:string|null}`; invalid input throws `AUDIT_EVENT_INVALID`.
Extend `finalizeRoutingAudit` input with `selectedRoute` and `certifiedBundle` for nonempty enforce.
No new fields in final JSON; shadow/skip continue their distinct contracts.

- [ ] **Step 1:** Add `fallback success seals without impersonating primary` asserting primary failure + permitted
  fallback success gives selected=primary, host_success=fallback, executed=fallback. Add same-model retries,
  out-of-chain model, success-then-more-attempts, two successes, run_attempt_id mismatch, wrong tier and skipped Host.
  Out-of-chain or invalid sequence cannot yield a nonnull executed model; downstream failure keeps executed=null.

  ```javascript
  const audit = finalizeRoutingAudit(validFallbackAuditInput);
  assert.equal(audit.selected_review_model, 'certified-primary');
  assert.equal(audit.host_success_model, 'certified-fallback');
  assert.equal(audit.executed_review_model, 'certified-fallback');
  ```

- [ ] **Step 2:** Run `node --test .github/workflows/scripts/ocr-routing-audit.test.mjs`; expected FAIL on new cases.
- [ ] **Step 3:** Implement shared strict event/route validation, retaining actual observed attempted order and
  existing unique attempted model output. Complete enforcement proof is required only for nonempty enforce;
  no fake Host terminal event for normal zero-review skip. Keep immutable writer behavior and existing 32-key final.
- [ ] **Step 4:** Rerun audit and Host tests; expected PASS. Event recorder failure remains publication-blocking
  in enforce and diagnostic-only after authorized shadow startup.
- [ ] **Step 5:** If authorized, stage only this task's files; commit `fix(ocr): 許可された試行系列から成功モデルを確定`.

## Task 10: Correct publication authorization and fallback handling

**Files:** Modify `S/evaluate-routing-publish.mjs:22–53`, its test, audit tests that call the Gate.

**Interfaces:** `evaluatePublishEligibility({mode,expectedBinding,decisionRecord,finalAudit,delivery,checkRunId,
startupAuthorization,headSha,selectedRoute,attempts,certifiedBundle}):{authorized:boolean,reason:string}`.
Replace unused `ownerDecisions`; callers pass Task 6's independently revalidated startup/bundle.
Retain existing failure enums; add `ROUTING_ACTIVATION_DENIED` and `ROUTE_ATTEMPT_MISMATCH`.

- [ ] **Step 1:** Add `valid certified fallback authorizes publication` with Task 9 final plus selected route,
  full events, verified bundle and valid startup; assert `PUBLISH_AUTHORIZED` when executed!=selected primary.
  Empty/missing startup denies even for normal skip. Skip without models passes only with null selected/executed/
  host success and empty fallbacks/attempts. Scope gap, missing Check, failed upload and wrong delivery binding deny.

  ```javascript
  assert.deepEqual(evaluatePublishEligibility(validFallbackGateInput), {
    authorized: true, reason: 'PUBLISH_AUTHORIZED',
  });
  assert.equal(evaluatePublishEligibility(unapprovedSkipInput).reason, 'ROUTING_ACTIVATION_DENIED');
  assert.equal(evaluatePublishEligibility(approvedSkipWithoutModelsInput).authorized, true);
  ```

- [ ] **Step 2:** Run `node --test .github/workflows/scripts/evaluate-routing-publish.test.mjs`; expected FAIL.
- [ ] **Step 3:** Remove selected-primary equality as a success requirement; require the exact certified route,
  correct risk floor and Task 9 attempt validation. Compare Gate inputs with sealed final fields without resealing.
  Preserve egress approval-ref checks; never conflate egress approval with startup/rollout permission.
- [ ] **Step 4:** Run publish Gate and audit tests; expected PASS. Use realistic full catalog/evidence fixtures,
  replacing existing skeletal certified-flag-only fixtures in affected positive tests.
- [ ] **Step 5:** If authorized, stage only this task's files; commit `fix(ocr): 起動認可とfallback成功を公開判定へ反映`.

## Task 11: Make final publication a directly testable production boundary

**Files:** Create `S/publish-routing-review.mjs` and matching test. Reuse existing `check-pr-head.mjs` and
`post-ocr-comments.mjs` through injected adapters; no edits to their behavior.

**Interfaces:** `publishRoutingReview({env,revalidateExecutionContext,evaluateGate,checkHead,postReview,
writeOutput}):Promise<{published:boolean,reason:string}>`.
The CLI loads fixed selected route, attempts, sealed final, external upload outcome and Check ID, then supplies
Task 10 inputs. `postReview` calls existing posting CLI with expected SHA and forwards its review_url output.
**Enforce must have exactly one posting path:** Task 11 publisher is the only enforce caller; the old
workflow post step runs off/shadow exclusively. No duplicate enforce publisher or second POST.
Re-evaluating the pure Gate does not modify final.json or the earlier GitHub step outputs.

- [ ] **Step 1:** Add `publication never posts after a boundary failure`: inject failure at fresh central GET/context revalidation,
  Gate, and immediate HEAD check; assert postReview=0. Valid fallback yields call order `[gate,head,post]` once.
  Test post failure returns `PUBLISH_FAILED`, does not retry, and never reports success. Check updates stay external.

  ```javascript
  assert.equal((await publishRoutingReview(failedHeadInput)).published, false);
  assert.equal(postCalls, 0);
  await publishRoutingReview(validFallbackPublishInput);
  assert.deepEqual(successCalls, ['gate', 'head', 'post']);
  ```

- [ ] **Step 2:** Run `node --test .github/workflows/scripts/publish-routing-review.test.mjs`; expected FAIL.
- [ ] **Step 3:** Implement the boundary, freshly fetching central registry/dossiers and rechecking expiry/approval immediately before the final HEAD
  check and post. Reuse trusted delivery data; no authority from a standalone `PUBLISH_AUTHORIZED=true` string.
  Preserve expected SHA in posting call. Keep the separate earlier Gate and HEAD steps for workflow diagnostics.
- [ ] **Step 4:** Rerun the test and existing posting/dedup tests; expected PASS and no real GitHub request.
- [ ] **Step 5:** If authorized, stage only this task's files; commit `feat(ocr): 公開直前の境界を実行検証可能にする`.

## Task 12: Connect all workflow branches and always-run guards

**Files:** Modify `.github/workflows/ocr-engine.yml`, `S/ocr-routing-workflow.test.mjs`, and
`S/update-check-run.mjs`/test only where fixed startup/context failure enums need presentation support.

**Interfaces:** Workflow uses Tasks 3/8/11 production entrypoints; preparation stays Task 7.
Use the job's single `env.DECISION_ROUTING_MODE` consistently, not mixed independent `vars` decisions.
Export only fixed authorization booleans/enums and existing output IDs, never the context or evidence arrays.

- [ ] **Step 1:** Add workflow assertions for every routing/Host/thread/post/upload branch: off follows legacy;
  non-off requires `steps.routing-start.outputs.ROUTING_START_AUTHORIZED == 'true'`, not `!= 'false'`.
  Assert shadow startup lacks `continue-on-error`, upload requires successful **fresh** reauthorization/finalization,
  and unknown/failed startup cannot reach an `always()` mutation. Verify exactly one enforce posting step
  and that legacy posting is strictly off/shadow; missing or duplicated publishers fail. Run workflow tests;
  expected FAIL.

  ```javascript
  assert.match(shadowResolverCondition, /ROUTING_START_AUTHORIZED == 'true'/);
  assert.match(routingUploadCondition, /reauthorize-upload\.outputs\.AUTHORIZED == 'true'/);
  assert.doesNotMatch(startupStep, /continue-on-error/);
  ```

- [ ] **Step 2:** Replace inline Host with Task 8 adapter. Preserve prompt construction and legacy call semantics.
  Replace forged CHECKOUT_REPO with Task 4 reads. Gate/finalizer load Task 6 current evidence and Task 9/10 inputs.
  Add a separate `Reauthorize routing audit upload` step, `id: reauthorize-upload`, after finalization,
  before upload, using Task 6; write `AUTHORIZED=true|false`, with missing output treated as false.
  it is not allowed to rewrite sealed files. Denial prohibits upload in both shadow and enforce.
  Missing/invalid shadow audit records emit `SHADOW_AUDIT_UNAVAILABLE` and do not upload partial files.
- [ ] **Step 3:** Restrict the legacy posting step to off/shadow; enforce uses **only** Task 11 after
  the existing independent Gate and final HEAD step, with zero alternate posting routes. Preserve enforce thread disablement, successful upload raw outcome, artifact ID, 30-day retention,
  neutral skip, failure Check reporting, and fixed diagnostic-only denial messages.
- [ ] **Step 4:** Run `node --test .github/workflows/scripts/ocr-routing-workflow.test.mjs
  .github/workflows/scripts/update-check-run.test.mjs .github/workflows/scripts/antigravity-policy.test.mjs`
  as one command, then `actionlint .github/workflows/ocr-engine.yml`; expected PASS/clean.
- [ ] **Step 5:** If authorized, stage only this task's files; commit `fix(ocr): workflow全経路に認可境界を接続`.

## Task 13: Prove denied effects and fallback publication end to end offline

**Files:** Create `S/routing-remediation.integration.test.mjs`.

**Interfaces:** Execute the real Task 3/7/8/9/10/11 exports, with isolated temporary Git repositories,
production codecs/writers, synthetic trusted configuration/evidence, fake **live central registry** and
GitHub/OpenRouter fetch,
fake Host spawn, fake uploader and fake poster. Do not implement a second authorization algorithm in tests.
Upload simulation consumes the actual sealed files and returns external DeliveryOutcome; record every effect.

- [ ] **Step 1:** Add `unapproved startup produces zero routing effects` and variants for wrong repo/checkout,
  stale/revoked approval, altered operational dossier digest/issuer, central REST 403/429/timeout,
  wrong run attempt, missing context, and missing certification. Assert Decision POST=0
  where the failure precedes egress; Host spawn/upload/post=0 for startup denial. Distinguish earlier authorized
  effects from later revocation: update the mocked live registry between startup and upload/post; the next
  live read prevents future effects without claiming already-started calls were cancelled.
- [ ] **Step 2:** Add CLI realpath/PATH substitution and pre-spawn digest-change negative cases.
  Add valid primary-failure/fallback-success through final seal/upload/Gate/HEAD/post; assert
  selected primary differs from executed fallback and post count=1. Add normal skip without model proof:
  Decision POST=0, Host spawn=0, empty attempts, valid upload/Gate, neutral—not review-success—completion.
- [ ] **Step 3:** Add upload failure/missing file, malformed review JSON, seal failure, changed final HEAD, scope
  gap and check-ID absence; assert no review post or thread mutation. Revocation visible on the **fresh central GET** just before upload means upload=0;
  revocation visible just before post means post=0; central API failure never authorizes posting. Snapshot sealed bytes before/after all Gate calls; they are identical.

  ```javascript
  assert.deepEqual(startupDeniedEffects, { decisionPosts: 0, hostSpawns: 0, uploads: 0, posts: 0, threads: 0 });
  assert.equal(fallbackRun.finalAudit.executed_review_model, 'certified-fallback');
  assert.equal(fallbackRun.effects.posts, 1);
  assert.equal(uploadFailedRun.effects.posts, 0);
  assert.deepEqual(sealedBytesAfterGate, sealedBytesBeforeGate);
  ```

- [ ] **Step 4:** Run `node --test .github/workflows/scripts/routing-remediation.integration.test.mjs`;
  expected PASS. Each failure injection must demonstrably reach its boundary; assert its recorded reason/call order.
  If a regression is found, add its failing assertion first and correct only its owning production module.
- [ ] **Step 5:** If authorized, stage the integration test and any explicitly identified regression fix;
  proposed commit `test(ocr): 認可拒否とfallback公開の統合証明を追加`.

## Task 14: Lock off and authorized-shadow compatibility

**Files:** Extend `S/run-routing-review.test.mjs`, `S/routing-remediation.integration.test.mjs`,
`S/ocr-routing-workflow.test.mjs`; modify existing tests only when they need the new synthetic startup prerequisite.

**Interfaces:** Reuse existing Host, resolver, Check and posting contracts and Task 13 effect recorder.
Compare semantic calls/results rather than Node-generated timestamps or nondeterministic recorder IDs.

- [ ] **Step 1:** Add off fixtures asserting zero startup/model/context reads and no new GET/POST/upload;
  exact legacy model/fallback/retry options, progress callback, resolver/post order and Check handling remain.
  Authorized shadow keeps legacy Host model/fallback even when proposal differs; observer/write/upload failure
  preserves legacy review/Check outcomes and reports fixed diagnostic enums.
- [ ] **Step 2:** Add shadow existing-route binding mismatch asserting Host/resolver/post=0, versus absent route
  from best-effort generation failure asserting legacy Host continuation. Neither case bypasses startup approval.

  ```javascript
  assert.deepEqual(offRun.newRoutingEffects, { configReads: 0, contextReads: 0, repoGets: 0, uploads: 0 });
  assert.deepEqual(shadowHostOptions.model, legacyHostOptions.model);
  assert.deepEqual(shadowHostOptions.fallbackModel, legacyHostOptions.fallbackModel);
  assert.deepEqual(observerFailureRun.reviewResult, legacyRun.reviewResult);
  ```

- [ ] **Step 3:** Run all Node workflow tests with `node --test .github/workflows/scripts/*.test.mjs`;
  expected exit 0, counts recorded from actual output. Do not rewrite tests to accept changed legacy behavior.
- [ ] **Step 4:** If authorized, stage only compatibility tests and identified regression fixes;
  proposed commit `test(ocr): offと認可済みshadowの互換性を固定`.

## Task 15: Restore Design T-001–T-034 assertion traceability

**Files:** Create the traceability JSON and `S/routing-traceability.test.mjs` listed in the file map;
extend existing tests only for demonstrated assertion gaps.

**Interfaces:** Trace JSON has `schema_version:'1'`, `design_path`, `design_sha256`, `requirements`.
Each requirement has `id`, `contract`, `assertions:[{file,test_name,assertion_summary}]`, `scope:'offline'|'runtime'`,
`status:'COVERED'|'PARTIAL'|'NOT_RUN'`, `limitation:string|null`.
Include exact existing Design IDs T-001–T-034 and additional REM-001–005; never rename their meanings.
Runtime Owner/model demonstrations remain NOT_RUN if only synthetic G1 fixtures exist.

- [ ] **Step 1:** Read Design §13 in full, including RG-R1/R2 additions. Map each original assertion separately;
  T-001 means unclassified code→deep, T-024 means seal/upload separation and immutable evidence, T-033 means
  Host guard/spawn 0. Keep NUL parser coverage as a linked supporting assertion, not a replacement T-001 meaning.
- [ ] **Step 2:** Add `traceability covers stable design IDs without claiming runtime proof` asserting exact ID
  set, unique IDs, current design digest, existing relative test files, nonempty summaries, and limitations for
  PARTIAL/NOT_RUN. Missing mappings fail. Metadata alone is never proof an assertion executed.

  ```javascript
  assert.deepEqual(originalIds, Array.from({ length: 34 }, (_, i) => `T-${String(i + 1).padStart(3, '0')}`));
  assert.equal(matrix.design_sha256, actualDesignDigest);
  assert.equal(runtimeOnlyEntry.status, 'NOT_RUN');
  ```

- [ ] **Step 3:** For every COVERED assertion, record the exact Node test name and inspect its actual assert calls.
  Add failing behavioral tests for discovered gaps before fixes; do not mark schema/policy/model runtime proof PASS
  merely because a static string exists. Keep uncovered acceptance items PARTIAL and block a full G1 claim.
- [ ] **Step 4:** Run traceability test and each mapped file using `node --test --test-name-pattern='<exact name>'
  <file>`; record pass/fail/skipped counts. Require at least one executed matching test per cited name.
- [ ] **Step 5:** If authorized, stage matrix, its validator and only demonstrated coverage additions;
  proposed commit `test(ocr): 設計T-IDと実assertionの追跡性を修復`.

## Task 16: Rebuild reproducible G1 evidence and hand off for independent review

**Files:** Create `docs/superpowers/evidence/2026-10-21-pr-dynamic-routing-g1.md` and
`docs/superpowers/evidence/2026-10-21-pr-dynamic-routing-g1/` for sanitized logs/hash manifest.
Append a linked correction notice to the existing `2026-10-20-pr-dynamic-routing-g1.md`.

**Interfaces:** Evidence records `CODE_SHA`, source-manifest digest, specification/traceability digests,
environment versions, exact commands, exit codes, counts, timestamps and relative log paths with SHA-256.
Separate code-under-test revision from later documentation-only evidence commit; avoid a self-referential SHA claim.

- [ ] **Step 1:** Freeze and record the code revision after authorized implementation commits; source worktree
  must be clean. If commits were not authorized, report evidence capture blocked pending an identifiable revision.
  Check local `git cat-file -t <CODE_SHA>` and tracked files. GitHub API visibility is an optional separately labeled
  read-only check, not permission to push and not proof a locally existing SHA is nonexistent.
- [ ] **Step 2:** In that fixed revision run the following, recording separate sanitized logs and actual results:

  ```bash
  npm ci --prefix .github/workflows --ignore-scripts
  node --test .github/workflows/scripts/*.test.mjs
  npm ci --prefix cloudflare-worker --ignore-scripts
  npm test --prefix cloudflare-worker
  actionlint .github/workflows/ocr-engine.yml
  git diff --check
  ```

  No actual Decision/model/API runtime checks. Tool unavailable means NOT_RUN with reason.
  Hash the code manifest before/after checks to prove no tested source changed.
- [ ] **Step 3:** Write new evidence against the fixed CODE_SHA and Task 15 matrix. G1 implementation result,
  independent G1 assessment, complete audit coverage, and G2/G3/G4 operational authorization are distinct fields.
  A full local G1 PASS requires every offline acceptance assertion actually covered/executed, not just suite exit 0.
  Otherwise use PARTIAL/BLOCKED and list missing assertions. G2/G3/G4 remain NOT_RUN/NOT_GRANTED as applicable.
- [ ] **Step 4:** Preserve original evidence text and append correction: old SHA exists locally but GitHub API
  lookup returned 422 in the 2026-10-21 evaluation; missing command names and T-ID mismatches invalidate its use
  as current-HEAD proof. Link new evidence; do not invent historical test execution logs.
- [ ] **Step 5:** Run Markdown lint on new/changed documents, traceability tests, and `git diff --check`.
  Review intended diff and verify no private context, raw prompt, auth token, machine-specific path, or real
  synthetic approval leaked into tracked configuration. If authorized, commit only evidence/docs changes with
  `docs(ocr): 固定SHAでG1是正証跡を再構成`. Later code changes require a new evidence run.
- [ ] **Step 6:** Request independent review of the accepted plan contracts, code, regression proofs and G1 evidence.
  Do not mark findings closed, claim independent certification, enable shadow/enforce, push, or merge by inference.

## Acceptance and self-review checklist

- [ ] REM-001 / TARGET-001: verified evidence and independent CLI inventory reach resolver and Host,
  and enforce spawns the exact verified executable;
  missing/tampered/expired evidence prevents enforce execution (Tasks 5–8, 13).
- [ ] REM-002 / TARGET-002: stage-specific Owner authority with current central registry/dossier reads
  gates startup and is revalidated at downstream effects;
  missing approval cannot be bypassed by skip, an output string, shadow best-effort, or `always()` (Tasks 2–3, 6–13).
- [ ] REM-003 / TARGET-003: valid certified fallback can publish with executed!=selected primary;
  unauthorized/wrong-tier/incomplete attempts cannot (Tasks 8–11, 13).
- [ ] REM-004 / UNV-001: observed origin and actual HEAD independently match target/REST/run binding;
  no claim of cryptographic Git-origin proof or proven historical exploit (Tasks 4, 7, 13).
- [ ] REM-005 / DOC-001: all original IDs retain their meanings and reference executed assertions or explicit gaps;
  code SHA, later evidence revision, and remote availability are separate facts (Tasks 15–16).
- [ ] Existing contracts not being redesigned: 15-key external state, run ID string/safe-number attempt,
  OCR schema/scope, egress default deny, free single Decision request, explicit fallback array,
  immutable 3-file audit, 30-day retention, repeated HEAD checks, thread disablement, sanitized enforce diagnostics.
  Preserve their existing tests and validate their traceability rather than restating the entire R4 specification.
- [ ] RMP-001–005 have owned negative tests; revocation is per-effect best-effort, not instantaneous
  cancellation. Enforce posting has one path, and intermediate Task 2–11 revisions are not deployable.
- [ ] Review Focus lines 1–5 each have an owning test task; production entrypoints are used by integration tests.
- [ ] Recheck function/field names, exact file paths, no source/config implementation during planning, no new
  AI agent configuration, no real grant/certification, and no accidental operational PASS claims.

## Execution handoff

The Owner must review and accept these plan-only contracts at Task 1 and choose execution method.
No new remediation specification is requested. For this authorization-sensitive change,
subagent-driven implementation/review is recommended if the harness provides suitable implementer/reviewer agents.
Only exploration/librarian agents are currently exposed; do not silently use them as full implementation agents.
Native execution is the supported fallback and uses the same Task 1 plan-contract approval stop.
Neither method selection nor spec approval grants operational activation or GitHub write permission.
