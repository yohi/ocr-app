const MINIMUM_BODY_SIMILARITY = 0.25;

function normalizeLogin(login) {
  return typeof login === 'string'
    ? login.replace(/\[bot\]$/i, '').toLowerCase()
    : '';
}

function getLocation(comment) {
  return comment.line ?? comment.original_line ?? null;
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

function areSameFinding(left, right) {
  if (left.path !== right.path || getLocation(left) !== getLocation(right)) return false;

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
    normalizeLogin(comment.user?.login) === normalizedBotLogin,
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

export async function fetchUniqueReviewComments({ botLogin, comments, githubApi, prNumber }) {
  const existingComments = [];
  for (let page = 1; ; page++) {
    const response = await githubApi('GET', `/pulls/${prNumber}/comments?per_page=100&page=${page}`);
    if (response.status !== 200 || !Array.isArray(response.data)) {
      throw new Error(`Failed to fetch existing review comments (page ${page})`);
    }
    existingComments.push(...response.data);
    if (response.data.length < 100) break;
  }

  return filterDuplicateReviewComments({ botLogin, comments, existingComments });
}
