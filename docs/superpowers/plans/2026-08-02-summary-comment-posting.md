# Summary Comment Posting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep OCR's inline review comments and additionally post one PR comment that summarizes all valid findings and includes them in one copyable code block.

**Architecture:** Preserve `postReviewComments` and its GitHub review API fallback unchanged. Add pure formatting helpers that derive file statistics and a combined `[path:line]` transcript from normalized comments, then add `postSummaryComment` using the existing issue-comment endpoint. `run()` posts the summary only after inline posting succeeds; skipped and empty-result behavior remains unchanged.

**Tech Stack:** Node.js ESM, built-in `node:test`, GitHub REST API through the existing `https` wrapper.

## Global Constraints

- Keep inline review comments and their batch-to-individual fallback behavior.
- Post exactly one additional `/issues/{pr}/comments` request for a non-empty successful OCR result.
- Render the summary in Markdown and all findings in one dynamically fenced code block.
- Prefix every finding in that block with `[path:line]`.
- Derive comment and file counts from normalized valid comments, not OCR's untrusted counters.
- If `result.summary.elapsed` is a string, include it as supplemental runtime information; do not treat OCR's `summary` as an LLM review summary.
- Do not make Git commits or pushes without an explicit user request.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `.github/workflows/scripts/post-ocr-comments.mjs` | Formats and posts the additional PR summary comment after successful inline posting. |
| `.github/workflows/scripts/post-ocr-comments.test.mjs` | Mocks GitHub API requests and locks the exact outbound summary-comment body and failure behavior. |

## Task 1: Lock summary-comment behavior with failing tests

**Files:**
- Modify: `.github/workflows/scripts/post-ocr-comments.test.mjs`

**Interfaces:**
- Consumes: exported `run({ args, token })`.
- Produces: tests proving the fourth request for a successful review is `POST /repos/owner/repo/issues/123/comments` with the exact generated body.

- [ ] **Step 1: Adapt the review response fixture for the additional request**

Change `reviewSetup` so normal successful posting tests receive a default successful response for the Summary request after the existing PR metadata, files, and review responses:

```javascript
function reviewSetup(outcomes, summaryOutcome = { data: {}, status: 201 }) {
  return [
    { data: { head: { sha: 'head-sha' } }, status: 200 },
    { data: [{ filename: 'src/example.js', patch: '@@ -1 +1 @@\n+updated line' }], status: 200 },
    ...outcomes,
    summaryOutcome,
  ];
}
```

Update existing successful-review assertions to account for the final issue-comment request while preserving the inline review payload assertions.

- [ ] **Step 2: Add a failing exact-body test for multiple findings**

Add a test with two comments in separate files. Give `runWithResult` a `summary.elapsed` value and assert the final request is:

```javascript
{
  method: 'POST',
  path: '/repos/owner/repo/issues/123/comments',
  body: {
    body: '## 📋 OpenCodeReview Summary\n\n2 件のコメント / 2 ファイル / 所要時間: 1m2s\n\n| ファイル | コメント数 |\n| --- | --- |\n| `src/alpha.js` | 1 |\n| `src/beta.js` | 1 |\n\n```text\n[src/alpha.js:2]\nFirst finding\n\n[src/beta.js:4]\nSecond finding\n```\n\n---\n*Posted by OpenCodeReview*',
  },
}
```

Use path-sorted rows so the expected body is deterministic.

- [ ] **Step 3: Add focused failing edge-case tests**

Add tests that verify:

```javascript
// One combined fence safely contains an embedded triple-backtick body.
// A result with no valid comments sends no Summary request.
// A non-2xx Summary response makes run() return 1 after the inline request.
```

For the embedded-fence case, assert the summary body contains a four-backtick outer fence around the whole concatenated transcript. For the failure case, pass the Summary response as `{ data: { message: 'Forbidden' }, status: 403 }`.

- [ ] **Step 4: Run the focused test file and confirm failure**

Run:

```bash
node --test .github/workflows/scripts/post-ocr-comments.test.mjs
```

Expected: the new tests fail because no Summary comment is currently requested.

## Task 2: Implement deterministic summary formatting and posting

**Files:**
- Modify: `.github/workflows/scripts/post-ocr-comments.mjs`

**Interfaces:**
- Consumes: normalized `{ path, line, body }[]`, optional `result.summary.elapsed`, and the existing `githubApi` function.
- Produces: `postSummaryComment({ comments, githubApi, prNumber, ocrSummary })`, returning `0` on a 2xx response and `1` otherwise.

