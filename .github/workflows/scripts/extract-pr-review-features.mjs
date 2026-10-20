import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(nodeExecFile);
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_RECORDS = 100_000;
const MAX_PATH_BYTES = 16 * 1024;
const VALID_MODES = new Set(['100644', '100755', '120000', '160000', '000000']);

async function defaultRunGit(command, args, { cwd }) {
  const { stdout } = await execFile(command, args, { cwd, encoding: 'buffer', maxBuffer: MAX_OUTPUT_BYTES });
  if (!Buffer.isBuffer(stdout)) throw new Error('Git output was not a Buffer');
  return stdout;
}

function fields(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error('Git output must be a Buffer');
  if (buffer.length > MAX_OUTPUT_BYTES) throw new Error('Git output exceeds byte limit');
  if (buffer.length === 0) return [];
  if (buffer[buffer.length - 1] !== 0) throw new Error('Git output is not NUL terminated');
  const result = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index++) {
    if (buffer[index] !== 0) continue;
    const value = buffer.subarray(start, index);
    if (value.length > MAX_PATH_BYTES) throw new Error('Git field exceeds byte limit');
    result.push(value.toString('utf8'));
    if (result.length > MAX_RECORDS * 3) throw new Error('Git record count exceeds limit');
    start = index + 1;
  }
  return result;
}

function parseNameStatus(buffer) {
  const values = fields(buffer);
  const records = [];
  for (let index = 0; index < values.length;) {
    const statusToken = values[index++];
    if (statusToken === undefined) throw new Error('Missing Git status');
    const match = /^(A|M|D|T|R\d{1,3}|C\d{1,3})$/.exec(statusToken);
    if (!match) throw new Error(`Unknown Git status: ${statusToken}`);
    const code = match[1];
    if (code === undefined) throw new Error('Malformed Git status');
    const status = code[0];
    if (status === 'R' || status === 'C') {
      const oldPath = values[index++];
      const path = values[index++];
      if (oldPath === undefined || path === undefined) throw new Error('Malformed rename/copy record');
      records.push({ oldPath, path, status: status === 'R' ? 'renamed' : 'copied' });
    } else {
      const path = values[index++];
      if (path === undefined) throw new Error('Missing Git path');
      records.push({ path, status: status === 'A' ? 'added' : status === 'D' ? 'deleted' : status === 'T' ? 'type_changed' : 'modified' });
    }
    if (records.length > MAX_RECORDS) throw new Error('Git record count exceeds limit');
  }
  return records;
}

function parseNumstat(buffer) {
  const values = fields(buffer);
  const records = [];
  for (let index = 0; index < values.length;) {
    const stat = values[index++];
    if (stat === undefined) throw new Error('Missing numstat record');
    const match = /^([^\t]+)\t([^\t]+)\t([\s\S]*)$/.exec(stat);
    const added = match?.[1];
    const deleted = match?.[2];
    const pathField = match?.[3];
    if (added === undefined || deleted === undefined || pathField === undefined) throw new Error('Malformed numstat counts');
    const binary = added === '-' && deleted === '-';
    const additions = binary ? null : Number(added);
    const deletions = binary ? null : Number(deleted);
    if (!binary && (!Number.isSafeInteger(additions) || !Number.isSafeInteger(deletions) || additions < 0 || deletions < 0)) throw new Error('Invalid numstat count');
    if (pathField === '') {
      const oldPath = values[index++];
      const path = values[index++];
      if (oldPath === undefined || path === undefined) throw new Error('Malformed rename numstat');
      records.push({ oldPath, path, additions, deletions, binary });
    } else {
      const path = pathField;
      records.push({ path, additions, deletions, binary });
    }
    if (records.length > MAX_RECORDS) throw new Error('Numstat record count exceeds limit');
  }
  return records;
}

function parseRawModes(buffer) {
  const values = fields(buffer);
  const modes = new Map();
  for (let index = 0; index < values.length;) {
    const header = values[index++];
    const match = /^:(\d{6}) (\d{6}) [0-9a-f]{40,64} [0-9a-f]{40,64} ([A-Z])(\d{0,3})$/i.exec(header ?? '');
    if (!match) throw new Error('Malformed raw mode record');
    const oldMode = match[1];
    const mode = match[2];
    const status = match[3];
    if (!VALID_MODES.has(oldMode) || !VALID_MODES.has(mode)) throw new Error('Unknown Git mode');
    const firstPath = values[index++];
    if (firstPath === undefined) throw new Error('Missing raw mode path');
    let path = firstPath;
    if (status === 'R' || status === 'C') {
      path = values[index++];
      if (path === undefined) throw new Error('Malformed raw rename/copy mode');
    }
    modes.set(path, mode);
  }
  return modes;
}

export function parseNulGitChangeRecords({ nameStatus, numstat, rawMode }) {
  const named = parseNameStatus(nameStatus);
  const stats = parseNumstat(numstat);
  const modes = parseRawModes(rawMode);
  const statByKey = new Map(stats.map(stat => [`${stat.oldPath ?? ''}\0${stat.path}`, stat]));
  return named.map(record => {
    const stat = statByKey.get(`${record.oldPath ?? ''}\0${record.path}`) ?? statByKey.get(`\0${record.path}`);
    const mode = modes.get(record.path) ?? '000000';
    if (!stat && record.status !== 'renamed' && record.status !== 'copied') throw new Error(`Missing numstat for ${record.path}`);
    return {
      ...(record.oldPath === undefined ? {} : { oldPath: record.oldPath }),
      path: record.path,
      status: record.status,
      mode,
      additions: stat?.additions ?? null,
      deletions: stat?.deletions ?? null,
      binary: stat?.binary ?? false,
    };
  });
}

