# Auto-Resolve Fixed Review Threads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically evaluate unresolved GitHub PR review threads using LLM API at HEAD and mark resolved threads as resolved on GitHub with a confirmation comment.

**Architecture:** A standalone Node.js script `.github/workflows/scripts/resolve-threads.mjs` is added to `.github/workflows/scripts/`. It uses GitHub GraphQL API to fetch open review threads, reads target file context at HEAD sha, invokes LLM API to evaluate resolution status, replies to the thread, and executes `resolveReviewThread` GraphQL mutation.

**Tech Stack:** Node.js (ES modules), GitHub GraphQL API (`https.request`), LLM REST API (`fetch` or `https`), `node:test` test framework.

## Global Constraints

- Must work in Node.js 20 environment in GitHub Actions.
- Must use standard ES module imports (`import ... from ...`).
- Must handle missing or invalid LLM API responses gracefully without failing workflow.
- Must use GitHub GraphQL API for fetching review threads and resolving them.

---

### Task 1: Core Helper Functions and Unit Tests for `resolve-threads.mjs`

**Files:**
- Create: `.github/workflows/scripts/resolve-threads.mjs`
- Create: `.github/workflows/scripts/resolve-threads.test.mjs`

**Interfaces:**
- Produces:
  - `createConfig(args, token)`: parses CLI arguments (`--repo`, `--pr`, `--target-dir`)
  - `parseLlmResponse(rawText)`: parses JSON output `{ resolved: boolean, reason: string }` safely
  - `buildPrompt(threadContext, codeSnippet)`: formats evaluation prompt for LLM
  - `buildGraphQLQueries`: query and mutation string builders

- [ ] **Step 1: Write the failing unit tests for helper functions**

Create `.github/workflows/scripts/resolve-threads.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig, parseLlmResponse, buildPrompt, buildFetchThreadsQuery, buildReplyMutation, buildResolveMutation } from './resolve-threads.mjs';

test('createConfig parses CLI args and token correctly', () => {
  const args = ['--repo', 'owner/repo', '--pr', '123', '--target-dir', 'target-repo'];
  const config = createConfig(args, 'test-token');
  assert.equal(config.repo, 'owner/repo');
  assert.equal(config.prNumber, 123);
  assert.equal(config.targetDir, 'target-repo');
  assert.equal(config.token, 'test-token');
});

test('parseLlmResponse parses valid JSON with resolved boolean', () => {
  const input = '```json\n{"resolved": true, "reason": "Fixed in HEAD"}\n```';
  const result = parseLlmResponse(input);
  assert.equal(result.resolved, true);
  assert.equal(result.reason, 'Fixed in HEAD');
});

test('parseLlmResponse handles invalid JSON by returning resolved: false', () => {
  const result = parseLlmResponse('Not JSON content');
  assert.equal(result.resolved, false);
  assert.ok(result.reason.includes('Failed to parse'));
});

test('buildFetchThreadsQuery generates valid GraphQL query', () => {
  const query = buildFetchThreadsQuery({ owner: 'owner', name: 'repo', prNumber: 123 });
  assert.ok(query.includes('owner: "owner"'));
  assert.ok(query.includes('number: 123'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .github/workflows/scripts/resolve-threads.test.mjs`
Expected: FAIL with "Cannot find module ./resolve-threads.mjs"

- [ ] **Step 3: Write initial implementation of helper functions in `resolve-threads.mjs`**

