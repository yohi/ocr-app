import { createAppAuth } from "@octokit/auth-app";

type PullRequestWebhookPayload = {
  readonly action: string;
  readonly repository: {
    readonly owner: {
      readonly login: string;
    };
    readonly name: string;
  };
  readonly number: number;
  readonly installation: {
    readonly id: number;
  };
  readonly pull_request: {
    readonly head: {
      readonly sha: string;
    };
  };
};

const textEncoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPullRequestWebhookPayload(payload: unknown): payload is PullRequestWebhookPayload {
  if (!isRecord(payload) || typeof payload.action !== "string" || typeof payload.number !== "number") {
    return false;
  }

  if (!isRecord(payload.repository) || !isRecord(payload.repository.owner)) {
    return false;
  }

  if (
    typeof payload.repository.owner.login !== "string" ||
    typeof payload.repository.name !== "string"
  ) {
    return false;
  }

  if (!isRecord(payload.installation) || typeof payload.installation.id !== "number") {
    return false;
  }

  return (
    isRecord(payload.pull_request) &&
    isRecord(payload.pull_request.head) &&
    typeof payload.pull_request.head.sha === "string"
  );
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }

  return difference === 0;
}

async function hasValidWebhookSignature(
  rawBody: ArrayBuffer,
  headerSignature: string,
  secret: string,
): Promise<boolean> {
  const signatureMatch = /^sha256=([0-9a-f]{64})$/i.exec(headerSignature);
  if (!signatureMatch || signatureMatch[1] === undefined) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const calculatedSignature = await crypto.subtle.sign("HMAC", key, rawBody);
  const expectedSignature = textEncoder.encode(arrayBufferToHex(calculatedSignature));
  const receivedSignature = textEncoder.encode(signatureMatch[1].toLowerCase());

  return timingSafeEqual(expectedSignature, receivedSignature);
}

export interface Env {
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  WEBHOOK_SECRET: string;
  TARGET_DISPATCH_REPO?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const webhookSecret = env.WEBHOOK_SECRET;
    if (typeof webhookSecret !== "string" || webhookSecret.length === 0) {
      console.error("Webhook signing secret is not configured");
      return new Response("Internal Error", { status: 500 });
    }

    try {
      const headerSignature = request.headers.get("X-Hub-Signature-256");
      if (headerSignature === null) {
        return new Response("Invalid signature", { status: 401 });
      }

      const rawBody = await request.arrayBuffer();
      if (!(await hasValidWebhookSignature(rawBody, headerSignature, webhookSecret))) {
        return new Response("Invalid signature", { status: 401 });
      }

      const githubEvent = request.headers.get("X-GitHub-Event");
      if (githubEvent === "ping") {
        return new Response("OK", { status: 200 });
      }

      if (githubEvent !== "pull_request") {
        return new Response("Invalid GitHub event", { status: 400 });
      }

      let payload: unknown;
      try {
        payload = JSON.parse(new TextDecoder().decode(rawBody));
      } catch {
        return new Response("Invalid payload", { status: 400 });
      }

      if (!isPullRequestWebhookPayload(payload)) {
        return new Response("Invalid payload", { status: 400 });
      }

      const action = payload.action;

      // PR 開設・更新時のみトリガー
      if (action === "opened" || action === "synchronize" || action === "reopened") {
        const repoOwner = payload.repository.owner.login;
        const repoName = payload.repository.name;
        const prNumber = payload.number;

        // GitHub App Token を発行
        const auth = createAppAuth({
          appId: env.GITHUB_APP_ID,
          privateKey: env.GITHUB_APP_PRIVATE_KEY,
        });

        const { token } = await auth({
          type: "installation",
          installationId: payload.installation.id,
        });

        const dispatchRepo = env.TARGET_DISPATCH_REPO || "yohi/ocr-app";

        // 中央リポジトリの Actions (repository_dispatch) を起動
        const dispatchAbortController = new AbortController();
        const dispatchTimeout = setTimeout(() => dispatchAbortController.abort(), 10_000);
        try {
          const res = await fetch(`https://api.github.com/repos/${dispatchRepo}/dispatches`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github.v3+json",
              "User-Agent": "Cloudflare-Worker-OCR-App",
            },
            body: JSON.stringify({
              event_type: "open_code_review_trigger",
              client_payload: {
                target_repo: `${repoOwner}/${repoName}`,
                pr_number: prNumber,
                commit_sha: payload.pull_request.head.sha,
                installation_id: payload.installation.id,
              },
            }),
            signal: dispatchAbortController.signal,
          });

          if (!res.ok) {
            const errText = await res.text();
            console.error("Dispatch failed:", res.status, errText);
            return new Response("Dispatch failed", { status: res.status });
          }
        } finally {
          clearTimeout(dispatchTimeout);
        }
      }

      return new Response("OK", { status: 200 });
    } catch (error: unknown) {
      console.error("Worker error:", error instanceof Error ? error.stack ?? error.message : String(error));
      return new Response("Internal Error", { status: 500 });
    }
  },
};
