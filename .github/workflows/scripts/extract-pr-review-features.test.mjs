import assert from 'node:assert/strict';
import test from 'node:test';
import { extractPRFeatures, parseNulGitChangeRecords } from './extract-pr-review-features.mjs';

const nul = (...parts) => Buffer.from(`${parts.join('\0')}\0`);

test('parses paths containing spaces, tabs, and newlines using NUL framing', () => {
  const records = parseNulGitChangeRecords({
    nameStatus: nul('M', 'src/a b\tc\nd.js'),
    numstat: nul('2\t1\tsrc/a b\tc\nd.js'),
    rawMode: Buffer.alloc(0),
  });
  assert.equal(records[0].path, 'src/a b\tc\nd.js');
  assert.deepEqual([records[0].additions, records[0].deletions], [2, 1]);
});

test('counts rename, deletion, copy, binary, symlink, submodule, and mode-only records', () => {
  const records = parseNulGitChangeRecords({
    nameStatus: nul('R100', 'old name.js', 'new name.js', 'D', 'gone.js', 'C075', 'source.js', 'copy.js', 'M', 'image.bin', 'M', 'link', 'M', 'module', 'M', 'exec.sh'),
    numstat: nul('4\t2\t\0old name.js', 'new name.js', '0\t3\tgone.js', '1\t0\tsource.js', '-\t-\timage.bin', '0\t0\tlink', '0\t0\tmodule', '0\t0\texec.sh'),
    rawMode: Buffer.from(`:100644 100755 ${'a'.repeat(40)} ${'b'.repeat(40)} M\0exec.sh\0:100644 120000 ${'a'.repeat(40)} ${'b'.repeat(40)} M\0link\0:100644 160000 ${'a'.repeat(40)} ${'b'.repeat(40)} M\0module\0`),
  });
  assert.equal(records.length, 7);
  assert.deepEqual([records[0].oldPath, records[0].path, records[0].status], ['old name.js', 'new name.js', 'renamed']);
  assert.equal(records[2].status, 'copied');
  assert.deepEqual([records[3].additions, records[3].deletions, records[3].binary], [null, null, true]);
  assert.equal(records[4].mode, '120000');
  assert.equal(records[5].mode, '160000');
  assert.equal(records[6].mode, '100755');
});

test('unknown and malformed Git records are rejected', () => {
  assert.throws(() => parseNulGitChangeRecords({ nameStatus: nul('X', 'x'), numstat: Buffer.alloc(0), rawMode: Buffer.alloc(0) }));
  assert.throws(() => parseNulGitChangeRecords({ nameStatus: Buffer.from('M\0unterminated'), numstat: Buffer.alloc(0), rawMode: Buffer.alloc(0) }));
});

test('extracts complete features from validated Git metadata even when no paths are reviewable', async () => {
  const calls = [];
  const outputs = [Buffer.from(`${'b'.repeat(40)}\n`), Buffer.from(`${'a'.repeat(40)}\n`), nul('M', 'src/main.js'), nul('3\t1\tsrc/main.js'), Buffer.from(`:100644 100644 ${'a'.repeat(40)} ${'b'.repeat(40)} M\0src/main.js\0`)];
  const features = await extractPRFeatures({
    cwd: '/target-repo', baseRef: 'main', headSha: 'b'.repeat(40), preview: { reviewable_files: [] },
    runGit: async (command, args, options) => { calls.push({ command, args, options }); return outputs.shift(); },
  });
  assert.equal(features.schema_version, '3');
  assert.equal(features.all_changed_file_count, 1);
  assert.equal(features.reviewable_file_count, 0);
  assert.equal(features.review_scope_gap, true);
  assert.equal(features.risk_floor, 'deep');
  assert.deepEqual(features.ocr_reviewable_paths, []);
  assert.ok(calls.every(call => call.command === 'git' && call.options.cwd === '/target-repo'));
  assert.ok(calls.some(call => call.args.includes('--no-ext-diff') && call.args.includes('--no-textconv')));
});

test('invalid refs, missing merge-base, and output overflow fail closed', async (t) => {
  const valid = { cwd: '.', baseRef: 'main', headSha: 'b'.repeat(40), preview: { reviewable_files: [{ path: 'src/a.js' }] }, runGit: async () => Buffer.from(`${'a'.repeat(40)}\n`) };
  await t.test('rejects malformed SHA and base ref', async () => {
    await assert.rejects(extractPRFeatures({ ...valid, headSha: 'not-a-sha' }));
    await assert.rejects(extractPRFeatures({ ...valid, baseRef: '../main' }));
  });
  await t.test('missing merge-base yields incomplete deep-risk features', async () => {
    let call = 0;
    const features = await extractPRFeatures({ ...valid, runGit: async () => { call++; if (call === 1) return Buffer.from(`${'a'.repeat(40)}\n`); if (call === 2) return Buffer.alloc(0); return Buffer.alloc(0); } });
    assert.equal(features.features_incomplete, true);
    assert.equal(features.classification_status, 'incomplete');
    assert.equal(features.risk_floor, 'deep');
  });
  await t.test('caps output size and fails closed', async () => {
    const features = await extractPRFeatures({ ...valid, maxOutputBytes: 8, runGit: async () => Buffer.alloc(64, 65) });
    assert.equal(features.features_incomplete, true);
    assert.equal(features.risk_floor, 'deep');
  });
});
