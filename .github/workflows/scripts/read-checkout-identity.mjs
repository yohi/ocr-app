import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 4096;
const TIMEOUT = 10000;

function mismatch() {
  throw new Error('CHECKOUT_IDENTITY_MISMATCH');
}

function gitOutputText(value) {
  if (Buffer.isBuffer(value) && value.length <= MAX_BUFFER) return value.toString('utf8');
  if (typeof value === 'string' && Buffer.byteLength(value) <= MAX_BUFFER) return value;
  return '';
}

function parseOrigin(value) {
  if (typeof value !== 'string' || value.length > MAX_BUFFER) return null;
  const normalized = value.endsWith('\n') ? value.slice(0, -1) : value;
  if (/[\r\n]/.test(normalized)) return null;
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([a-z0-9-]+)\/([a-z0-9._-]+?)(?:\.git)?$/i.exec(normalized);
  if (!match?.[2] || match[2] === '.' || match[2] === '..') return null;
  return `${match[1]}/${match[2]}`;
}

async function productionRunGit(command, args, { cwd }) {
  if (command !== 'git' || !Array.isArray(args) || !['config --get remote.origin.url', 'rev-parse --verify HEAD'].includes(args.join(' '))) mismatch();
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: TIMEOUT, maxBuffer: MAX_BUFFER, encoding: 'utf8' });
  return stdout;
}

export async function readCheckoutIdentity({ cwd, expectedRepo, expectedHeadSha, runGit = productionRunGit }) {
  if (typeof cwd !== 'string' || !cwd || typeof runGit !== 'function') mismatch();
  let origin;
  let head;
  try {
    origin = await runGit('git', ['config', '--get', 'remote.origin.url'], { cwd });
    head = await runGit('git', ['rev-parse', '--verify', 'HEAD'], { cwd });
  } catch {
    mismatch();
  }
  const fullName = parseOrigin(gitOutputText(origin));
  const normalizedExpectedRepo = typeof expectedRepo === 'string' ? expectedRepo.replace(/\.git$/i, '').toLowerCase() : '';
  const headText = gitOutputText(head);
  const headSha = /^[0-9a-f]{40}\n?$/.test(headText) ? headText.trim() : '';
  const normalizedExpectedHead = typeof expectedHeadSha === 'string' ? expectedHeadSha.toLowerCase() : '';
  if (fullName?.toLowerCase() !== normalizedExpectedRepo || !/^[0-9a-f]{40}$/.test(headSha) || headSha !== normalizedExpectedHead) mismatch();
  return { fullName, headSha };
}
