#!/usr/bin/env node

/**
 * Post OCR review results as GitHub PR review comments.
 *
 * Usage:
 *   node post-ocr-comments.mjs --repo owner/repo --pr 123 --result /tmp/ocr-result.json
 *
 * Environment variables:
 *   GITHUB_TOKEN - GitHub API token (required)
 */

import fs from 'node:fs';
import https from 'node:https';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

class CliError extends Error {}

function getArg(args, key) {
  const index = args.indexOf(`--${key}`);
  return index >= 0 ? args[index + 1] : null;
}

function createConfig(args, token) {
  const repo = getArg(args, 'repo');
  const prNumber = getArg(args, 'pr');
  const resultPath = getArg(args, 'result');

  if (!repo || !prNumber || !resultPath) {
    throw new CliError('Usage: node post-ocr-comments.mjs --repo owner/repo --pr <num> --result <path>');
  }

  if (!token) {
    throw new CliError('GITHUB_TOKEN environment variable is required');
  }

  return { prNumber, repo, resultPath, token };
}

function readResult(resultPath) {
  if (!fs.existsSync(resultPath)) {
    throw new CliError(`Result file not found: ${resultPath}`);
  }

  let result;
  try {
    result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
  } catch (error) {
    throw new CliError(`Failed to parse result JSON file: ${error.message}`);
  }

  if (!result || typeof result !== 'object') {
    throw new CliError('Invalid result format: expected an object');
  }

  return result;
}

