# Known Review Fact Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent OpenCodeReview from publishing the known false-positive claim that `ubuntu-slim` is not an existing GitHub Actions runner label, without changing the review prompt or adding another LLM call.

**Architecture:** Add a small, deterministic post-processing module that reads a versioned known-facts registry and removes only findings that mention a registered runner label and explicitly deny its existence or validity. Run this module on `/tmp/ocr-result.json` after Antigravity returns and before the existing validation and PR-comment steps. Keep the original review context and model output generation unchanged.

**Tech Stack:** Node.js ESM, `node:test`, GitHub Actions YAML, JSON.

## Global Constraints

- Do not add `ubuntu-slim` or any other fact to the review prompt.
- Do not add a second LLM request or external network lookup to the review path.
- Suppress only existence/validity denials for labels listed in the known-facts registry.
- Preserve findings about valid but distinct constraints such as job timeout, permissions, cost, container limitations, or repository eligibility.
- Preserve result status, coverage, metadata, finding order, and all non-suppressed findings.
- Log only the number and identifiers of suppressed rules; never log secrets or full review prompts.
- Do not modify the workflow runner label as part of this change.
- Commit changes only after explicit user authorization; this task includes that authorization.

---

### Task 1: Define the known fact and failing filter tests

**Files:**
- Create: `.github/workflows/config/known-review-facts.json`
- Create: `.github/workflows/scripts/filter-ocr-findings.test.mjs`

**Interfaces:**
- Consumes: A review result object with an optional `findings` array and the known-facts JSON file. The test imports `filterKnownFalseFindings` from the implementation file that is created in Task 2.
- Produces: A planned `filterKnownFalseFindings(result)` function returning `{ result, suppressed }`.

**Known fact file contents:**

```json
{
  "github_actions_runner_labels": [
    {
      "label": "ubuntu-slim",
      "source": "https://docs.github.com/en/actions/reference/runners/github-hosted-runners",
      "verified_at": "2026-09-18"
    }
  ]
}
```

- [x] **Step 1: Add the registry with the official source URL**

Create the JSON registry exactly as shown above. The registry is consumed by
the post-processing module only; it is not included in any model prompt.

- [x] **Step 2: Write failing tests for exact suppression behavior**

Add Node test cases with these inputs and expected results:

```javascript
test('suppresses an existence denial for a registered GitHub Actions runner label', () => {
  const { result, suppressed } = filterKnownFalseFindings({
    status: 'success',
    coverage: 1,
    findings: [{
      severity: 'high',
      path: '.github/workflows/ci.yml',
      line: 4,
      message: 'ubuntu-slim does not exist as a GitHub Actions runner.',
    }],
  });

  assert.deepEqual(result.findings, []);
  assert.deepEqual(suppressed, ['github-actions-runner-label:ubuntu-slim']);
});

test('keeps a valid operational warning about the registered runner', () => {
  const { result, suppressed } = filterKnownFalseFindings({
    status: 'success',
    coverage: 1,
    findings: [{
      severity: 'medium',
      path: '.github/workflows/ci.yml',
      line: 4,
      message: 'ubuntu-slim has a 15-minute job timeout.',
    }],
  });

  assert.equal(result.findings.length, 1);
  assert.deepEqual(suppressed, []);
});
```

Also cover `is not a valid GitHub Actions runner label`, an unrelated label
denial, container-image and runner-group eligibility denials, a compound
security finding, preservation of non-finding result fields, and a result with
no `findings` array. The filter must match the entire normalized message as a
standalone runner-label claim rather than using a broad substring assertion.

- [x] **Step 3: Run the focused test and confirm it fails for the missing implementation**

Run:

```bash
node --test .github/workflows/scripts/filter-ocr-findings.test.mjs
```

Expected: FAIL because `filterKnownFalseFindings` is not implemented yet.

---

### Task 2: Implement the deterministic known-fact filter

**Files:**
- Modify: `.github/workflows/scripts/filter-ocr-findings.mjs`
- Test: `.github/workflows/scripts/filter-ocr-findings.test.mjs`

**Interfaces:**
- Consumes: `filterKnownFalseFindings(result)` where `result` is the parsed OCR JSON object.
- Produces: `{ result: filteredResult, suppressed: string[] }`, preserving the input result when no finding is suppressed.

- [x] **Step 1: Load the registry relative to the module**

Read `.github/workflows/config/known-review-facts.json` using a URL relative to
`filter-ocr-findings.mjs`, not an absolute machine-specific path. Build a map
from each registered label to the suppression identifier
`github-actions-runner-label:<label>`.

- [x] **Step 2: Implement narrow claim matching**

Extract text from a finding's `message`, `body`, or `content` string fields.
Only match a finding when the entire normalized message is a standalone claim
about a registered label's GitHub Actions runner validity. Accepted forms are
the label alone followed by an existence/validity denial, the same denial with
an explicit GitHub Actions runner context, or an explicit `runner label`
subject. Compound messages are never suppressed.

