#!/usr/bin/env node

/**
 * Post OCR review results as GitHub PR review comments.
 *
 * Usage:
 *   node post-ocr-comments.js --repo owner/repo --pr 123 --result /tmp/ocr-result.json
 *
 * Environment variables:
 *   GITHUB_TOKEN - GitHub API token (required)
 */

import fs from 'node:fs';
import https from 'node:https';

const args = process.argv.slice(2);
const getArg = (key) => {
  const idx = args.indexOf(`--${key}`);
  return idx >= 0 ? args[idx + 1] : null;
};

const repo = getArg('repo');
const prNumber = getArg('pr');
const resultPath = getArg('result');

if (!repo || !prNumber || !resultPath) {
  console.error('Usage: node post-ocr-comments.js --repo owner/repo --pr <num> --result <path>');
  process.exit(1);
}

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('GITHUB_TOKEN environment variable is required');
  process.exit(1);
}

if (!fs.existsSync(resultPath)) {
  console.error(`Result file not found: ${resultPath}`);
  process.exit(1);
}

let result;
try {
  result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
} catch (err) {
  console.error(`Failed to parse result JSON file: ${err.message}`);
  process.exit(1);
}

if (!result || typeof result !== 'object') {
  console.error('Invalid result format: expected an object');
  process.exit(1);
}

if (!Array.isArray(result.comments)) {
  console.error('Invalid result format: "comments" property must be an array');
  process.exit(1);
}

for (const comment of result.comments) {
  if (
    !comment ||
    typeof comment !== 'object' ||
    typeof comment.path !== 'string' ||
    typeof comment.line !== 'number' ||
    typeof comment.body !== 'string'
  ) {
    console.error('Invalid comment element in result:', JSON.stringify(comment));
    process.exit(1);
  }
}

// GitHub API helper
function githubApi(method, path, body = null) {
  return new Promise((resolve, reject) => {
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
      res.on('error', reject);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
        } catch (e) {
          resolve({ status: res.statusCode, data: null });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('GitHub API request timed out'));
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function fetchAllPrFiles() {
  const filesMap = new Map();
  let page = 1;
  while (true) {
    const res = await githubApi('GET', `/pulls/${prNumber}/files?per_page=100&page=${page}`);
    if (res.status !== 200 || !Array.isArray(res.data)) {
      console.error(`Failed to fetch PR files (page ${page})`);
      return null;
    }
    for (const file of res.data) {
      filesMap.set(file.filename, file);
    }
    if (res.data.length < 100) break;
    page++;
  }
  return filesMap;
}

async function postReviewComments() {
  const comments = result.comments;

  if (comments.length === 0) {
    console.log('No comments to post');
    return;
  }

  // Get PR diff for line positioning
  const prData = await githubApi('GET', `/pulls/${prNumber}`);
  if (prData.status !== 200) {
    console.error('Failed to fetch PR data');
    process.exit(1);
  }

  const headSha = prData.data.head.sha;

  // Fetch all PR files to build a lookup map
  const filesMap = await fetchAllPrFiles();
  if (!filesMap) {
    process.exit(1);
  }

  // Calculate position in diff for each comment
  const reviewComments = [];
  for (const comment of comments) {
    const position = findDiffPosition(comment, filesMap);
    if (position) {
      reviewComments.push({
        path: comment.path,
        line: position.line,
        side: position.side,
        body: `${comment.body}\n\n---\n*Posted by OpenCodeReview*`,
      });
    }
  }

  if (reviewComments.length === 0) {
    console.log('No valid positions found for comments');
    return;
  }

  // Post as pull request review
  const review = await githubApi('POST', `/pulls/${prNumber}/reviews`, {
    commit_id: headSha,
    event: 'COMMENT',
    body: '',
    comments: reviewComments,
  });

  if (review.status >= 200 && review.status < 300) {
    console.log(`Posted ${reviewComments.length} review comments`);
  } else {
    console.error(`Failed to post review: ${JSON.stringify(review.data)}`);
    process.exit(1);
  }
}

function findDiffPosition(comment, filesMap) {
  const file = filesMap.get(comment.path);
  if (!file) return null;

  // Find position in patch
  const patchLines = file.patch ? file.patch.split('\n') : [];
  let position = null;

  for (let i = 0; i < patchLines.length; i++) {
    const line = patchLines[i];
    if (line.startsWith('@@')) {
      // Parse hunk header
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

postReviewComments().catch(err => {
  console.error('Error posting comments:', err);
  process.exit(1);
});
