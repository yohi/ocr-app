import assert from 'node:assert/strict';
import test from 'node:test';
import { extractPRFeatures, parseNulGitChangeRecords } from './extract-pr-review-features.mjs';

const nul = (...parts) => Buffer.from(`${parts.join('\0')}\0`);

test('parses paths containing spaces, tabs, and newlines using NUL framing', () => {
  const records = parseNulGitChangeRecords({
    nameStatus: nul('M', 'src/a b\tc\nd.js'),
    numstat: nul('2\t1\tsrc/a b\tc\nd.js'),
    rawMode: Buffer.from(`:100644 100644 ${'a'.repeat(40)} ${'b'.repeat(40)} M\0src/a b\tc\nd.js\0`),
  });
  assert.equal(records[0].path, 'src/a b\tc\nd.js');
  assert.deepEqual([records[0].additions, records[0].deletions], [2, 1]);
});

test('counts rename, deletion, copy, binary, symlink, submodule, and mode-only records', () => {
  const records = parseNulGitChangeRecords({
    nameStatus: nul('R100', 'old name.js', 'new name.js', 'D', 'gone.js', 'C075', 'source.js', 'copy.js', 'M', 'image.bin', 'M', 'link', 'M', 'module', 'M', 'exec.sh'),
    numstat: nul('4\t2\t\0old name.js', 'new name.js', '0\t3\tgone.js', '1\t0\t\0source.js', 'copy.js', '-\t-\timage.bin', '0\t0\tlink', '0\t0\tmodule', '0\t0\texec.sh'),
    rawMode: Buffer.from([
      `:100644 100644 ${'a'.repeat(40)} ${'b'.repeat(40)} R100\0old name.js\0new name.js\0`,
      `:100644 100644 ${'a'.repeat(40)} ${'b'.repeat(40)} D\0gone.js\0`,
      `:100644 100644 ${'a'.repeat(40)} ${'b'.repeat(40)} C075\0source.js\0copy.js\0`,
      `:100644 100644 ${'a'.repeat(40)} ${'b'.repeat(40)} M\0image.bin\0`,
      `:100644 120000 ${'a'.repeat(40)} ${'b'.repeat(40)} M\0link\0`,
      `:100644 160000 ${'a'.repeat(40)} ${'b'.repeat(40)} M\0module\0`,
      `:100644 100755 ${'a'.repeat(40)} ${'b'.repeat(40)} M\0exec.sh\0`,
    ].join('')),
  });
  assert.equal(records.length, 7);
  assert.deepEqual([records[0].oldPath, records[0].path, records[0].status], ['old name.js', 'new name.js', 'renamed']);
  assert.equal(records[2].status, 'copied');
  assert.deepEqual([records[2].additions, records[2].deletions], [1, 0]);
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
  assert.equal(features.classification_status, 'unclassified_other');
  assert.equal(features.risk_floor, 'deep');
  assert.equal(Object.hasOwn(features, 'concerns'), false);
  assert.deepEqual(calls.slice(2).map(call => call.args), [
    ['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', 'origin/main...bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
    ['diff', '--no-ext-diff', '--no-textconv', '--numstat', '-z', 'origin/main...bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
    ['diff', '--no-ext-diff', '--no-textconv', '--raw', '--no-abbrev', '-z', 'origin/main...bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
  ]);
});

test('keeps Task 3 classification fail-closed and derives families and areas from both paths', async () => {
  const head = 'b'.repeat(40);
  const base = 'a'.repeat(40);
  const files = [
    ['M', '.github/workflows/build.yml'], ['M', 'AGENTS.md'], ['M', 'src/util.ts'],
    ['R100', 'auth/credential.py', 'docs/renamed.md'], ['C100', 'migrations/schema.sql', 'copy.tf'],
  ];
  const nameStatus = Buffer.from(`${files.flatMap(([status, ...paths]) => [status, ...paths]).join('\0')}\0`);
  const stats = [
    '1\t0\t.github/workflows/build.yml', '1\t0\tAGENTS.md', '1\t0\tsrc/util.ts',
    '1\t0\t\0auth/credential.py\0docs/renamed.md', '1\t0\t\0migrations/schema.sql\0copy.tf',
  ];
  const raw = [
    [base, head, 'M', '.github/workflows/build.yml'], [base, head, 'M', 'AGENTS.md'],
    [base, head, 'M', 'src/util.ts'], [base, head, 'R100', 'auth/credential.py', 'docs/renamed.md'],
    [base, head, 'C100', 'migrations/schema.sql', 'copy.tf'],
  ].map(([oldSha, newSha, status, ...paths]) => `:100644 100644 ${oldSha} ${newSha} ${status}\0${paths.join('\0')}\0`).join('');
  const outputs = [Buffer.from(`${head}\n`), Buffer.from(`${base}\n`), nameStatus, Buffer.from(`${stats.join('\0')}\0`), Buffer.from(raw)];
  const features = await extractPRFeatures({ cwd: '.', baseRef: 'main', headSha: head, preview: { reviewable_files: files.map(([, ...paths]) => ({ path: paths.at(-1) })) }, runGit: async () => outputs.shift() });
  assert.equal(features.risk_floor, 'deep');
  assert.equal(features.classification_status, 'unclassified_other');
  assert.ok(['markdown', 'typescript', 'python', 'sql', 'terraform', 'yaml'].every(item => features.language_families.includes(item)));
  assert.ok(['docs', 'ci', 'auth', 'migration'].every(item => features.change_areas.includes(item)));
  assert.equal(features.security_signal, 'metadata_positive');
  assert.equal(features.migration_signal, 'metadata_positive');
  assert.equal(features.review_scope_gap, true);
  assert.equal(features.features_incomplete, false);
});

test('missing raw mode or numstat is incomplete and remains deep risk', async () => {
  const head = 'b'.repeat(40);
  const base = 'a'.repeat(40);
  const runWith = (rawMode, numstat = nul('1\t0\tx.bin')) => {
    const outputs = [Buffer.from(`${head}\n`), Buffer.from(`${base}\n`), nul('M', 'x.bin'), numstat, rawMode];
    return extractPRFeatures({ cwd: '.', baseRef: 'main', headSha: head, preview: { reviewable_files: [] }, runGit: async () => outputs.shift() });
  };
  const absentRaw = await runWith(Buffer.alloc(0));
  assert.equal(absentRaw.features_incomplete, true);
  assert.equal(absentRaw.classification_status, 'incomplete');
  assert.equal(absentRaw.risk_floor, 'deep');
  const missingStat = await runWith(Buffer.from(`:100644 100644 ${base} ${head} R100\0old\0new\0`), Buffer.alloc(0));
  assert.equal(missingStat.features_incomplete, true);
  assert.equal(missingStat.risk_floor, 'deep');
  const modeOnly = await runWith(Buffer.from(`:100644 100755 ${base} ${head} M\0x.bin\0`), Buffer.alloc(0));
  assert.equal(modeOnly.features_incomplete, false);
  assert.equal(modeOnly.all_changed_files[0].status, 'mode_changed');
  assert.equal(modeOnly.additions, null);
  assert.equal(modeOnly.deletions, null);
  assert.equal(modeOnly.risk_floor, 'deep');
});

test('binary, symlink, submodule, executable, rename, and copy changes never resolve to fast', async () => {
  const head = 'b'.repeat(40);
  const base = 'a'.repeat(40);
  const variants = [
    { ns: nul('M', 'binary.bin'), nsstat: nul('-\t-\tbinary.bin'), oldMode: '100644', mode: '100644' },
    { ns: nul('M', 'link'), nsstat: nul('0\t0\tlink'), oldMode: '100644', mode: '120000' },
    { ns: nul('M', 'module'), nsstat: nul('0\t0\tmodule'), oldMode: '100644', mode: '160000' },
    { ns: nul('M', 'script.sh'), nsstat: nul('0\t0\tscript.sh'), oldMode: '100644', mode: '100755' },
    { ns: nul('R100', 'old.js', 'new.js'), nsstat: nul('1\t0\t\0old.js', 'new.js'), oldMode: '100644', mode: '100644', rawStatus: 'R100' },
    { ns: nul('C100', 'old.js', 'copy.js'), nsstat: nul('1\t0\t\0old.js', 'copy.js'), oldMode: '100644', mode: '100644', rawStatus: 'C100' },
  ];
  for (const variant of variants) {
    const rawPath = variant.rawStatus ? `old.js\0${variant.rawStatus === 'R100' ? 'new.js' : 'copy.js'}` : variant.ns.toString().split('\0')[1];
    const raw = Buffer.from(`:${variant.oldMode} ${variant.mode} ${base} ${head} ${variant.rawStatus ?? 'M'}\0${rawPath}\0`);
    const outputs = [Buffer.from(`${head}\n`), Buffer.from(`${base}\n`), variant.ns, variant.nsstat, raw];
    const result = await extractPRFeatures({ cwd: '.', baseRef: 'main', headSha: head, preview: { reviewable_files: [] }, runGit: async () => outputs.shift() });
    assert.notEqual(result.risk_floor, 'fast');
    assert.ok(result.risk_floor === 'deep' || result.features_incomplete);
  }
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
