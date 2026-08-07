import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createConfig,
  parseLlmResponse,
  buildPrompt,
  buildFetchThreadsQuery,
  buildReplyMutation,
  buildResolveMutation,
  extractCodeContext
} from './resolve-threads.mjs';

test('createConfig parses CLI args and token correctly', () => {
  const args = ['--repo', 'owner/repo', '--pr', '123', '--target-dir', 'target-repo'];
  const config = createConfig(args, 'test-token');
  assert.equal(config.repo, 'owner/repo');
  assert.equal(config.owner, 'owner');
  assert.equal(config.name, 'repo');
  assert.equal(config.prNumber, 123);
  assert.equal(config.targetDir, 'target-repo');
  assert.equal(config.token, 'test-token');
});

test('parseLlmResponse parses valid JSON with resolved boolean', () => {
  const input = '```json\n{"resolved": true, "reason": "Fixed in HEAD"}\n```';
  const result = parseLlmResponse(input);
  assert.equal(result.resolved, true);
  assert.equal(result.reason, 'Fixed in HEAD');
});

test('parseLlmResponse handles invalid JSON by returning resolved: false', () => {
  const result = parseLlmResponse('Not JSON content');
  assert.equal(result.resolved, false);
  assert.ok(result.reason.includes('Failed to parse'));
});

test('buildFetchThreadsQuery generates valid GraphQL query', () => {
  const query = buildFetchThreadsQuery({ owner: 'owner', name: 'repo', prNumber: 123 });
  assert.ok(query.includes('owner: "owner"'));
  assert.ok(query.includes('number: 123'));
});

test('buildReplyMutation formats mutation string correctly', () => {
  const mutation = buildReplyMutation('thread-123', 'Resolved message');
  assert.ok(mutation.includes('thread-123'));
  assert.ok(mutation.includes('Resolved message'));
});

test('buildResolveMutation formats mutation string correctly', () => {
  const mutation = buildResolveMutation('thread-123');
  assert.ok(mutation.includes('thread-123'));
});

test('extractCodeContext loads file snippet correctly', () => {
  const snippet = extractCodeContext('.', 'README.md');
  assert.ok(typeof snippet === 'string');
});

test('parseLlmResponse returns resolved: false for non-boolean resolved property like "false" or "true"', () => {
  const inputFalse = '{"resolved": "false", "reason": "Not fixed"}';
  const resultFalse = parseLlmResponse(inputFalse);
  assert.equal(resultFalse.resolved, false);

  const inputTrueString = '{"resolved": "true", "reason": "Fixed"}';
  const resultTrueString = parseLlmResponse(inputTrueString);
  assert.equal(resultTrueString.resolved, false);
});

test('extractCodeContext prevents path traversal outside target directory', () => {
  const snippet = extractCodeContext('.', '../README.md');
  assert.equal(snippet, null);
});
