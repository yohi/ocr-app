import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, test } from 'node:test';

import { createProxyServer, transformPayload } from './llm-proxy.mjs';

const activeServers = [];

afterEach(() => {
  for (const server of activeServers) {
    try {
      server.close();
    } catch {
      // ignore
    }
  }
  activeServers.length = 0;
});

test('transformPayload converts role: "tool" and role: "function" to role: "user"', () => {
  const input = {
    model: 'chat/gemini-flash',
    messages: [
      { role: 'system', content: 'You are a reviewer.' },
      { role: 'user', content: 'Review this file.' },
      {
        role: 'assistant',
        tool_calls: [{ id: 'call_123', type: 'function', function: { name: 'file_read', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'call_123', content: 'console.log("hello");' },
      { role: 'function', content: 'function output' },
    ],
  };

  const output = transformPayload(input);

  assert.equal(output.messages.length, 5);
  assert.equal(output.messages[0].role, 'system');
  assert.equal(output.messages[1].role, 'user');
  assert.equal(output.messages[2].role, 'assistant');
  assert.equal(output.messages[3].role, 'user');
  assert.ok(output.messages[3].content.includes('[Tool Execution Result]'));
  assert.ok(output.messages[3].content.includes('call_123'));
  assert.ok(output.messages[3].content.includes('console.log("hello");'));
  assert.equal(output.messages[4].role, 'user');
});

test('transformPayload caps max_completion_tokens to 32768 when greater than 32768', () => {
  const input = {
    model: 'llama-3.3-70b-versatile',
    max_completion_tokens: 65536,
    messages: [{ role: 'user', content: 'test' }],
  };

  const output = transformPayload(input);
  assert.equal(output.max_completion_tokens, 32768);
});

test('createProxyServer intercepts and transforms request body before forwarding upstream', async () => {
  let receivedUpstreamBody = null;

  // Mock upstream LLM server
  const mockUpstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      receivedUpstreamBody = JSON.parse(body);
      const resPayload = JSON.stringify({ status: 'ok' });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(resPayload),
      });
      res.end(resPayload);
    });
  });

  await new Promise((resolve) => mockUpstream.listen(0, '127.0.0.1', resolve));
  activeServers.push(mockUpstream);
  const upstreamPort = mockUpstream.address().port;
  const upstreamUrl = `http://127.0.0.1:${upstreamPort}/chat/completions`;

  // Proxy server under test
  const proxyServer = await createProxyServer({ targetUrl: upstreamUrl, port: 0 });
  activeServers.push(proxyServer);
  const proxyPort = proxyServer.address().port;

  // Send request with role: "tool" to proxy
  const proxyResponse = await new Promise((resolve, reject) => {
    const req = http.request(
      `http://127.0.0.1:${proxyPort}/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let resBody = '';
        res.on('data', (chunk) => resBody += chunk);
        res.on('end', () => {
          if (!resBody) {
            return reject(new Error(`Empty response body received from proxy (status ${res.statusCode})`));
          }
          resolve({ status: res.statusCode, data: JSON.parse(resBody) });
        });
      }
    );
    req.on('error', reject);
    req.write(
      JSON.stringify({
        model: 'chat/gemini-flash',
        messages: [
          { role: 'user', content: 'Read file' },
          { role: 'tool', tool_call_id: 'call_abc', content: 'file content' },
        ],
      })
    );
    req.end();
  });

  assert.equal(proxyResponse.status, 200);
  assert.equal(proxyResponse.data.status, 'ok');

  // Verify upstream received transformed payload with role: "user"
  assert.ok(receivedUpstreamBody);
  assert.equal(receivedUpstreamBody.messages[1].role, 'user');
  assert.ok(receivedUpstreamBody.messages[1].content.includes('file content'));
});

test('createProxyServer correctly appends /chat/completions if targetUrl is a base URL', async () => {
  let requestedPath = null;

  const mockUpstream = http.createServer((req, res) => {
    requestedPath = req.url;
    const resPayload = JSON.stringify({ status: 'ok' });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(resPayload),
    });
    res.end(resPayload);
  });

  await new Promise((resolve) => mockUpstream.listen(0, '127.0.0.1', resolve));
  activeServers.push(mockUpstream);
  const upstreamPort = mockUpstream.address().port;
  // Base URL without /chat/completions
  const upstreamBaseUrl = `http://127.0.0.1:${upstreamPort}/openai/v1`;

  const proxyServer = await createProxyServer({ targetUrl: upstreamBaseUrl, port: 0 });
  activeServers.push(proxyServer);
  const proxyPort = proxyServer.address().port;

  await new Promise((resolve, reject) => {
    const req = http.request(
      `http://127.0.0.1:${proxyPort}/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let resBody = '';
        res.on('data', (chunk) => resBody += chunk);
        res.on('end', () => resolve());
      }
    );
    req.on('error', reject);
    req.write(JSON.stringify({ messages: [{ role: 'user', content: 'test' }] }));
    req.end();
  });

  assert.equal(requestedPath, '/openai/v1/chat/completions');
});

test('createProxyServer preserves query params and normalizes existing /chat/completions/ suffix without duplicating it', async () => {
  let requestedPath = '';

  const mockUpstream = http.createServer((req, res) => {
    requestedPath = req.url;
    const resPayload = JSON.stringify({ status: 'ok' });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(resPayload),
    });
    res.end(resPayload);
  });

  await new Promise((resolve) => mockUpstream.listen(0, '127.0.0.1', resolve));
  activeServers.push(mockUpstream);
  const upstreamPort = mockUpstream.address().port;
  const upstreamBaseUrl = `http://127.0.0.1:${upstreamPort}/openai/v1/chat/completions/?trace=1`;

  const proxyServer = await createProxyServer({ targetUrl: upstreamBaseUrl, port: 0 });
  activeServers.push(proxyServer);
  const proxyPort = proxyServer.address().port;

  await new Promise((resolve, reject) => {
    const req = http.request(
      `http://127.0.0.1:${proxyPort}/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let resBody = '';
        res.on('data', (chunk) => resBody += chunk);
        res.on('end', () => resolve());
      }
    );
    req.on('error', reject);
    req.write(JSON.stringify({ messages: [{ role: 'user', content: 'test' }] }));
    req.end();
  });

  assert.equal(requestedPath, '/openai/v1/chat/completions?trace=1');
});
