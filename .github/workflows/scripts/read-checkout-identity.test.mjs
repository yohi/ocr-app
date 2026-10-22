import test from 'node:test';
import assert from 'node:assert/strict';
import { readCheckoutIdentity } from './read-checkout-identity.mjs';

const sha = 'a'.repeat(40);
const input = (origin, head = `${sha}\n`) => ({ cwd: '/checkout', expectedRepo: 'owner/repo', expectedHeadSha: sha, runGit: async (_command, args) => args[0] === 'config' ? origin : head });

for (const [name, origin, fullName] of [
  ['HTTPS', 'https://github.com/owner/repo.git\n', 'owner/repo'],
  ['SSH', 'git@github.com:owner/repo.git\n', 'owner/repo'],
  ['case-normalized HTTPS origin', 'https://github.com/OWNER/REPO.GIT\n', 'OWNER/REPO'],
  ['case-normalized SSH origin', 'git@github.com:OWNER/REPO\n', 'OWNER/REPO'],
]) {
  test(`reads a valid ${name} origin and actual HEAD`, async () => {
    assert.deepEqual(await readCheckoutIdentity(input(origin)), { fullName, headSha: sha });
  });
}

test('requests only origin and verified HEAD using argument arrays', async () => {
  const calls = [];
  await readCheckoutIdentity({ ...input('', ''), runGit: async (command, args, options) => { calls.push([command, args, options]); return args[0] === 'config' ? 'https://github.com/owner/repo' : sha; } });
  assert.deepEqual(calls, [['git', ['config', '--get', 'remote.origin.url'], { cwd: '/checkout' }], ['git', ['rev-parse', '--verify', 'HEAD'], { cwd: '/checkout' }]]);
});

for (const [name, origin, head] of [
  ['wrong repository', 'https://github.com/other/repo', sha],
  ['missing remote', '', sha],
  ['credential URL', 'https://user:password@github.com/owner/repo', sha],
  ['local path', '../owner/repo', sha],
  ['query string', 'https://github.com/owner/repo?x=1', sha],
  ['fragment', 'https://github.com/owner/repo#main', sha],
  ['multiline origin', 'https://github.com/owner/repo\nhttps://github.com/other/repo', sha],
  ['oversized origin output', `https://github.com/owner/repo${'x'.repeat(4096)}`, sha],
  ['stale actual HEAD', 'https://github.com/owner/repo', 'b'.repeat(40)],
  ['malformed HEAD', 'https://github.com/owner/repo', `${sha} trailing`],
  ['oversized HEAD output', 'https://github.com/owner/repo', `${sha}${'x'.repeat(4096)}`],
]) {
  test(`rejects ${name}`, async () => assert.rejects(readCheckoutIdentity(input(origin, head)), { message: 'CHECKOUT_IDENTITY_MISMATCH' }));
}

test('maps git command failures to the fixed mismatch error', async () => {
  await assert.rejects(readCheckoutIdentity({ ...input('', ''), runGit: async () => { throw new Error('sensitive git output'); } }), { message: 'CHECKOUT_IDENTITY_MISMATCH' });
});