- [ ] **Step 1: Build a file-count summary from normalized comments**

Add a helper that counts comments per path, sorts paths lexicographically, and returns Markdown rows:

```javascript
function buildSummarySection(comments, ocrSummary) {
  const countsByPath = new Map();
  for (const comment of comments) {
    countsByPath.set(comment.path, (countsByPath.get(comment.path) || 0) + 1);
  }
  const elapsed = ocrSummary && typeof ocrSummary.elapsed === 'string'
    ? ` / 所要時間: ${ocrSummary.elapsed}`
    : '';
  const rows = [...countsByPath]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([filePath, count]) => `| \`${filePath}\` | ${count} |`);

  return [
    '## 📋 OpenCodeReview Summary',
    '',
    `${comments.length} 件のコメント / ${countsByPath.size} ファイル${elapsed}`,
    '',
    '| ファイル | コメント数 |',
    '| --- | --- |',
    ...rows,
  ].join('\n');
}
```

- [ ] **Step 2: Build one location-aware transcript and wrap it once**

Add a helper that retains each OCR body verbatim but adds a location header:

```javascript
function buildCombinedCodeBlock(comments) {
  const transcript = comments
    .map(({ body, line, path }) => `[${path}:${line}]\n${body}`)
    .join('\n\n');
  return wrapInCodeBlock(transcript);
}
```

Use the existing `wrapInCodeBlock` instead of a hard-coded triple-backtick fence.

- [ ] **Step 3: Compose and post the Summary comment**

Add these functions beside `postSkipComment`:

```javascript
function buildSummaryBody(comments, ocrSummary) {
  return `${buildSummarySection(comments, ocrSummary)}\n\n${buildCombinedCodeBlock(comments)}\n\n---\n*Posted by OpenCodeReview*`;
}

async function postSummaryComment({ comments, githubApi, ocrSummary, prNumber }) {
  const response = await githubApi('POST', `/issues/${prNumber}/comments`, {
    body: buildSummaryBody(comments, ocrSummary),
  });
  if (response.status < 200 || response.status >= 300) {
    console.error('Failed to post Summary comment:', JSON.stringify(response.data));
    return 1;
  }
  console.log(`Posted Summary comment for ${comments.length} review comments`);
  return 0;
}
```

- [ ] **Step 4: Invoke Summary posting only after successful inline posting**

Replace the final return in the non-skipped `run()` branch with:

```javascript
const comments = getValidComments(result.comments);
if (comments.length === 0) {
  return 0;
}

const reviewExitCode = await postReviewComments({ comments, githubApi, prNumber: config.prNumber });
if (reviewExitCode !== 0) {
  return reviewExitCode;
}
return postSummaryComment({
  comments,
  githubApi,
  ocrSummary: result.summary,
  prNumber: config.prNumber,
});
```

- [ ] **Step 5: Run the focused test file and confirm success**

Run:

```bash
node --test .github/workflows/scripts/post-ocr-comments.test.mjs
```

Expected: all existing inline-comment, skip-comment, and new Summary-comment tests pass.

## Task 3: Validate the workflow surface

**Files:**
- Verify: `.github/workflows/scripts/post-ocr-comments.mjs`
- Verify: `.github/workflows/scripts/post-ocr-comments.test.mjs`

**Interfaces:**
- Consumes: the completed script and mocked GitHub API test harness.
- Produces: syntax, diagnostics, test, and CLI-level evidence for the new behavior.

- [ ] **Step 1: Run syntax validation**

Run:

```bash
node --check .github/workflows/scripts/post-ocr-comments.mjs
node --check .github/workflows/scripts/post-ocr-comments.test.mjs
```

Expected: both commands exit 0.

- [ ] **Step 2: Run static diagnostics for both changed JavaScript files**

Run `lsp_diagnostics` on both files after the implementation edit. If no JavaScript LSP is configured, record that limitation and rely on `node --check` plus the test suite.

- [ ] **Step 3: Drive the public CLI surface through the test harness**

Use the existing `runWithResult` test helper with an OCR-format result:

```javascript
{
  comments: [{
    content: 'OCR finding',
    end_line: 7,
    path: 'src/example.js',
  }],
  summary: { elapsed: '2s' },
}
```

Assert that `run()` sends the inline review request followed by one Summary issue-comment request, whose body contains `[src/example.js:7]` and `所要時間: 2s`.

- [ ] **Step 4: Run the full script test suite**

Run:

```bash
node --test .github/workflows/scripts/post-ocr-comments.test.mjs
```

Expected: all tests pass.