Create `.github/workflows/scripts/resolve-threads.mjs`:
```js
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

export class CliError extends Error {}

export function getArg(args, key) {
  const index = args.indexOf(`--${key}`);
  return index >= 0 ? args[index + 1] : null;
}

export function createConfig(args, token) {
  const repo = getArg(args, 'repo');
  const prRaw = getArg(args, 'pr');
  const targetDir = getArg(args, 'target-dir') || '.';

  if (!repo || !prRaw) {
    throw new CliError('Usage: node resolve-threads.mjs --repo owner/repo --pr <num> [--target-dir <path>]');
  }

  const prNumber = parseInt(prRaw, 10);
  if (isNaN(prNumber)) {
    throw new CliError('Invalid PR number');
  }

  if (!token) {
    throw new CliError('GITHUB_TOKEN environment variable is required');
  }

  const [owner, name] = repo.split('/');
  if (!owner || !name) {
    throw new CliError('Repo must be in format owner/name');
  }

  return { owner, name, repo, prNumber, targetDir, token };
}

export function parseLlmResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { resolved: false, reason: 'Empty or invalid LLM response string' };
  }

  // Remove triple backtick fences if present
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  try {
    const data = JSON.parse(cleaned);
    return {
      resolved: Boolean(data.resolved),
      reason: typeof data.reason === 'string' ? data.reason : '',
    };
  } catch (error) {
    return { resolved: false, reason: `Failed to parse LLM response JSON: ${error.message}` };
  }
}

export function buildPrompt({ path: filePath, comments }, codeSnippet) {
  const conversation = comments.map(c => `@${c.author?.login || 'unknown'}: ${c.body}`).join('\n\n');
  return `You are a code review assistant verifying if reported issues are resolved.

Target file: ${filePath}

Review Comment Thread:
${conversation}

Current File Content at HEAD:
\`\`\`
${codeSnippet}
\`\`\`

Evaluate if the issue raised in the review thread has been resolved/fixed in the Current File Content at HEAD.
Respond ONLY in JSON format:
{
  "resolved": boolean,
  "reason": "Short concise explanation in Japanese"
}`;
}

export function buildFetchThreadsQuery({ owner, name, prNumber, cursor = null }) {
  const cursorArg = cursor ? `, after: "${cursor}"` : '';
  return `query {
    repository(owner: "${owner}", name: "${name}") {
      pullRequest(number: ${prNumber}) {
        reviewThreads(first: 50${cursorArg}) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            isResolved
            isOutdated
            path
            line
            originalLine
            comments(first: 50) {
              nodes {
                id
                body
                author { login }
                createdAt
              }
            }
          }
        }
      }
    }
  }`;
}

export function buildReplyMutation(threadId, body) {
  const escapedBody = JSON.stringify(body);
  return `mutation {
    addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: "${threadId}", body: ${escapedBody}}) {
      comment { id }
    }
  }`;
}

