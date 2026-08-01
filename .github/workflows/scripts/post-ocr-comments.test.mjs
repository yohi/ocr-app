import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { afterEach, mock, test } from 'node:test';

import { run } from './post-ocr-comments.mjs';

const temporaryDirectories = [];

async function createResultFile(comments) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'post-ocr-comments-'));
  temporaryDirectories.push(directory);
  const resultPath = path.join(directory, 'result.json');
  await fs.writeFile(resultPath, JSON.stringify({ comments }), 'utf8');
  return resultPath;
}

function installHttpsMock(outcomes) {
  const requests = [];

  mock.method(https, 'request', (options, callback) => {
    const request = new EventEmitter();
    let requestBody = '';

    request.write = (chunk) => {
      requestBody += chunk;
    };
    request.end = () => {
      const outcome = outcomes.shift();
      assert.ok(outcome, 'received an unexpected GitHub API request');
      requests.push({
        body: requestBody ? JSON.parse(requestBody) : undefined,
        method: options.method,
        path: options.path,
      });

      queueMicrotask(() => {
        if (outcome.error) {
          request.emit('error', outcome.error);
          return;
        }

        const response = new EventEmitter();
        response.statusCode = outcome.status;
        callback(response);
        if (outcome.data !== undefined) {
          response.emit('data', JSON.stringify(outcome.data));
        }
        response.emit('end');
      });
    };
    request.destroy = (error) => request.emit('error', error);

    return request;
  });

  return requests;
}

function validComment(body = 'Review this line') {
  return { body, line: 1, path: 'src/example.js' };
}

function reviewSetup(outcomes) {
  return [
    { data: { head: { sha: 'head-sha' } }, status: 200 },
    {
      data: [{ filename: 'src/example.js', patch: '@@ -1 +1 @@\n+updated line' }],
      status: 200,
    },
    ...outcomes,
  ];
}

async function runWith(comments, outcomes) {
  const resultPath = await createResultFile(comments);
  const requests = installHttpsMock(outcomes);
  const exitCode = await run({
    args: ['--repo', 'owner/repo', '--pr', '123', '--result', resultPath],
    token: 'test-token',
  });

  return { exitCode, requests };
}

afterEach(async () => {
  mock.restoreAll();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { force: true, recursive: true })));
});

test('returns zero without requests when the comments array is empty', async () => {
  // Given
  // When
  const { exitCode, requests } = await runWith([], []);

  // Then
  assert.equal(exitCode, 0);
  assert.equal(requests.length, 0);
});

test('warns and returns zero when every comment is invalid', async () => {
  // Given
  const warn = mock.method(console, 'warn', () => {});

  // When
  const { exitCode, requests } = await runWith([null, { path: 'src/example.js' }], []);

  // Then
  assert.equal(exitCode, 0);
  assert.equal(requests.length, 0);
  assert.equal(warn.mock.calls.length, 2);
});

test('posts only valid comments when the result contains invalid and valid elements', async () => {
  // Given
  const warn = mock.method(console, 'warn', () => {});

  // When
  const { exitCode, requests } = await runWith(
    [null, validComment()],
    reviewSetup([{ data: {}, status: 200 }]),
  );

  // Then
  assert.equal(exitCode, 0);
  assert.equal(warn.mock.calls.length, 1);
  assert.equal(requests.length, 3);
  assert.equal(requests[2].body.comments.length, 1);
});

test('posts a batch review when GitHub accepts the review request', async () => {
  // Given
  // When
  const { exitCode, requests } = await runWith(
    [validComment('Inspect this')],
    reviewSetup([{ data: {}, status: 201 }]),
  );

  // Then
  assert.equal(exitCode, 0);
  assert.equal(requests[2].method, 'POST');
  assert.equal(requests[2].path, '/repos/owner/repo/pulls/123/reviews');
  assert.deepEqual(requests[2].body, {
    body: '',
    comments: [{
      body: 'Inspect this\n\n---\n*Posted by OpenCodeReview*',
      line: 1,
      path: 'src/example.js',
      side: 'RIGHT',
    }],
    commit_id: 'head-sha',
    event: 'COMMENT',
  });
});

test('falls back to individual comments when GitHub rejects the batch review', async () => {
  // Given
  // When
  const { exitCode, requests } = await runWith(
    [validComment('First'), validComment('Second')],
    reviewSetup([
      { data: { message: 'Validation Failed' }, status: 422 },
      { data: {}, status: 201 },
      { data: {}, status: 201 },
    ]),
  );

  // Then
  assert.equal(exitCode, 0);
  assert.equal(requests.length, 5);
  assert.equal(requests[3].path, '/repos/owner/repo/pulls/123/comments');
  assert.deepEqual(requests[3].body, {
    body: 'First\n\n---\n*Posted by OpenCodeReview*',
    commit_id: 'head-sha',
    line: 1,
    path: 'src/example.js',
    side: 'RIGHT',
  });
  assert.deepEqual(requests[4].body, {
    body: 'Second\n\n---\n*Posted by OpenCodeReview*',
    commit_id: 'head-sha',
    line: 1,
    path: 'src/example.js',
    side: 'RIGHT',
  });
});

test('continues individual posting and returns one when an individual request fails', async () => {
  // Given
  // When
  const { exitCode, requests } = await runWith(
    [validComment('First'), validComment('Second')],
    reviewSetup([
      { data: {}, status: 422 },
      { data: { message: 'unprocessable' }, status: 422 },
      { data: {}, status: 201 },
    ]),
  );

  // Then
  assert.equal(exitCode, 1);
  assert.equal(requests.length, 5);
  assert.equal(requests[4].body.body, 'Second\n\n---\n*Posted by OpenCodeReview*');
});

test('propagates a batch transport error without an individual fallback', async () => {
  // Given
  const transportError = new Error('network unavailable');
  const resultPath = await createResultFile([validComment()]);
  const requests = installHttpsMock(
    reviewSetup([{ error: transportError }]),
  );

  // When
  const result = run({
    args: ['--repo', 'owner/repo', '--pr', '123', '--result', resultPath],
    token: 'test-token',
  });

  // Then
  await assert.rejects(result, transportError);
  assert.equal(requests.length, 3);
});
