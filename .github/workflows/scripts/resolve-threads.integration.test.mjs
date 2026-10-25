import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './resolve-threads.mjs';
import { runThreadHost } from './antigravity-host.mjs';
import { updateCheckRun } from './update-check-run.mjs';

for (const mode of ['off', 'shadow']) {
  test(`${mode} real thread Host preserves authorized reply and explicit auto-resolve`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'ocr-thread-success-'));
    writeFileSync(join(root, 'changed.js'), 'const fixed = true;\n');
    let spawns = 0;
    let hostChecks = 0;
    let mutationChecks = 0;
    const mutations = [];
    try {
      const exitCode = await run({
        args: ['--repo', 'OWNER/REPO', '--pr', '123', '--target-dir', root, '--auto-resolve'],
        token: 'target-token',
        env: { DECISION_ROUTING_MODE: mode, TARGET_REPO: mode === 'shadow' ? 'owner/repo' : undefined },
        fetchOpenThreads: async ({ owner, name }) => {
          assert.equal(owner, 'OWNER');
          assert.equal(name, 'REPO');
          return [{ id: 'thread-1', path: 'changed.js', line: 1, comments: [] }];
        },
        authorizeBeforeHost: async () => { hostChecks++; return true; },
        authorizeBeforeMutation: async () => { mutationChecks++; return true; },
        threadHost: options => runThreadHost({ ...options, spawn: command => {
          assert.equal(command, 'agy');
          spawns++;
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.stdin = { write() {}, end() {}, once() {} };
          queueMicrotask(() => {
            child.stdout.emit('data', JSON.stringify({
              schema_version: '1.0', mode: 'thread', decision: 'resolve', reason: 'fixed',
            }));
            child.emit('close', 0, null);
          });
          return child;
        } }),
        graphql: async (_token, query) => {
          mutations.push(query);
          return query.includes('addPullRequestReviewThreadReply')
            ? { data: { addPullRequestReviewThreadReply: { comment: { id: 'reply-1' } } } }
            : { data: { resolveReviewThread: { thread: { id: 'thread-1', isResolved: true } } } };
        },
      });
      assert.equal(exitCode, 0);
      assert.equal(spawns, 1);
      assert.equal(hostChecks, 1);
      assert.equal(mutationChecks, 2);
      assert.equal(mutations.length, 2);
      assert.match(mutations[0], /addPullRequestReviewThreadReply/);
      assert.match(mutations[1], /resolveReviewThread/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('actual resolver CLI denial fails the Check despite a successful main review offline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ocr-thread-cli-'));
  writeFileSync(join(root, 'changed.js'), 'const fixed = true;\n');
  const preloadPath = join(root, 'offline-effects.mjs');
  // Replace only external I/O; execute the production CLI, fetcher, and Host.
  writeFileSync(preloadPath, `
    import https from 'node:https';
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { EventEmitter } from 'node:events';
    const effects = { reads: 0, spawns: 0, mutations: 0 };
    globalThis.fetch = async () => { throw new Error('unexpected network'); };
    childProcess.spawn = () => { effects.spawns++; throw new Error('unexpected spawn'); };
    syncBuiltinESMExports();
    https.request = (_options, respond) => {
      const req = new EventEmitter();
      let body = '';
      req.write = chunk => { body += chunk; };
      req.end = () => {
        if (JSON.parse(body).query.trim().startsWith('mutation')) {
          effects.mutations++;
          throw new Error('unexpected mutation');
        }
        effects.reads++;
        const res = new EventEmitter();
        res.statusCode = 200;
        respond(res);
        res.emit('data', JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: {
          nodes: [{
            id: 'thread-1', isResolved: false, isOutdated: false, path: 'changed.js', line: 1, originalLine: null,
            comments: { nodes: [{
              id: 'comment-1', body: 'Fix this', createdAt: '2026-10-25T00:00:00Z',
              author: { login: 'opencodereview-app' },
            }] },
          }],
          pageInfo: { hasNextPage: false, endCursor: null }
        } } } } }));
        res.emit('end');
      };
      return req;
    };
    process.on('exit', () => process.stdout.write(JSON.stringify(effects) + '\\n'));
  `);
  try {
    const result = spawnSync(process.execPath, [
      '--import', preloadPath, fileURLToPath(new URL('./resolve-threads.mjs', import.meta.url)),
      '--repo', 'owner/repo', '--pr', '123', '--target-dir', root,
    ], {
      encoding: 'utf8', timeout: 5000,
      env: { DECISION_ROUTING_MODE: 'shadow', TARGET_REPO: 'owner/repo', GITHUB_TOKEN: 'offline-token' },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ROUTING_ACTIVATION_DENIED/);
    assert.match(result.stdout, /\{"reads":1,"spawns":0,"mutations":0\}/);

    const resultPath = join(root, 'ocr-result.json');
    writeFileSync(resultPath, JSON.stringify({
      schema_version: '1.0', mode: 'review', status: 'success', coverage: 1, findings: [], message: '',
    }));
    let checkWrites = 0;
    const check = await updateCheckRun({
      env: {
        // Model the workflow's job.status mapping after the non-continue-on-error CLI step.
        CONCLUSION: result.status === 0 ? 'success' : 'failure',
        DECISION_ROUTING_MODE: 'shadow', TARGET_REPO: 'owner/repo', PR_NUMBER: '123',
        CHECK_RUN_ID: '456', GITHUB_TOKEN: 'offline-token', RESULT_PATH: resultPath,
        DETAILS_URL: 'https://github.com/owner/central/actions/runs/789',
      },
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://api.github.com/repos/owner/repo/check-runs/456');
        assert.equal(options.method, 'PATCH');
        assert.equal(JSON.parse(options.body).conclusion, 'failure');
        checkWrites++;
        return { ok: true };
      },
    });
    assert.equal(check.conclusion, 'failure');
    assert.equal(checkWrites, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('shadow GraphQL mutation failure produces a failing Check conclusion offline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ocr-thread-mutation-check-'));
  writeFileSync(join(root, 'changed.js'), 'const fixed = true;\n');
  let hostCalls = 0;
  let mutationCalls = 0;
  let checkWrites = 0;
  try {
    const exitCode = await run({
      args: ['--repo', 'owner/repo', '--pr', '123', '--target-dir', root],
      token: 'offline-token',
      env: { DECISION_ROUTING_MODE: 'shadow', TARGET_REPO: 'owner/repo' },
      fetchOpenThreads: async () => [{ id: 'thread-1', path: 'changed.js', line: 1, comments: [] }],
      threadHost: async () => {
        hostCalls++;
        return { status: 'success', decision: 'resolve', reason: 'fixed' };
      },
      authorizeBeforeMutation: async () => true,
      graphql: async () => {
        mutationCalls++;
        return { errors: [{ message: 'private GraphQL response' }] };
      },
    });

    assert.equal(exitCode, 1);
    assert.equal(hostCalls, 1);
    assert.equal(mutationCalls, 1);

    const resultPath = join(root, 'ocr-result.json');
    writeFileSync(resultPath, JSON.stringify({
      schema_version: '1.0', mode: 'review', status: 'success', coverage: 1, findings: [], message: '',
    }));
    const check = await updateCheckRun({
      env: {
        CONCLUSION: exitCode === 0 ? 'success' : 'failure',
        DECISION_ROUTING_MODE: 'shadow', TARGET_REPO: 'owner/repo', PR_NUMBER: '123',
        CHECK_RUN_ID: '456', GITHUB_TOKEN: 'offline-token', RESULT_PATH: resultPath,
        DETAILS_URL: 'https://github.com/owner/central/actions/runs/789',
      },
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://api.github.com/repos/owner/repo/check-runs/456');
        assert.equal(options.method, 'PATCH');
        assert.equal(JSON.parse(options.body).conclusion, 'failure');
        checkWrites++;
        return { ok: true };
      },
    });

    assert.equal(check.conclusion, 'failure');
    assert.equal(checkWrites, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('production CLI rejects HTTP 500 with success-shaped GraphQL JSON before Host or mutation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ocr-thread-http-500-cli-'));
  const preloadPath = join(root, 'offline-http.mjs');
  writeFileSync(preloadPath, `
    import https from 'node:https';
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { EventEmitter } from 'node:events';
    const effects = { fetches: 0, mutations: 0, spawns: 0 };
    childProcess.spawn = () => { effects.spawns++; throw new Error('unexpected Host spawn'); };
    syncBuiltinESMExports();
    https.request = (_options, respond) => {
      const request = new EventEmitter();
      let body = '';
      request.write = chunk => { body += chunk; };
      request.end = () => {
        const query = JSON.parse(body).query;
        if (query.trimStart().startsWith('mutation')) effects.mutations++;
        else effects.fetches++;
        const response = new EventEmitter();
        response.statusCode = 500;
        respond(response);
        response.emit('data', JSON.stringify({
          data: { repository: { pullRequest: { reviewThreads: {
            nodes: [], pageInfo: { hasNextPage: false, endCursor: null }
          } } } },
          extensions: { sentinel: 'private-response-sentinel' }
        }));
        response.emit('end');
      };
      request.destroy = error => request.emit('error', error);
      return request;
    };
    process.on('exit', () => process.stdout.write(JSON.stringify(effects) + '\\n'));
  `);
  try {
    const result = spawnSync(process.execPath, [
      '--import', preloadPath,
      fileURLToPath(new URL('./resolve-threads.mjs', import.meta.url)),
      '--repo', 'owner/repo', '--pr', '123', '--target-dir', root,
    ], {
      encoding: 'utf8', timeout: 5000,
      env: { DECISION_ROUTING_MODE: 'shadow', TARGET_REPO: 'owner/repo', GITHUB_TOKEN: 'offline-token' },
    });

    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /THREAD_FETCH_FAILED/);
    assert.doesNotMatch(result.stderr, /private-response-sentinel/);
    assert.match(result.stdout, /\{"fetches":1,"mutations":0,"spawns":0\}/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
