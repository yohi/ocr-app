#!/usr/bin/env node

/**
 * Auto-resolve fixed PR review threads at HEAD using LLM API.
 *
 * Usage:
 *   node resolve-threads.mjs --repo owner/repo --pr 123 [--target-dir <path>]
 *
 * Environment variables:
 *   GITHUB_TOKEN - GitHub API token (required)
 *   OCR_LLM_URL - LLM endpoint URL
 *   OCR_LLM_MODEL - LLM model identifier
 *   OCR_LLM_AUTH_TOKEN - Auth token for LLM API
 *   OCR_LLM_EXTRA_HEADERS - Custom extra headers (key1=val1,key2=val2)
 *   OCR_LLM_AUTH_HEADER_NAME - Custom auth header name (e.g. x-api-key)
 *   OCR_LLM_USE_ANTHROPIC - Set to 'true' if using Anthropic Messages API
 */

import fs from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

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

  let cleaned = rawText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  try {
    const data = JSON.parse(cleaned);
    return {
      resolved: data.resolved === true,
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
Respond ONLY in JSON format matching this schema:
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

export function extractCodeContext(targetDir, filePath) {
  try {
    const resolvedTarget = fs.realpathSync(targetDir);
    const fullPath = join(targetDir, filePath);
    const resolvedPath = fs.realpathSync(fullPath);

    const rel = relative(resolvedTarget, resolvedPath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      return null;
    }

    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      return null;
    }

    return fs.readFileSync(resolvedPath, 'utf-8');
  } catch (error) {
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

  if (isAnthropic) {
    headers['anthropic-version'] = '2023-06-01';
  }

  if (llmConfig.authToken) {
    if (llmConfig.authHeaderName) {
      headers[llmConfig.authHeaderName] = `Bearer ${llmConfig.authToken}`;
    } else if (isAnthropic) {
      headers['x-api-key'] = llmConfig.authToken;
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
      signal: AbortSignal.timeout(30_000),
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
        const replyResult = await executeGraphQLQuery(config.token, buildReplyMutation(thread.id, replyBody));
        if (replyResult.errors || !replyResult.data?.addPullRequestReviewThreadReply?.comment?.id) {
          throw new Error(`Reply mutation failed: ${JSON.stringify(replyResult.errors || replyResult)}`);
        }

        const resolveResult = await executeGraphQLQuery(config.token, buildResolveMutation(thread.id));
        if (resolveResult.errors || !resolveResult.data?.resolveReviewThread?.thread?.isResolved) {
          throw new Error(`Resolve mutation failed: ${JSON.stringify(resolveResult.errors || resolveResult)}`);
        }

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
