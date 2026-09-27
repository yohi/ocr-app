const MINIMUM_BODY_SIMILARITY = 0.25;

function normalizeLogin(login) {
  return typeof login === 'string'
    ? login.replace(/\[bot\]$/i, '').toLowerCase()
    : '';
}

function getLocation(comment) {
  return comment.line ?? null;
}

function getBodyTokens(body) {
  const normalizedBody = typeof body === 'string'
    ? body
      .replace(/^```[^\n]*\n?/, '')
      .replace(/\n```(?:\n|$)/, '')
      .replace(/\n---\n\*Posted by OpenCodeReview\*\s*$/, '')
      .normalize('NFKC')
      .toLowerCase()
    : '';

  return new Set(normalizedBody.match(/[\p{L}\p{N}_][\p{L}\p{N}./_-]*/gu) ?? []);
}

function getBooleanAssertions(body) {
  const normalizedBody = typeof body === 'string' ? body.toLowerCase() : '';
  return new Set([...normalizedBody.matchAll(/\b(?:return|returns|returned|be|is|are|should|must)\s+(true|false)\b/g)]
    .map(([, assertion]) => assertion));
}

function hasConflictingAssertions(left, right) {
  const leftAssertions = getBooleanAssertions(left.body);
  const rightAssertions = getBooleanAssertions(right.body);
  return leftAssertions.has('true') && rightAssertions.has('false') ||
    leftAssertions.has('false') && rightAssertions.has('true');
}

function areSameFinding(left, right) {
  if (left.path !== right.path || getLocation(left) !== getLocation(right)) return false;
  if (hasConflictingAssertions(left, right)) return false;

  const leftTokens = getBodyTokens(left.body);
  const rightTokens = getBodyTokens(right.body);
  const sharedTokens = [...leftTokens].filter(token => rightTokens.has(token));
  const sharedAnchors = sharedTokens.filter(token => /[-_/.]/.test(token) && token.length >= 7);

  if (sharedAnchors.length === 0) return false;

  const unionSize = new Set([...leftTokens, ...rightTokens]).size;
  return unionSize > 0 && sharedTokens.length / unionSize >= MINIMUM_BODY_SIMILARITY;
}

export function filterDuplicateReviewComments({ botLogin, comments, existingComments }) {
  const normalizedBotLogin = normalizeLogin(botLogin);
  const priorComments = existingComments.filter(comment =>
    normalizeLogin(comment.user?.login) === normalizedBotLogin &&
    Number.isSafeInteger(comment.line) && comment.line > 0,
  );
  const uniqueComments = [];
  let duplicateCount = 0;

  for (const comment of comments) {
    const duplicate = priorComments.some(existing => areSameFinding(comment, existing)) ||
      uniqueComments.some(existing => areSameFinding(comment, existing));
    if (duplicate) {
      duplicateCount++;
      continue;
    }
    uniqueComments.push(comment);
  }

  return { comments: uniqueComments, duplicateCount };
}

export async function fetchUniqueReviewComments({ botLogin, comments, githubApi, prNumber, pullRequestNodeId }) {
  const existingComments = [];
  for (let cursor = null; ; ) {
    const response = await githubApi('POST', '/graphql', {
      query: `query($pullRequestId: ID!, $cursor: String) {
        node(id: $pullRequestId) {
          ... on PullRequest {
            reviewThreads(first: 100, after: $cursor) {
              nodes {
                isResolved
                comments(first: 100) {
                  nodes { author { login } body line outdated path }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }`,
      variables: { cursor, pullRequestId: pullRequestNodeId },
    });
    const threadConnection = response.data?.data?.node?.reviewThreads;
    if (response.status !== 200 || response.data?.errors || !threadConnection) {
      throw new Error(`Failed to fetch existing review threads for pull request ${prNumber}`);
    }
    for (const thread of threadConnection.nodes) {
      if (thread.isResolved !== false) continue;
      for (const comment of thread.comments.nodes) {
        if (comment.outdated !== false || !Number.isSafeInteger(comment.line) || comment.line <= 0) continue;
        existingComments.push({
          ...comment,
          user: comment.author,
        });
      }
    }
    if (!threadConnection.pageInfo.hasNextPage) break;
    cursor = threadConnection.pageInfo.endCursor;
  }

  return filterDuplicateReviewComments({ botLogin, comments, existingComments });
}