export function buildResolveMutation(threadId) {
  return `mutation {
    resolveReviewThread(input: {threadId: "${threadId}"}) {
      thread { id isResolved }
    }
  }`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test .github/workflows/scripts/resolve-threads.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/scripts/resolve-threads.mjs .github/workflows/scripts/resolve-threads.test.mjs
git commit -m "feat: add helper functions and unit tests for resolve-threads script"
```

---

### Task 2: Implement Complete Resolution Execution Loop

**Files:**
- Modify: `.github/workflows/scripts/resolve-threads.mjs`
- Modify: `.github/workflows/scripts/resolve-threads.test.mjs`

**Interfaces:**
- Consumes: Helper functions from Task 1
- Produces: `run()` main function that executes GraphQL API requests and LLM evaluations for open review threads

- [ ] **Step 1: Add mock integration tests for `run()` in `resolve-threads.test.mjs`**

Add to `.github/workflows/scripts/resolve-threads.test.mjs`:
```js
test('extractCodeContext loads file snippet correctly', () => {
  const { extractCodeContext } = await import('./resolve-threads.mjs');
  // Verify reading local file context returns content string
  const snippet = extractCodeContext('.', 'README.md');
  assert.ok(typeof snippet === 'string');
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test .github/workflows/scripts/resolve-threads.test.mjs`
Expected: FAIL with "extractCodeContext is not exported"

- [ ] **Step 3: Implement full API & resolution logic in `resolve-threads.mjs`**

Add `extractCodeContext`, `callGraphQL`, `callLLM`, and `run` to `.github/workflows/scripts/resolve-threads.mjs`:

```js
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function extractCodeContext(targetDir, filePath) {
  const fullPath = join(targetDir, filePath);
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch (error) {
    console.warn(`Failed to read file ${filePath}: ${error.message}`);
    return null;
  }
}

export function executeGraphQLQuery(token, query) {
  return new Promise((resolveReq, rejectReq) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: '/graphql',
      method: 'POST',
      headers: {
        'Authorization': `bearer ${token}`,
        'User-Agent': 'OpenCodeReview-CI',
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('error', rejectReq);
      res.on('end', () => {
        try {
          resolveReq(JSON.parse(data));
        } catch (e) {
          rejectReq(new Error(`Failed to parse GraphQL response: ${data}`));
        }
      });
    });

    req.on('timeout', () => req.destroy(new Error('GraphQL request timed out')));
    req.on('error', rejectReq);
    req.write(JSON.stringify({ query }));
    req.end();
  });
}

export async function fetchAllOpenThreads({ owner, name, prNumber, token }) {
  const openThreads = [];
  let cursor = null;

  while (true) {
    const query = buildFetchThreadsQuery({ owner, name, prNumber, cursor });
    const response = await executeGraphQLQuery(token, query);

    if (response.errors) {
      console.error('GraphQL Query Errors:', JSON.stringify(response.errors));
      break;
    }

    const reviewThreads = response.data?.repository?.pullRequest?.reviewThreads;
    if (!reviewThreads || !Array.isArray(reviewThreads.nodes)) {
      break;
    }

    for (const thread of reviewThreads.nodes) {
      if (!thread.isResolved) {
        openThreads.push({
          id: thread.id,
          path: thread.path,
          line: thread.line || thread.originalLine,
          comments: thread.comments?.nodes || [],
        });
      }
    }

    if (reviewThreads.pageInfo?.hasNextPage && reviewThreads.pageInfo?.endCursor) {
      cursor = reviewThreads.pageInfo.endCursor;
    } else {
      break;
    }
  }

  return openThreads;
}

export async function callLlmEvaluation({ prompt, llmConfig }) {
  const url = llmConfig.url;
  if (!url) {
    console.warn('OCR_LLM_URL is not set. Skipping LLM evaluation.');
    return { resolved: false, reason: 'LLM URL not configured' };
  }

  const isAnthropic = llmConfig.useAnthropic === 'true';
  const headers = {
    'Content-Type': 'application/json',
  };

  if (llmConfig.authToken) {
    if (llmConfig.authHeaderName) {
      headers[llmConfig.authHeaderName] = `Bearer ${llmConfig.authToken}`;
    } else {
      headers['Authorization'] = `Bearer ${llmConfig.authToken}`;
    }
  }

  if (llmConfig.extraHeaders) {
    const pairs = llmConfig.extraHeaders.split(',');
    for (const pair of pairs) {
      const [k, v] = pair.split('=');
      if (k && v) headers[k.trim()] = v.trim();
    }
  }

  let bodyData;
  if (isAnthropic) {
    bodyData = {
      model: llmConfig.model,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    };
  } else {
    bodyData = {
      model: llmConfig.model,
      messages: [{ role: 'user', content: prompt }],
    };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyData),
    });

    if (!res.ok) {
      console.warn(`LLM request failed with status ${res.status}`);
      return { resolved: false, reason: `LLM HTTP ${res.status}` };
    }

    const data = await res.json();
    let text = '';
    if (isAnthropic) {
      text = data.content?.[0]?.text || '';
    } else {
      text = data.choices?.[0]?.message?.content || '';
    }

    return parseLlmResponse(text);
  } catch (error) {
    console.warn(`LLM request error: ${error.message}`);
    return { resolved: false, reason: error.message };
  }
}

