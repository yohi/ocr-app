import assert from 'node:assert/strict';
import test from 'node:test';

import { getExecutablePaths } from './check-opencodereview-contract.mjs';

test('resolves git and OpenCodeReview without searching PATH', () => {
  assert.deepEqual(getExecutablePaths({ HOME: '/home/runner' }), {
    git: '/usr/bin/git',
    ocr: '/home/runner/.local/bin/ocr',
  });
});
