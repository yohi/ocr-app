import assert from 'node:assert/strict';
import test from 'node:test';

import { filterDuplicateReviewComments } from './deduplicate-review-comments.mjs';
import { fetchUniqueReviewComments } from './deduplicate-review-comments.mjs';

test('filters paraphrased OCR findings already posted at the same changed location', () => {
  const existingComments = [{
    body: "The target 'cpu-power-agent-hint' is invoked in 'setup-system', but neither Makefile nor any included makefile defines it. Running make setup will fail with no rule to make target.",
    line: 76,
    path: 'Makefile',
    user: { login: 'opencodereview-app[bot]' },
  }];
  const comments = [
    {
      body: 'Target `cpu-power-agent-hint` is invoked during `setup-system`, but it is not defined in Makefile or any included .mk files. Running make setup fails because there is no rule for the target.',
      line: 76,
      path: 'Makefile',
    },
    {
      body: 'The shell command on this line masks failures from the preceding system-setup target.',
      line: 76,
      path: 'Makefile',
    },
  ];

  const result = filterDuplicateReviewComments({
    botLogin: 'opencodereview-app',
    comments,
    existingComments,
  });

  assert.deepEqual(result.comments, [comments[1]]);
  assert.equal(result.duplicateCount, 1);
});

test('does not suppress a similar comment from a different review bot', () => {
  const comments = [{
    body: 'The link target `_docs/bios-power-and-fan-settings.ja.md` does not exist in the pull request.',
    line: 40,
    path: 'README.md',
  }];

  const result = filterDuplicateReviewComments({
    botLogin: 'opencodereview-app',
    comments,
    existingComments: [{
      body: 'The link target `_docs/bios-power-and-fan-settings.ja.md` does not exist in the pull request.',
      line: 40,
      path: 'README.md',
      user: { login: 'coderabbitai[bot]' },
    }],
  });

  assert.deepEqual(result.comments, comments);
  assert.equal(result.duplicateCount, 0);
});

test('recognizes paraphrased local-link findings by their shared path and location', () => {
  const result = filterDuplicateReviewComments({
    botLogin: 'opencodereview-app',
    comments: [{
      body: 'The documentation link `_docs/bios-power-and-fan-settings.ja.md` points to a file that does not exist in the repository or this pull request.',
      line: 40,
      path: 'README.md',
    }],
    existingComments: [{
      body: 'The link references `_docs/bios-power-and-fan-settings.ja.md`, but this file does not exist in the repository or in this pull request, resulting in a broken link.',
      line: 40,
      path: 'README.md',
      user: { login: 'opencodereview-app[bot]' },
    }],
  });

  assert.deepEqual(result.comments, []);
  assert.equal(result.duplicateCount, 1);
});

test('does not deduplicate comments from an outdated diff using original_line', () => {
  const comments = [{
    body: 'The cpu-power-agent-hint target is missing from setup-system.',
    line: 76,
    path: 'Makefile',
  }];

  const result = filterDuplicateReviewComments({
    botLogin: 'opencodereview-app',
    comments,
    existingComments: [{
      body: 'The cpu-power-agent-hint target is missing from setup-system.',
      line: null,
      original_line: 76,
      path: 'Makefile',
      user: { login: 'opencodereview-app[bot]' },
    }],
  });

  assert.deepEqual(result.comments, comments);
  assert.equal(result.duplicateCount, 0);
});

test('does not deduplicate comments with conflicting boolean assertions', () => {
  const comments = [{
    body: 'The cpu-power-agent-hint must return true when setup-system completes.',
    line: 76,
    path: 'Makefile',
  }];

  const result = filterDuplicateReviewComments({
    botLogin: 'opencodereview-app',
    comments,
    existingComments: [{
      body: 'The cpu-power-agent-hint must return false when setup-system completes.',
      line: 76,
      path: 'Makefile',
      user: { login: 'opencodereview-app[bot]' },
    }],
  });

  assert.deepEqual(result.comments, comments);
  assert.equal(result.duplicateCount, 0);
});

test('does not deduplicate against comments in resolved or outdated review threads', async () => {
  const comments = [{
    body: 'The link target `_docs/bios-power-and-fan-settings.ja.md` does not exist in this change.',
    line: 40,
    path: 'README.md',
  }];
  const calls = [];
  const githubApi = async (method, path, body) => {
    calls.push({ method, path, body });
    return {
      status: 200,
      data: {
        data: {
          node: {
            reviewThreads: {
              nodes: [
                {
                  isResolved: true,
                  comments: { nodes: [{
                    author: { login: 'opencodereview-app[bot]' },
                    body: 'The link target `_docs/bios-power-and-fan-settings.ja.md` is missing.',
                    line: 40,
                    outdated: false,
                    path: 'README.md',
                  }] },
                },
                {
                  isResolved: false,
                  comments: { nodes: [{
                    author: { login: 'opencodereview-app[bot]' },
                    body: 'The link target `_docs/bios-power-and-fan-settings.ja.md` is missing.',
                    line: 40,
                    outdated: true,
                    path: 'README.md',
                  }] },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    };
  };

  const result = await fetchUniqueReviewComments({
    botLogin: 'opencodereview-app',
    comments,
    githubApi,
    prNumber: 12,
    pullRequestNodeId: 'PR_node_id',
  });

  assert.deepEqual(result.comments, comments);
  assert.equal(result.duplicateCount, 0);
  assert.equal(calls[0].path, '/graphql');
  assert.match(calls[0].body.query, /isResolved/);
  assert.match(calls[0].body.query, /outdated/);
});

test('deduplicates against a bot comment in an unresolved current diff thread', async () => {
  const comment = {
    body: 'The link target `_docs/bios-power-and-fan-settings.ja.md` does not exist in this change.',
    line: 40,
    path: 'README.md',
  };
  const githubApi = async () => ({
    status: 200,
    data: {
      data: {
        node: {
          reviewThreads: {
            nodes: [{
              isResolved: false,
              comments: {
                nodes: [{
                  author: { login: 'opencodereview-app[bot]' },
                  ...comment,
                  outdated: false,
                }],
              },
            }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    },
  });

  const result = await fetchUniqueReviewComments({
    botLogin: 'opencodereview-app',
    comments: [comment],
    githubApi,
    prNumber: 12,
    pullRequestNodeId: 'PR_node_id',
  });

  assert.deepEqual(result.comments, []);
  assert.equal(result.duplicateCount, 1);
});