function incompleteFeatures(headSha, preview, issue) {
  const paths = Array.isArray(preview?.reviewable_files) ? preview.reviewable_files.map(file => file.path).filter(path => typeof path === 'string') : [];
  return {
    schema_version: '3', head_sha: headSha, all_changed_files: [], ocr_reviewable_paths: paths,
    all_changed_file_count: null, reviewable_file_count: paths.length, excluded_file_count: null,
    additions: null, deletions: null, change_size: 'unknown', language_families: [], change_areas: [],
    test_files_changed: false, security_signal: 'unassessable', migration_signal: 'unassessable',
    classification_status: 'incomplete', features_incomplete: true, review_scope_gap: true,
    risk_floor: 'deep', concerns: [issue],
  };
}

function classify(files, paths, headSha) {
  const reviewable = new Set(paths);
  const incomplete = files.some(file => file.additions === null || file.deletions === null);
  const additions = incomplete ? null : files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = incomplete ? null : files.reduce((sum, file) => sum + file.deletions, 0);
  if ((additions !== null && !Number.isSafeInteger(additions)) || (deletions !== null && !Number.isSafeInteger(deletions))) throw new Error('Change count overflow');
  const count = files.length;
  const familyRules = [['javascript', /\.(?:[cm]?js|jsx)$/i], ['typescript', /\.(?:[cm]?ts|tsx)$/i], ['python', /\.py$/i], ['markdown', /\.md$/i], ['yaml', /\.ya?ml$/i], ['json', /\.json$/i], ['shell', /\.sh$/i], ['other', /./]];
  const families = [...new Set(files.map(file => familyRules.find(([, pattern]) => pattern.test(file.path))?.[0]).filter(Boolean))];
  const security = files.some(file => /(?:auth|security|secret|permission|crypto|token)/i.test(file.path)) ? 'metadata_positive' : 'metadata_not_observed';
  const migration = files.some(file => /(?:migration|migrations|schema|\.sql$)/i.test(file.path)) ? 'metadata_positive' : 'metadata_not_observed';
  const gap = files.some(file => !reviewable.has(file.path));
  const risk = count > 0 && (security === 'metadata_positive' || migration === 'metadata_positive' || count > 20 || additions === null || deletions === null);
  return {
    schema_version: '3', head_sha: headSha, all_changed_files: files,
    ocr_reviewable_paths: [...reviewable], all_changed_file_count: count,
    reviewable_file_count: reviewable.size, excluded_file_count: Math.max(0, count - reviewable.size),
    additions, deletions, change_size: additions === null || deletions === null ? 'unknown' : additions + deletions < 100 ? 'small' : additions + deletions < 500 ? 'medium' : 'large',
    language_families: families, change_areas: [], test_files_changed: files.some(file => /(?:^|[./_-])(?:test|tests|spec|__tests__)(?:[./_-]|$)/i.test(file.path)),
    security_signal: security, migration_signal: migration,
    classification_status: security === 'metadata_positive' || migration === 'metadata_positive'
      ? 'high_risk_metadata'
      : files.length === 0 ? 'unclassified_other' : 'unclassified_code',
    features_incomplete: incomplete, review_scope_gap: gap,
    risk_floor: risk || gap || incomplete ? 'deep' : 'fast',
  };
}

export async function extractPRFeatures({ cwd, baseRef, headSha, preview, runGit = defaultRunGit, maxOutputBytes = MAX_OUTPUT_BYTES }) {
  if (typeof headSha !== 'string' || !/^[0-9a-f]{40}$/i.test(headSha)) throw new Error('Commit SHA is invalid');
  if (typeof baseRef !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(baseRef) || baseRef.startsWith('/') || baseRef.endsWith('/') || baseRef.includes('..') || baseRef.includes('//')) throw new Error('Base ref is invalid');
  const reviewable = preview?.reviewable_files;
  if (!Array.isArray(reviewable) || reviewable.some(file => typeof file?.path !== 'string' || file.path.length === 0 || file.path.includes('\0'))) throw new Error('OCR preview has no valid reviewable file list');
  const paths = reviewable.map(file => file.path);
  const range = `origin/${baseRef}...${headSha}`;
  try {
    const verifiedHead = (await runGit('git', ['rev-parse', '--verify', `${headSha}^{commit}`], { cwd }));
    if (!Buffer.isBuffer(verifiedHead) || verifiedHead.length > maxOutputBytes || verifiedHead.toString('ascii').trim().toLowerCase() !== headSha.toLowerCase()) throw new Error('HEAD verification failed');
    const mergeBase = await runGit('git', ['merge-base', `origin/${baseRef}`, headSha], { cwd });
    if (!Buffer.isBuffer(mergeBase) || mergeBase.length > maxOutputBytes || !/^[0-9a-f]{40,64}\s*$/i.test(mergeBase.toString('ascii'))) throw new Error('Merge base is unavailable');
    const common = ['diff', '--no-ext-diff', '--no-textconv'];
    const args = [
      [...common, '--name-status', '-z', range],
      [...common, '--numstat', '-z', range],
      [...common, '--raw', '--no-abbrev', '-z', range],
    ];
    const results = await Promise.all(args.map(gitArgs => runGit('git', gitArgs, { cwd })));
    if (results.some(output => !Buffer.isBuffer(output)) || results.reduce((total, output) => total + output.length, 0) > maxOutputBytes) throw new Error('Git output exceeds byte limit');
    const files = parseNulGitChangeRecords({ nameStatus: results[0], numstat: results[1], rawMode: results[2] });
    return classify(files, paths, headSha);
  } catch (error) {
    return incompleteFeatures(headSha, preview, error instanceof Error ? error.message : 'Git metadata unavailable');
  }
}