function isValidLineNumber(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function normalizeComment(comment) {
  if (!comment || typeof comment !== 'object') {
    return null;
  }
  const path = typeof comment.path === 'string' ? comment.path : null;
  const body = typeof comment.body === 'string'
    ? comment.body
    : typeof comment.content === 'string' ? comment.content : null;

  let line = null;
  if (isValidLineNumber(comment.line)) {
    line = comment.line;
  } else if (isValidLineNumber(comment.end_line)) {
    line = comment.end_line;
  } else if (isValidLineNumber(comment.start_line)) {
    line = comment.start_line;
  }

  if (!path || line === null || !body) {
    return null;
  }

  return { path, line, body };
}

function getValidComments(comments) {
  const validComments = [];
  for (const comment of comments) {
    const normalized = normalizeComment(comment);
    if (!normalized) {
      console.warn('Skipping invalid comment element in result:', JSON.stringify(comment));
      continue;
    }
    validComments.push(normalized);
  }
  return validComments;
}

/**
 * Wrap a review comment body in a Markdown code block.
 *
 * Uses a fence longer than any backtick run inside the body so the
 * inner content (which may itself contain triple-backtick fenced code)
 * is never terminated prematurely. Returns an empty string for an
 * empty body.
 */
function wrapInCodeBlock(body, language = '') {
  if (!body) {
    return '';
  }
  const backtickRuns = body.match(/`+/g) || [];
  const longestRun = backtickRuns.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${body}\n${fence}`;
}

function buildSummarySection(comments, ocrSummary) {
  const countsByPath = new Map();
  for (const comment of comments) {
    countsByPath.set(comment.path, (countsByPath.get(comment.path) || 0) + 1);
  }
  const elapsed = ocrSummary && typeof ocrSummary.elapsed === 'string'
    ? ` / 所要時間: ${ocrSummary.elapsed}`
    : '';
  const rows = [...countsByPath]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
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

function buildCombinedCodeBlock(comments, maxTranscriptLength) {
  let transcript = comments
    .map(({ body, line, path }) => `[${path}:${line}]\n${body}`)
    .join('\n\n');

  if (typeof maxTranscriptLength === 'number' && transcript.length > maxTranscriptLength) {
    const truncatedNotice = '...（残りは省略）';
    const truncateIndex = Math.max(0, maxTranscriptLength - truncatedNotice.length);
    transcript = transcript.substring(0, truncateIndex) + truncatedNotice;
  }

  return wrapInCodeBlock(transcript, 'text');
}

function buildSummaryBody(comments, ocrSummary) {
  const MAX_LENGTH = 65536;
  const footer = '\n\n---\n*Posted by OpenCodeReview*';
  const summarySection = buildSummarySection(comments, ocrSummary);
  const separator = '\n\n';

  // Calculate initial max transcript length assuming minimal fence (```)
  let maxTranscriptLength = MAX_LENGTH - summarySection.length - separator.length - footer.length - '```text\n\n```'.length;

  let codeBlock = buildCombinedCodeBlock(comments, maxTranscriptLength);

  // Adjust if actual code block fences are longer than assumed
  while (
    summarySection.length + separator.length + codeBlock.length + footer.length > MAX_LENGTH &&
    maxTranscriptLength > 0
  ) {
    const excess = summarySection.length + separator.length + codeBlock.length + footer.length - MAX_LENGTH;
    maxTranscriptLength = Math.max(0, maxTranscriptLength - excess);
    codeBlock = buildCombinedCodeBlock(comments, maxTranscriptLength);
  }

  const body = summarySection + separator + codeBlock;
  return body + footer;
}

async function postSkipComment({ githubApi, prNumber, message }) {
  const response = await githubApi('POST', `/issues/${prNumber}/comments`, {
    body: message,
  });
  if (response.status < 200 || response.status >= 300) {
    console.error('Failed to post skip comment:', JSON.stringify(response.data));
    return 1;
  }
  console.log('Posted skip comment to PR');
  return 0;
}

async function postFailureComment({ githubApi, prNumber, message }) {
  const response = await githubApi('POST', `/issues/${prNumber}/comments`, {
    body: message,
  });
  if (response.status < 200 || response.status >= 300) {
    console.error('Failed to post failure comment:', JSON.stringify(response.data));
    return 1;
  }
  console.log('Posted failure comment to PR');
  return 0;
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

function createGithubApi({ repo, token }) {
  return function githubApi(method, path, body = null) {
    return new Promise((resolveRequest, rejectRequest) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${repo}${path}`,
        method,
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'OpenCodeReview-CI',
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('error', rejectRequest);
        res.on('end', () => {
          try {
            resolveRequest({ status: res.statusCode, data: data ? JSON.parse(data) : null });
          } catch (error) {
            resolveRequest({ status: res.statusCode, data: null });
          }
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error('GitHub API request timed out'));
      });

      req.on('error', rejectRequest);
      if (body !== null) req.write(JSON.stringify(body));
      req.end();
    });
  };
}

async function fetchAllPrFiles(githubApi, prNumber) {
  const filesMap = new Map();
  let page = 1;
  while (true) {
    const response = await githubApi('GET', `/pulls/${prNumber}/files?per_page=100&page=${page}`);
    if (response.status !== 200 || !Array.isArray(response.data)) {
      throw new CliError(`Failed to fetch PR files (page ${page})`);
    }
    for (const file of response.data) {
      filesMap.set(file.filename, file);
    }
    if (response.data.length < 100) break;
    page++;
  }
  return filesMap;
}

async function postReviewComments({ comments, githubApi, prNumber }) {
  if (comments.length === 0) {
    console.log('No comments to post');
    return 0;
  }

  const prData = await githubApi('GET', `/pulls/${prNumber}`);
  if (prData.status !== 200) {
    throw new CliError('Failed to fetch PR data');
  }

  const headSha = prData.data.head.sha;
  const filesMap = await fetchAllPrFiles(githubApi, prNumber);
  const reviewComments = [];
  for (const comment of comments) {
    const position = findDiffPosition(comment, filesMap);
    if (position) {
      reviewComments.push({
        path: comment.path,
        line: position.line,
        side: position.side,
        body: `${wrapInCodeBlock(comment.body)}\n\n---\n*Posted by OpenCodeReview*`,
      });
    }
  }

  if (reviewComments.length === 0) {
    console.log('No valid positions found for comments');
    return 0;
  }

  const review = await githubApi('POST', `/pulls/${prNumber}/reviews`, {
    commit_id: headSha,
    event: 'COMMENT',
    body: '',
    comments: reviewComments,
  });

  if (review.status >= 200 && review.status < 300) {
    console.log(`Posted ${reviewComments.length} review comments`);
    return 0;
  }

  console.warn(`Batch review failed; posting ${reviewComments.length} comments individually`);
  let failureCount = 0;
  for (const comment of reviewComments) {
    try {
      const response = await githubApi('POST', `/pulls/${prNumber}/comments`, {
        commit_id: headSha,
        path: comment.path,
        line: comment.line,
        side: comment.side,
        body: comment.body,
      });
      if (response.status < 200 || response.status >= 300) {
        failureCount++;
        console.error(`Failed to post individual review comment: ${JSON.stringify(response.data)}`);
      }
    } catch (error) {
      failureCount++;
      console.error('Failed to post individual review comment:', error);
    }
  }

  if (failureCount > 0) {
    console.error(`Failed to post ${failureCount} individual review comments`);
    return 1;
  }

  console.log(`Posted ${reviewComments.length} review comments individually`);
  return 0;
}

function findDiffPosition(comment, filesMap) {
  const file = filesMap.get(comment.path);
  if (!file) return null;

  const patchLines = file.patch ? file.patch.split('\n') : [];
  let position = null;

  for (let index = 0; index < patchLines.length; index++) {
    const line = patchLines[index];
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        const startLine = parseInt(match[1]);
        const count = match[2] ? parseInt(match[2]) : 1;
        if (count > 0) {
          const endLine = startLine + count - 1;
          if (comment.line >= startLine && comment.line <= endLine) {
            position = { line: comment.line, side: 'RIGHT' };
            break;
          }
        }
      }
    }
  }

  return position;
}

export async function run({ args = process.argv.slice(2), token = process.env.GITHUB_TOKEN } = {}) {
  const config = createConfig(args, token);
  const result = readResult(config.resultPath);
  const githubApi = createGithubApi(config);

  if (result.status === 'skipped') {
    const skipMessage = result.message
      ? `\u23ED\uFE0F OpenCodeReview skipped: ${result.message}`
      : '\u23ED\uFE0F OpenCodeReview skipped: No supported files changed.';
    return postSkipComment({ githubApi, prNumber: config.prNumber, message: skipMessage });
  }

  if (result.status === 'failed') {
    const failureMessage = result.message || 'OpenCodeReview failed to complete the review.';
    const commentBody = `❌ OpenCodeReview failed: ${failureMessage}\n\n` +
      `If this persists, please check your LLM configuration and API key.`;
    const exitCode = await postFailureComment({ githubApi, prNumber: config.prNumber, message: commentBody });
    if (exitCode !== 0) {
      return exitCode;
    }
    return 1;
  }

  if (!Array.isArray(result.comments)) {
    throw new CliError('Invalid result format: "comments" property must be an array');
  }

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
}

const executedDirectly = process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (executedDirectly) {
  run().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    if (error instanceof CliError) {
      console.error(error.message);
    } else {
      console.error('Error posting comments:', error);
    }
    process.exitCode = 1;
  });
}
