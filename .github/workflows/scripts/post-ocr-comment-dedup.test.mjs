import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { afterEach, mock, test } from 'node:test';

import { run } from './post-ocr-comments.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  mock.restoreAll();
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    fs.rm(directory, { force: true, recursive: true }),
  ));
});

test('does not repost an equivalent OCR finding already in the PR review history', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'post-ocr-dedup-'));
  temporaryDirectories.push(directory);
  const resultPath = path.join(directory, 'result.json');
  await fs.writeFile(resultPath, JSON.stringify({
    coverage: 1,
    findings: [{
      body: 'Target `cpu-power-agent-hint` is invoked during `setup-system`, but it is not defined in Makefile or any included .mk files.',
      line: 76,
      path: 'Makefile',
    }],
    status: 'success',
  }));

  const calls = [];
  const existingComment = {
    body: "The target 'cpu-power-agent-hint' is invoked in 'setup-system', but no included makefile defines it.\n\n---\n*Posted by OpenCodeReview*",
    line: 76,
    path: 'Makefile',
    user: { login: 'opencodereview-app[bot]' },
  };
  const outcomes = new Map([
    ['GET /repos/owner/repo/pulls/123', { data: { head: { sha: 'head-sha' }, node_id: 'PR_node_id' }, status: 200 }],
    ['GET /repos/owner/repo/pulls/123/files?per_page=100&page=1', {
      data: [{ filename: 'Makefile', patch: '@@ -76 +76 @@\n+$(MAKE) cpu-power-agent-hint' }],
      status: 200,
    }],
    ['POST /graphql', {
      data: {
        data: {
          node: {
            reviewThreads: {
              nodes: [{
                isResolved: false,
                comments: {
                  nodes: [{
                    author: existingComment.user,
                    body: existingComment.body,
                    line: existingComment.line,
                    outdated: false,
                    path: existingComment.path,
                  }],
                },
              }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
      status: 200,
    }],
    ['GET /repos/owner/repo/issues/123/comments?per_page=100&page=1', { data: [], status: 200 }],
    ['POST /repos/owner/repo/issues/123/comments', { data: {}, status: 201 }],
  ]);

  mock.method(https, 'request', (options, callback) => {
    const request = new EventEmitter();
    let requestBody = '';
    request.write = chunk => { requestBody += chunk; };
    request.end = () => {
      const key = `${options.method} ${options.path}`;
      const outcome = outcomes.get(key);
      assert.ok(outcome, `unexpected GitHub API request: ${key}`);
      calls.push({ key, body: requestBody ? JSON.parse(requestBody) : undefined });
      queueMicrotask(() => {
        const response = new EventEmitter();
        response.statusCode = outcome.status;
        callback(response);
        response.emit('data', JSON.stringify(outcome.data));
        response.emit('end');
      });
    };
    request.destroy = error => request.emit('error', error);
    return request;
  });

  const exitCode = await run({
    args: ['--repo', 'owner/repo', '--pr', '123', '--result', resultPath],
    expectedSha: 'head-sha',
    token: 'test-token',
  });

  assert.equal(exitCode, 0);
  assert.equal(calls.some(call => call.key === 'POST /repos/owner/repo/pulls/123/reviews'), false);
  assert.equal(calls.at(-1).key, 'POST /repos/owner/repo/issues/123/comments');
});
