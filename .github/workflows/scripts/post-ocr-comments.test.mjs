import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { afterEach, mock, test } from 'node:test';

import { run } from './post-ocr-comments.mjs';

const temporaryDirectories = [];

async function createResultFile(content) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'post-ocr-comments-'));
  temporaryDirectories.push(directory);
  const resultPath = path.join(directory, 'result.json');
  await fs.writeFile(resultPath, JSON.stringify(content), 'utf8');
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

function reviewSetup(outcomes, summaryOutcome = { data: {}, status: 201 }) {
  return [
    { data: { head: { sha: 'head-sha' } }, status: 200 },
    {
      data: [{ filename: 'src/example.js', patch: '@@ -1 +1 @@\n+updated line' }],
      status: 200,
    },
    ...outcomes,
    summaryOutcome,
  ];
}

async function runWith(comments, outcomes) {
  return runWithResult({ comments }, outcomes);
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
  assert.equal(requests.length, 4);
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
  assert.equal(requests.length, 4);
  assert.equal(requests[2].method, 'POST');
  assert.equal(requests[2].path, '/repos/owner/repo/pulls/123/reviews');
  assert.deepEqual(requests[2].body, {
    body: '',
    comments: [{
      body: '```\nInspect this\n```\n\n---\n*Posted by OpenCodeReview*',
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
  assert.equal(requests.length, 6);
  assert.equal(requests[3].path, '/repos/owner/repo/pulls/123/comments');
  assert.deepEqual(requests[3].body, {
    body: '```\nFirst\n```\n\n---\n*Posted by OpenCodeReview*',
    commit_id: 'head-sha',
    line: 1,
    path: 'src/example.js',
    side: 'RIGHT',
  });
  assert.deepEqual(requests[4].body, {
    body: '```\nSecond\n```\n\n---\n*Posted by OpenCodeReview*',
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
  assert.equal(requests[4].body.body, '```\nSecond\n```\n\n---\n*Posted by OpenCodeReview*');
});

test('propagates a batch transport error without an individual fallback', async () => {
  // Given
  const transportError = new Error('network unavailable');
  const resultPath = await createResultFile({ comments: [validComment()] });
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

test('normalizes OCR-format comments (content, end_line) to body and line', async () => {
  // Given
  // When
  const { exitCode, requests } = await runWith(
    [{ path: 'src/example.js', content: 'OCR comment', end_line: 1 }],
    reviewSetup([{ data: {}, status: 201 }]),
  );

  // Then
  assert.equal(exitCode, 0);
  assert.equal(requests[2].body.comments.length, 1);
  assert.equal(requests[2].body.comments[0].body, '```\nOCR comment\n```\n\n---\n*Posted by OpenCodeReview*');
  assert.equal(requests[2].body.comments[0].line, 1);
});

test('prefers body/line over content/end_line when both are present', async () => {
  // Given
  // When
  const { exitCode, requests } = await runWith(
    [{ path: 'src/example.js', body: 'Preferred', line: 1, content: 'Ignored', end_line: 99 }],
    reviewSetup([{ data: {}, status: 201 }]),
  );

  // Then
  assert.equal(exitCode, 0);
    assert.equal(requests[2].body.comments[0].body, '```\nPreferred\n```\n\n---\n*Posted by OpenCodeReview*');
    assert.equal(requests[2].body.comments[0].line, 1);
});

test('falls back to start_line when end_line is missing in OCR format', async () => {
  // Given
  // When
  const { exitCode, requests } = await runWith(
    [{ path: 'src/example.js', content: 'Start only', start_line: 1 }],
    reviewSetup([{ data: {}, status: 201 }]),
  );

  // Then
  assert.equal(exitCode, 0);
    assert.equal(requests[2].body.comments[0].line, 1);
  });

test('skips comments with invalid line numbers', async () => {
  // Given
  const warn = mock.method(console, 'warn', () => {});

  // When
  const { exitCode, requests } = await runWith(
    [
      { path: 'src/example.js', body: 'zero', line: 0 },
      { path: 'src/example.js', body: 'negative', line: -1 },
      { path: 'src/example.js', body: 'decimal', line: 1.5 },
      validComment('valid'),
    ],
    reviewSetup([{ data: {}, status: 201 }]),
  );

  // Then
  assert.equal(exitCode, 0);
  assert.equal(requests[2].body.comments.length, 1);
  assert.equal(requests[2].body.comments[0].line, 1);
  assert.equal(warn.mock.calls.length, 3);
});

test('skips OCR-format comments with invalid end_line or start_line', async () => {
  // Given
  const warn = mock.method(console, 'warn', () => {});

  // When
  const { exitCode, requests } = await runWith(
    [
      { path: 'src/example.js', content: 'zero end', end_line: 0 },
      { path: 'src/example.js', content: 'negative start', start_line: -1 },
      validComment('valid'),
    ],
    reviewSetup([{ data: {}, status: 201 }]),
  );

  // Then
  assert.equal(exitCode, 0);
  assert.equal(requests[2].body.comments.length, 1);
  assert.equal(requests[2].body.comments[0].line, 1);
  assert.equal(warn.mock.calls.length, 2);
});

async function runWithResult(result, outcomes) {
  const resultPath = await createResultFile(result);
  const requests = installHttpsMock(outcomes);
  const exitCode = await run({
    args: ['--repo', 'owner/repo', '--pr', '123', '--result', resultPath],
    token: 'test-token',
  });

  return { exitCode, requests };
}

test('posts one Summary issue comment with generated counts and all valid findings', async () => {
  // Given
  const result = {
    comments: [
      { body: 'First finding', line: 2, path: 'src/alpha.js' },
      { body: 'Second finding', line: 4, path: 'src/beta.js' },
    ],
    summary: { elapsed: '1m2s' },
  };
  const outcomes = [
    { data: { head: { sha: 'head-sha' } }, status: 200 },
    {
      data: [
        { filename: 'src/alpha.js', patch: '@@ -2 +2 @@\n+alpha updated' },
        { filename: 'src/beta.js', patch: '@@ -4 +4 @@\n+beta updated' },
      ],
      status: 200,
    },
    { data: {}, status: 201 },
    { data: {}, status: 201 },
  ];

  // When
  const { exitCode, requests } = await runWithResult(result, outcomes);

  // Then
  assert.equal(exitCode, 0);
  assert.equal(requests.length, 4);
  assert.deepEqual(requests[3], {
    method: 'POST',
    path: '/repos/owner/repo/issues/123/comments',
    body: {
      body: '## 📋 OpenCodeReview Summary\n\n2 件のコメント / 2 ファイル / 所要時間: 1m2s\n\n| ファイル | コメント数 |\n| --- | --- |\n| `src/alpha.js` | 1 |\n| `src/beta.js` | 1 |\n\n```text\n[src/alpha.js:2]\nFirst finding\n\n[src/beta.js:4]\nSecond finding\n```\n\n---\n*Posted by OpenCodeReview*',
    },
  });
});

test('sorts Summary file rows by UTF-16 code unit regardless of input order', async () => {
  // Given
  const result = {
    comments: [
      { body: 'Umlaut finding', line: 2, path: 'src/ä.js' },
      { body: 'Zed finding', line: 4, path: 'src/z.js' },
    ],
  };
  const outcomes = [
    { data: { head: { sha: 'head-sha' } }, status: 200 },
    {
      data: [
        { filename: 'src/ä.js', patch: '@@ -2 +2 @@\n+umlaut updated' },
        { filename: 'src/z.js', patch: '@@ -4 +4 @@\n+zed updated' },
      ],
      status: 200,
    },
    { data: {}, status: 201 },
    { data: {}, status: 201 },
  ];

  // When
  const { exitCode, requests } = await runWithResult(result, outcomes);

  // Then
  assert.equal(exitCode, 0);
  const summaryBody = requests[3].body.body;
  assert.ok(summaryBody.indexOf('| `src/z.js` | 1 |') < summaryBody.indexOf('| `src/ä.js` | 1 |'));
});

test('posts a Summary when valid comments have no diff positions', async () => {
  // Given
  const outcomes = [
    { data: { head: { sha: 'head-sha' } }, status: 200 },
    {
      data: [{ filename: 'src/example.js', patch: '@@ -1 +10 @@\n+updated line' }],
      status: 200,
    },
    { data: {}, status: 201 },
  ];

  // When
  const { exitCode, requests } = await runWithResult(
    { comments: [validComment('Outside the diff')] },
    outcomes,
  );

  // Then
  assert.equal(exitCode, 0);
  assert.equal(requests.length, 3);
  assert.equal(requests[2].path, '/repos/owner/repo/issues/123/comments');
  assert.match(requests[2].body.body, /\[src\/example\.js:1\]\nOutside the diff/);
});

test('uses one longer fence around a Summary containing triple backticks', async () => {
  // Given
  const result = {
    comments: [validComment('```js\nconsole.log(1)\n```')],
    summary: {},
  };

  // When
  const { exitCode, requests } = await runWithResult(
    result,
    reviewSetup([{ data: {}, status: 201 }]),
  );

  // Then
  assert.equal(exitCode, 0);
  assert.match(
    requests[3].body.body,
    /\n\n````text\n\[src\/example\.js:1\]\n```js\nconsole\.log\(1\)\n```\n````\n\n---/,
  );
});

test('does not post a Summary when no comments are valid', async () => {
  // Given
  const warn = mock.method(console, 'warn', () => {});

  // When
  const { exitCode, requests } = await runWithResult(
    { comments: [null, { path: 'src/example.js' }], summary: { elapsed: '2s' } },
    [],
  );

  // Then
  assert.equal(exitCode, 0);
  assert.equal(requests.length, 0);
  assert.equal(warn.mock.calls.length, 2);
});

test('returns one when posting the Summary comment fails after inline review', async () => {
  // Given
  const error = mock.method(console, 'error', () => {});

  // When
  const { exitCode, requests } = await runWithResult(
    { comments: [validComment()] },
    reviewSetup(
      [{ data: {}, status: 201 }],
      { data: { message: 'Forbidden' }, status: 403 },
    ),
  );

  // Then
  assert.equal(exitCode, 1);
  assert.equal(requests.length, 4);
  assert.equal(requests[2].path, '/repos/owner/repo/pulls/123/reviews');
  assert.equal(requests[3].path, '/repos/owner/repo/issues/123/comments');
  assert.equal(error.mock.calls.length, 1);
});

test('posts inline review then Summary for an OCR-format result', async () => {
  // Given
  const result = {
    comments: [{ content: 'OCR finding', end_line: 1, path: 'src/example.js' }],
    summary: { elapsed: '2s' },
  };

  // When
  const { exitCode, requests } = await runWithResult(
    result,
    reviewSetup([{ data: {}, status: 201 }]),
  );

  // Then
  assert.equal(exitCode, 0);
  assert.equal(requests.length, 4);
  assert.equal(requests[2].path, '/repos/owner/repo/pulls/123/reviews');
  assert.equal(requests[3].path, '/repos/owner/repo/issues/123/comments');
  assert.match(requests[3].body.body, /\[src\/example\.js:1\]\nOCR finding/);
  assert.match(requests[3].body.body, /所要時間: 2s/);
});

test('omits elapsed from the Summary when it is not a string', async () => {
  // Given
  const result = {
    comments: [validComment()],
    summary: { elapsed: 2 },
  };

  // When
  const { exitCode, requests } = await runWithResult(
    result,
    reviewSetup([{ data: {}, status: 201 }]),
  );

  // Then
  assert.equal(exitCode, 0);
  assert.doesNotMatch(requests[3].body.body, /所要時間/);
});

test('posts a skip comment when OCR status is skipped with a message', async () => {
  // Given
  // When
  const { exitCode, requests } = await runWithResult(
    { status: 'skipped', message: 'No supported files changed.', comments: [] },
    [{ data: { id: 1 }, status: 201 }],
  );

  // Then
  assert.equal(exitCode, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].path, '/repos/owner/repo/issues/123/comments');
  assert.equal(requests[0].body.body, '⏭️ OpenCodeReview skipped: No supported files changed.');
});

test('posts a default skip comment when OCR status is skipped without a message', async () => {
  // Given
  // When
  const { exitCode, requests } = await runWithResult(
    { status: 'skipped', comments: [] },
    [{ data: { id: 1 }, status: 201 }],
  );

  // Then
  assert.equal(exitCode, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.body, '⏭️ OpenCodeReview skipped: No supported files changed.');
});

test('returns one when posting skip comment fails', async () => {
  // Given
  // When
  const { exitCode, requests } = await runWithResult(
  { status: 'skipped', message: 'No supported files changed.', comments: [] },
  [{ data: { message: 'Forbidden' }, status: 403 }],
  );

  // Then
  assert.equal(exitCode, 1);
  assert.equal(requests.length, 1);
    assert.equal(requests[0].body.body, '⏭️ OpenCodeReview skipped: No supported files changed.');
});

test('wraps each review comment body in a code block', async () => {
  // Given
  // When
  const { exitCode, requests } = await runWith(
    [validComment('Inspect this')],
    reviewSetup([{ data: {}, status: 201 }]),
  );

  // Then
  assert.equal(exitCode, 0);
  assert.equal(
    requests[2].body.comments[0].body,
    '```\nInspect this\n```\n\n---\n*Posted by OpenCodeReview*',
  );
});

test('uses a longer fence when the comment body contains triple backticks', async () => {
  // Given
  // When
  const { exitCode, requests } = await runWith(
    [validComment('```js\nconsole.log(1)\n```')],
    reviewSetup([{ data: {}, status: 201 }]),
  );

  // Then
  assert.equal(exitCode, 0);
  assert.equal(
    requests[2].body.comments[0].body,
    '````\n```js\nconsole.log(1)\n```\n````\n\n---\n*Posted by OpenCodeReview*',
  );
});

test('uses an even longer fence for long backtick runs in the body', async () => {
  // Given
  // When
  const { exitCode, requests } = await runWith(
    [validComment('````\ncode\n````')],
    reviewSetup([{ data: {}, status: 201 }]),
  );

  // Then
  assert.equal(exitCode, 0);
  assert.equal(
    requests[2].body.comments[0].body,
    '`````\n````\ncode\n````\n`````\n\n---\n*Posted by OpenCodeReview*',
  );
});

test('truncates summary comment body to stay within 65536 characters while preserving closing fence and footer', async () => {
  // Given
  const longBody = 'A'.repeat(1000);
  const comments = Array.from({ length: 70 }, () => validComment(longBody));
  const result = { comments, summary: {} };

  // When
  const { exitCode, requests } = await runWithResult(
    result,
    reviewSetup([{ data: {}, status: 201 }]),
  );

  // Then
  assert.equal(exitCode, 0);
  const summaryRequest = requests[requests.length - 1];
  const body = summaryRequest.body.body;

  assert.ok(body.length <= 65536, `Body length ${body.length} exceeds 65536`);
  assert.match(body, /\n\n---\n\*Posted by OpenCodeReview\*$/);
  assert.match(body, /\.{3}（残りは省略）\n```+\n\n---\n\*Posted by OpenCodeReview\*$/);
});
