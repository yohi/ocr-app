#!/usr/bin/env node

/**
 * @file llm-proxy.mjs
 * @description TrueFoundry / GCP Gemini API 互換性吸収プロキシサーバー
 *
 * 【背景・目的】
 * TrueFoundry AI Gateway (https://gateway.truefoundry.ai) 経由で Gemini モデル
 * （chat/gemini-flash 等）を使用する際、OpenCodeReview CLI が送信する OpenAI 互換の
 * Function Calling リクエストにおいて、2ターン目以降の `role: "tool"` (または `role: "function"`)
 * メッセージを TrueFoundry 側が GCP Vertex AI API へ変換プロキシする過程で不具合が発生します。
 *
 * 具体的には、TrueFoundry が `role: "tool"` を GCP 側の `role: "function"` に誤変換して送信し、
 * GCP 側から以下のエラー（HTTP 400 Bad Request）が返却されて review 処理が失敗します：
 *   "gcp error: Role 'function' is not supported. Please use a valid role: SYSTEM, SYSTEM_1, USER, ASSISTANT, DEVELOPER, CONTEXT, USER_CONTEXT, MODEL, USER."
 *
 * 【仕組み】
 * このスクリプトは、OpenCodeReview CLI からの通信をローカル（http://127.0.0.1:8080）で受け取り、
 * メッセージ配列内の `role: "tool"` または `role: "function"` を GCP が受容可能な `role: "user"` に
 * 動的に書き換えた上で、実際の LLM ゲートウェイ（`REAL_OCR_LLM_URL`）へ中継転送します。
 * OpenCodeReview CLI 本体には一切変更を加えることなく、互換性問題を完全に回避できます。
 */

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

/**
 * リクエストペイロード内の messages 配列を変換する関数。
 * `role: "tool"` または `role: "function"` を `role: "user"` に変換し、
 * ツール実行結果のコンテキストを保持したテキストに整形します。
 *
 * @param {object} payload - OpenAI 互換リクエストオブジェクト
 * @returns {object} 変換後のリクエストオブジェクト
 */
export function transformPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }
  if (!Array.isArray(payload.messages)) {
    return payload;
  }

  const transformedMessages = payload.messages.map((msg) => {
    if (!msg || typeof msg !== 'object') return msg;

    // role: "tool" または role: "function" の場合に role: "user" へ置換
    if (msg.role === 'tool' || msg.role === 'function') {
      const toolCallIdHeader = msg.tool_call_id ? `[Tool Call ID: ${msg.tool_call_id}]\n` : '';
      const contentStr = typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content);

      return {
        ...msg,
        role: 'user',
        content: `[Tool Execution Result]\n${toolCallIdHeader}${contentStr}`,
      };
    }

    return msg;
  });

  return {
    ...payload,
    messages: transformedMessages,
  };
}

/**
 * ローカルプロキシサーバーを作成・起動する
 *
 * @param {object} options
 * @param {string} options.targetUrl - 転送先の実際の LLM エンドポイント URL
 * @param {number} [options.port=8080] - バインドするローカルポート
 * @returns {Promise<http.Server>} 起動した http.Server インスタンス
 */
export function createProxyServer({ targetUrl, port = 8080 }) {
  if (!targetUrl) {
    throw new Error('targetUrl is required for createProxyServer');
  }

  const parsedTarget = new URL(targetUrl);
  const isHttps = parsedTarget.protocol === 'https:';
  const transport = isHttps ? https : http;

  const server = http.createServer((req, res) => {
    let bodyChunks = [];
    req.on('data', (chunk) => bodyChunks.push(chunk));
    req.on('end', () => {
      const rawBody = Buffer.concat(bodyChunks).toString('utf-8');
      let forwardedBody = rawBody;

      if (rawBody && (req.headers['content-type']?.includes('application/json') || rawBody.startsWith('{'))) {
        try {
          const json = JSON.parse(rawBody);
          const transformed = transformPayload(json);
          forwardedBody = JSON.stringify(transformed);
        } catch (error) {
          // JSONパースに失敗した場合は変換せずにそのまま転送
        }
      }

      // 転送用ヘッダーの準備（host, content-length, transfer-encoding を除外して再設定）
      const headers = {};
      for (const [key, value] of Object.entries(req.headers)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey !== 'host' && lowerKey !== 'content-length' && lowerKey !== 'transfer-encoding') {
          headers[key] = value;
        }
      }
      headers['content-length'] = String(Buffer.byteLength(forwardedBody));

      // 転送先パスの組み立て（パスが /chat/completions で終わっていない場合は補完）
      let targetPath = parsedTarget.pathname.replace(/\/+$/, '');
      if (!targetPath.endsWith('/chat/completions')) {
        targetPath += '/chat/completions';
      }

      // 上流（TrueFoundry / Groq 等）へのリクエスト設定
      const options = {
        hostname: parsedTarget.hostname,
        port: parsedTarget.port || (isHttps ? 443 : 80),
        path: targetPath + parsedTarget.search,
        method: req.method,
        headers,
      };

      console.log(`[LLM Proxy] ${req.method} ${req.url} -> forwarding to ${options.hostname}:${options.port}${options.path}`);

      const proxyReq = transport.request(options, (proxyRes) => {
        console.log(`[LLM Proxy] Upstream response status: ${proxyRes.statusCode}`);

        if (proxyRes.statusCode < 200 || proxyRes.statusCode >= 300) {
          let errBody = '';
          proxyRes.on('data', (chunk) => errBody += chunk);
          proxyRes.on('end', () => {
            console.error(`[LLM Proxy Error Response Body (${proxyRes.statusCode})]:`, errBody);
          });
        }

        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      });

      proxyReq.on('error', (error) => {
        console.error('[LLM Proxy Error] Upstream connection failed:', error.message);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Bad Gateway', message: error.message }));
        }
      });

      proxyReq.write(forwardedBody);
      proxyReq.end();
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`[LLM Proxy] Listening on http://127.0.0.1:${port} -> forwarding to ${targetUrl}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

// 直接スクリプトとして実行された場合の処理
const isExecutedDirectly = process.argv[1] &&
  (process.argv[1].endsWith('llm-proxy.mjs') || import.meta.url.endsWith(process.argv[1]));

if (isExecutedDirectly) {
  const targetUrl = process.env.REAL_OCR_LLM_URL || process.env.OCR_LLM_URL || 'https://gateway.truefoundry.ai/chat/completions';
  const port = parseInt(process.env.LLM_PROXY_PORT || '8080', 10);

  createProxyServer({ targetUrl, port }).catch((err) => {
    console.error('[LLM Proxy Fatal Error]', err);
    process.exit(1);
  });
}
