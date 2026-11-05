import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION = /(?:^|[\s(])v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?=$|[\s)])/;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function parseOpenCodeReviewVersion(output) {
  if (typeof output !== 'string') throw new Error('OPENCODEREVIEW_VERSION_UNAVAILABLE');
  const match = output.match(VERSION);
  if (!match) throw new Error('OPENCODEREVIEW_VERSION_UNAVAILABLE');
  return match[1];
}

export function compareOpenCodeReviewVersion({ expectedVersion, versionOutput }) {
  if (typeof expectedVersion !== 'string' || !EXACT_VERSION.test(expectedVersion)) {
    throw new Error('OPENCODEREVIEW_EXPECTED_VERSION_INVALID');
  }
  const actualVersion = parseOpenCodeReviewVersion(versionOutput);
  return Object.freeze({
    expected_version: expectedVersion,
    actual_version: actualVersion,
    matches: actualVersion === expectedVersion,
  });
}

export function main({ env = process.env, runCommand = execFileSync } = {}) {
  const versionOutput = runCommand('ocr', ['version'], {
    encoding: 'utf8',
    env: { ...env, OCR_NO_UPDATE: '1' },
  });
  const comparison = compareOpenCodeReviewVersion({
    expectedVersion: env.OPENCODEREVIEW_EXPECTED_VERSION,
    versionOutput,
  });
  console.log(`OPENCODEREVIEW_VERSION ${JSON.stringify(comparison)}`);
  if (typeof env.GITHUB_ENV === 'string' && env.GITHUB_ENV.length > 0) {
    appendFileSync(env.GITHUB_ENV, [
      'OCR_NO_UPDATE=1',
      `OPENCODEREVIEW_VERSION_EXPECTED=${comparison.expected_version}`,
      `OPENCODEREVIEW_VERSION_ACTUAL=${comparison.actual_version}`,
      `OPENCODEREVIEW_VERSION_MATCH=${comparison.matches}`,
      '',
    ].join('\n'));
  }
  if (!comparison.matches) throw new Error('OPENCODEREVIEW_VERSION_MISMATCH');
  return comparison;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error?.message ?? 'OPENCODEREVIEW_VERSION_CHECK_FAILED');
    process.exitCode = 1;
  }
}
