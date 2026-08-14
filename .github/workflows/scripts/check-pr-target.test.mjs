import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRepository, isInternalPullRequest } from './check-pr-target.mjs';

test('parses owner/repository values without accepting malformed targets', () => {
  assert.deepEqual(parseRepository('acme/project'), { owner: 'acme', repo: 'project' });
  assert.throws(() => parseRepository('project'), /owner\/repo/);
  assert.throws(() => parseRepository('acme/project/extra'), /owner\/repo/);
});

test('marks same-repository pull requests internal and forks external', () => {
  assert.equal(isInternalPullRequest({ baseRepo: 'acme/project', headRepo: 'acme/project' }), true);
  assert.equal(isInternalPullRequest({ baseRepo: 'acme/project', headRepo: 'contributor/project' }), false);
  assert.equal(isInternalPullRequest({ baseRepo: 'acme/project', headRepo: '' }), false);
});