```javascript
const RUNNER_CONTEXT = '(?:github\\s+actions\\s+)?(?:hosted\\s+)?runner(?:\\s+label)?';
const RUNNER_LABEL_DENIAL = '(?:does\\s+not\\s+exist|doesn[\'’]t\\s+exist|is\\s+not\\s+(?:a\\s+)?valid|is\\s+(?:invalid|unknown|unrecognized))';
```

Do not match generic `unsupported`, timeout, cost, permission, container,
repository, runner-group, compound security, or availability claims. Those can
be legitimate even when the label exists.

- [x] **Step 3: Return filtered results without mutating caller input**

Copy the result only when a finding is suppressed. Keep the original array
order for all retained findings and return suppression identifiers rather than
full finding text. For non-object results or non-array findings, return the
input result and an empty suppression list.

- [x] **Step 4: Add the command-line entry point**

Accept one result-file path, parse it, apply the filter, and overwrite the same
file with JSON. Print a concise message such as
`Suppressed 1 known false-positive rule(s): github-actions-runner-label:ubuntu-slim`
only when suppression occurred. Exit non-zero for a missing path or invalid
JSON.

- [x] **Step 5: Run the focused tests**

Run:

```bash
node --test .github/workflows/scripts/filter-ocr-findings.test.mjs
```

Expected: PASS for every suppression, preservation, compound-message, and
non-mutating-result test. The CLI malformed-input path is verified separately
in Task 4.

---

### Task 3: Insert filtering before validation and publication

**Files:**
- Modify: `.github/workflows/ocr-engine.yml` after `Run Antigravity review host` and before `Validate review result`.
- Test: `.github/workflows/scripts/filter-ocr-findings.test.mjs` for the pure behavior; workflow wiring is verified by inspecting the final YAML diff and step order without adding a YAML parser dependency.

**Interfaces:**
- Consumes: `/tmp/ocr-result.json` produced by the existing Antigravity step.
- Produces: The same result path with only narrowly matched known false positives removed, so validation, thread resolution, summary generation, and comment publication use the filtered result.

- [x] **Step 1: Add a dedicated Actions step**

Insert this step immediately after the review host step:

```yaml
      - name: Filter known false-positive review findings
        if: always() && steps.target.outputs.internal == 'true'
        run: |
          test -f /tmp/ocr-result.json
          node self-repo/.github/workflows/scripts/filter-ocr-findings.mjs \
            /tmp/ocr-result.json
```

Keep the existing validation step unchanged so it still rejects failed or
incomplete reviews. The existing later steps will automatically read the
filtered JSON from the same path.

- [x] **Step 2: Verify no prompt or runner setting changed**

Confirm the diff does not modify the inline Antigravity prompt and does not
change any `runs-on` value. Confirm that the filter step is before both
`Validate review result` and `Post review comments`.

- [x] **Step 3: Run the complete workflow-script test suite**

Run:

```bash
node --test .github/workflows/scripts/*.test.mjs
```

Expected: PASS for every existing workflow script test and all new filter
tests.

---

### Task 4: Verify the end-to-end file contract

**Files:**
- Inspect: `.github/workflows/ocr-engine.yml`
- Inspect: `.github/workflows/scripts/filter-ocr-findings.mjs`
- Inspect: `.github/workflows/config/known-review-facts.json`

**Interfaces:**
- Consumes: The generated `/tmp/ocr-result.json` contract.
- Produces: Evidence that a suppressed false positive cannot be posted while
  legitimate runner constraints remain publishable.

- [x] **Step 1: Test the CLI against a temporary result file**

Run the following shell sequence. It creates a temporary JSON file containing
one existence denial and one timeout finding, runs the CLI filter, and checks
that only the existence denial was removed:

```bash
tmp_result="$(mktemp)"
trap 'rm -f "$tmp_result"' EXIT
node --input-type=module - "$tmp_result" <<'EOF'
import fs from 'node:fs';
import process from 'node:process';

fs.writeFileSync(process.argv[2], JSON.stringify({
  status: 'success',
  coverage: 1,
  findings: [
    { path: '.github/workflows/ci.yml', line: 4, message: 'ubuntu-slim does not exist.' },
    { path: '.github/workflows/ci.yml', line: 4, message: 'ubuntu-slim has a 15-minute job timeout.' },
  ],
}));
EOF
node .github/workflows/scripts/filter-ocr-findings.mjs "$tmp_result"
node --input-type=module - "$tmp_result" <<'EOF'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import process from 'node:process';

const result = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.equal(result.findings.length, 1);
assert.match(result.findings[0].message, /15-minute job timeout/);
EOF
```

- [x] **Step 2: Run repository diff and syntax checks**

Run:

```bash
git diff --check
node --check .github/workflows/scripts/filter-ocr-findings.mjs
```

Expected: no whitespace errors and no JavaScript syntax errors.

- [x] **Step 3: Review the final diff for scope**

Confirm the final change contains only the known-facts registry, the focused
filter and tests, and the workflow step. Do not change the Markdown review
rules, model prompt, OpenCodeReview version, runner selection, or posting API.
