import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('extracts the actual OpenCodeReview CLI version from its version output', async () => {
  const { parseOpenCodeReviewVersion } = await import('./compare-opencodereview-version.mjs');
  assert.equal(typeof parseOpenCodeReviewVersion, 'function');
  assert.equal(parseOpenCodeReviewVersion('open-code-review v1.13.6 (commit abc1234)'), '1.13.6');
});

test('compares actual OpenCodeReview CLI version with the pinned package version', async () => {
  const { compareOpenCodeReviewVersion } = await import('./compare-opencodereview-version.mjs');
  assert.equal(typeof compareOpenCodeReviewVersion, 'function');
  assert.deepEqual(compareOpenCodeReviewVersion({ expectedVersion: '1.13.6', versionOutput: 'open-code-review 1.13.6 linux/amd64' }), {
    expected_version: '1.13.6',
    actual_version: '1.13.6',
    matches: true,
  });
  assert.deepEqual(compareOpenCodeReviewVersion({ expectedVersion: '1.13.6', versionOutput: 'open-code-review 1.13.5 linux/amd64' }), {
    expected_version: '1.13.6',
    actual_version: '1.13.5',
    matches: false,
  });
});

test('version check disables CLI self-updates and persists comparison values for later steps', async () => {
  const { main } = await import('./compare-opencodereview-version.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'ocr-version-check-'));
  const githubEnv = join(directory, 'github-env');
  writeFileSync(githubEnv, '');

  try {
    const comparison = main({
      env: {
        OPENCODEREVIEW_EXPECTED_VERSION: '1.13.6',
        GITHUB_ENV: githubEnv,
      },
      runCommand: (command, args, options) => {
        assert.equal(command, 'ocr');
        assert.deepEqual(args, ['version']);
        assert.equal(options.env.OCR_NO_UPDATE, '1');
        return 'open-code-review v1.13.6 (commit abc1234)';
      },
    });

    assert.equal(comparison.matches, true);
    assert.equal(readFileSync(githubEnv, 'utf8'), [
      'OCR_NO_UPDATE=1',
      'OPENCODEREVIEW_VERSION_EXPECTED=1.13.6',
      'OPENCODEREVIEW_VERSION_ACTUAL=1.13.6',
      'OPENCODEREVIEW_VERSION_MATCH=true',
      '',
    ].join('\n'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('version check fails closed when the installed CLI differs from the pin', async () => {
  const { main } = await import('./compare-opencodereview-version.mjs');
  assert.throws(() => main({
    env: { OPENCODEREVIEW_EXPECTED_VERSION: '1.13.6' },
    runCommand: () => 'open-code-review v1.13.5 (commit abc1234)',
  }), { message: 'OPENCODEREVIEW_VERSION_MISMATCH' });
});