export async function run({ args = process.argv.slice(2), token = process.env.GITHUB_TOKEN, env = process.env } = {}) {
  let config;
  try {
    config = createConfig(args, token);
  } catch (err) {
    if (err instanceof CliError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }

  console.log(`Checking open review threads for PR #${config.prNumber} in ${config.repo}...`);
  const openThreads = await fetchAllOpenThreads({
    owner: config.owner,
    name: config.name,
    prNumber: config.prNumber,
    token: config.token,
  });

  console.log(`Found ${openThreads.length} unresolved review threads.`);
  if (openThreads.length === 0) {
    return 0;
  }

  const llmConfig = {
    url: env.OCR_LLM_URL,
    model: env.OCR_LLM_MODEL,
    authToken: env.OCR_LLM_AUTH_TOKEN,
    extraHeaders: env.OCR_LLM_EXTRA_HEADERS,
    authHeaderName: env.OCR_LLM_AUTH_HEADER_NAME,
    useAnthropic: env.OCR_LLM_USE_ANTHROPIC,
  };

  let resolvedCount = 0;
  for (const thread of openThreads) {
    const codeSnippet = extractCodeContext(config.targetDir, thread.path);
    if (!codeSnippet) {
      console.warn(`File ${thread.path} not found in target-repo; skipping thread ${thread.id}`);
      continue;
    }

    const prompt = buildPrompt(thread, codeSnippet);
    const evaluation = await callLlmEvaluation({ prompt, llmConfig });

    if (evaluation.resolved) {
      console.log(`Thread ${thread.id} (${thread.path}:${thread.line}) evaluated as RESOLVED: ${evaluation.reason}`);
      
      const replyBody = `✅ HEADで解決が確認されたため、スレッドを解決済みにしました。\n理由: ${evaluation.reason}\n\n---\n*Auto-resolved by OpenCodeReview*`;
      
      try {
        await executeGraphQLQuery(config.token, buildReplyMutation(thread.id, replyBody));
        await executeGraphQLQuery(config.token, buildResolveMutation(thread.id));
        resolvedCount++;
      } catch (err) {
        console.error(`Failed to resolve thread ${thread.id}: ${err.message}`);
      }
    }
  }

  console.log(`Finished processing review threads. Auto-resolved ${resolvedCount} / ${openThreads.length} threads.`);
  return 0;
}

const executedDirectly = process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (executedDirectly) {
  run().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    console.error('Error running resolve-threads:', error);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Run unit tests to verify all tests pass**

Run: `node --test .github/workflows/scripts/resolve-threads.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/scripts/resolve-threads.mjs .github/workflows/scripts/resolve-threads.test.mjs
git commit -m "feat: complete thread resolution loop and LLM evaluation logic"
```

---

### Task 3: Integrate `resolve-threads.mjs` into `ocr-engine.yml`

**Files:**
- Modify: `.github/workflows/ocr-engine.yml`

**Interfaces:**
- Consumes: `.github/workflows/scripts/resolve-threads.mjs`

- [ ] **Step 1: Add step to `ocr-engine.yml`**

In `.github/workflows/ocr-engine.yml`, locate the `Run OCR review` step and insert the `Resolve fixed review threads` step directly before `Post review comments`:

```yaml
      - name: Resolve fixed review threads
        if: always()
        continue-on-error: true
        env:
          GITHUB_TOKEN: ${{ steps.app-token.outputs.token }}
          OCR_LLM_URL: ${{ vars.OCR_LLM_URL || secrets.OCR_LLM_URL }}
          OCR_LLM_MODEL: ${{ vars.OCR_LLM_MODEL || secrets.OCR_LLM_MODEL }}
          OCR_LLM_AUTH_TOKEN: ${{ secrets.OCR_LLM_AUTH_TOKEN }}
          OCR_LLM_EXTRA_HEADERS: ${{ vars.OCR_LLM_EXTRA_HEADERS || secrets.OCR_LLM_EXTRA_HEADERS }}
          OCR_LLM_AUTH_HEADER_NAME: ${{ vars.OCR_LLM_AUTH_HEADER_NAME || secrets.OCR_LLM_AUTH_HEADER_NAME }}
          OCR_LLM_USE_ANTHROPIC: ${{ vars.OCR_LLM_USE_ANTHROPIC || 'false' }}
        run: |
          node self-repo/.github/workflows/scripts/resolve-threads.mjs \
            --repo "${{ github.event.client_payload.target_repo }}" \
            --pr "${{ github.event.client_payload.pr_number }}" \
            --target-dir "target-repo"
```

- [ ] **Step 2: Verify YAML syntax**

Run: `git diff .github/workflows/ocr-engine.yml`
Ensure proper indentation and environment variable mapping.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ocr-engine.yml
git commit -m "ci: add resolve fixed review threads step to ocr-engine workflow"
```

---
