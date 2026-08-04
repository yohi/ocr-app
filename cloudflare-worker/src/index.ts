import { createAppAuth } from "@octokit/auth-app";

// --- PKCS#1 → PKCS#8 変換（WebCrypto は PKCS#8 のみサポート）---
function pemToDer(pem: string): Uint8Array {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function derLength(contentsLength: number): Uint8Array {
  if (contentsLength < 0x80) {
    return new Uint8Array([contentsLength]);
  }
  const bytes: number[] = [];
  let length = contentsLength;
  while (length > 0) {
    bytes.unshift(length & 0xff);
    length >>>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, array) => sum + array.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }
  return result;
}

function derSequence(contents: Uint8Array): Uint8Array {
  return concatBytes(new Uint8Array([0x30]), derLength(contents.length), contents);
}

function derInteger(value: number): Uint8Array {
  return new Uint8Array([0x02, 0x01, value]);
}

function derOctetString(contents: Uint8Array): Uint8Array {
  return concatBytes(new Uint8Array([0x04]), derLength(contents.length), contents);
}

function derToPem(der: Uint8Array, label: string): string {
  let binary = "";
  for (const byte of der) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

// rsaEncryption の OID (1.2.840.113549.1.1.1) + NULL パラメータ
const RSA_ENCRYPTION_ALGORITHM = new Uint8Array([
  0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
]);

function pkcs1ToPkcs8(pkcs1Pem: string): string {
  const pkcs1Der = pemToDer(pkcs1Pem);
  const version = derInteger(0);
  const algorithm = derSequence(RSA_ENCRYPTION_ALGORITHM);
  const privateKey = derOctetString(pkcs1Der);
  const pkcs8Der = derSequence(concatBytes(version, algorithm, privateKey));
  return derToPem(pkcs8Der, "PRIVATE KEY");
}

function normalizePrivateKey(privateKey: string): string {
  const withNewlines = privateKey.replace(/\\n/g, "\n");
  if (withNewlines.includes("BEGIN RSA PRIVATE KEY")) {
    return pkcs1ToPkcs8(withNewlines);
  }
  return withNewlines;
}

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
    readonly base: {
      readonly ref: string;
    };
  };
};

const textEncoder = new TextEncoder();

export function isRecord(value: unknown): value is Record<string, unknown> {
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
    typeof payload.pull_request.head.sha === "string" &&
    isRecord(payload.pull_request.base) &&
    typeof payload.pull_request.base.ref === "string"
  );
}

type IssueCommentPayload = {
  readonly action: string;
  readonly issue: {
    readonly number: number;
    readonly pull_request?: {
      readonly url: string;
    };
  };
  readonly comment: {
    readonly id: number;
readonly body: string;
};
  readonly repository: {
    readonly owner: {
      readonly login: string;
    };
    readonly name: string;
  };
  readonly installation: {
    readonly id: number;
  };
};

export function isIssueCommentPayload(payload: unknown): payload is IssueCommentPayload {
  if (!isRecord(payload) || typeof payload.action !== "string") return false;
  if (!isRecord(payload.issue) || typeof payload.issue.number !== "number") return false;
  if (payload.issue.pull_request !== undefined) {
    if (!isRecord(payload.issue.pull_request) || typeof payload.issue.pull_request.url !== "string") {
      return false;
    }
  }
  if (!isRecord(payload.comment) || typeof payload.comment.id !== "number" || typeof payload.comment.body !== "string") return false;
  if (!isRecord(payload.repository) || !isRecord(payload.repository.owner)) return false;
  if (
    typeof payload.repository.owner.login !== "string" ||
    typeof payload.repository.name !== "string"
  ) {
    return false;
  }
  return (
    isRecord(payload.installation) &&
    typeof payload.installation.id === "number"
  );
}

export function isMentioningReviewer(appSlug: string, body: string): boolean {
  const escapedSlug = appSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `review` の直後に単語文字またはハイフンが続く場合は除外（例: reviewboard, review-x）
  const mentionPattern = new RegExp(`@${escapedSlug}(?:\\[bot\\])?\\s+review(?![\\w-])`, "i");
  return mentionPattern.test(body);
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

async function createCheckRun(
  env: Env,
  token: string,
  repoOwner: string,
  repoName: string,
  headSha: string,
): Promise<number | null> {
  const abortController = new AbortController();
  // check run 作成は進捗表示用途なので、dispatch より短時間で打ち切る
  const timeout = setTimeout(() => abortController.abort(), 5_000);
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/check-runs`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Cloudflare-Worker-OCR-App",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: env.CHECK_RUN_NAME || "OpenCodeReview",
          head_sha: headSha,
          status: "queued",
          details_url: env.CHECK_RUN_DETAILS_URL || `https://github.com/${repoOwner}/${repoName}/actions`,
        }),
        signal: abortController.signal,
      },
    );

    if (!res.ok) {
      console.error("Failed to create check run:", res.status, await res.text());
      return null;
    }

    const data: unknown = await res.json();
    if (isRecord(data) && typeof data.id === "number") {
      return data.id;
    }
    console.error("Invalid check run response:", JSON.stringify(data));
    return null;
  } catch (error: unknown) {
    console.error("Error creating check run:", error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function sendRepositoryDispatch(
  env: Env,
  token: string,
  clientPayload: {
    target_repo: string;
    pr_number: number;
    commit_sha: string;
    base_ref: string;
    installation_id: number;
    check_run_id: number | null;
  },
): Promise<Response | null> {
  const dispatchRepo = env.TARGET_DISPATCH_REPO || "yohi/ocr-app";
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
        client_payload: clientPayload,
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
  return null;
}

async function getInstallationToken(
  env: Env,
  installationId: number,
): Promise<string> {
  const auth = createAppAuth({
    appId: env.GITHUB_APP_ID,
    privateKey: normalizePrivateKey(env.GITHUB_APP_PRIVATE_KEY),
  });

  const { token } = await auth({
    type: "installation",
    installationId,
  });

  return token;
}
async function addReaction(
  token: string,
  repoOwner: string,
  repoName: string,
  commentId: number,
): Promise<void> {
  const reactionAbortController = new AbortController();
  const reactionTimeout = setTimeout(() => reactionAbortController.abort(), 10_000);
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/issues/comments/${commentId}/reactions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Cloudflare-Worker-OCR-App",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "eyes" }),
        signal: reactionAbortController.signal,
      },
    );
    if (!res.ok) {
      console.error("Failed to add reaction:", res.status, await res.text());
    }
  } catch (error: unknown) {
    console.error("Failed to add reaction:", error instanceof Error ? error.message : error);
  } finally {
    clearTimeout(reactionTimeout);
  }
}

export interface Env {
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  WEBHOOK_SECRET: string;
  TARGET_DISPATCH_REPO?: string;
  GITHUB_APP_SLUG: string;
  CHECK_RUN_NAME?: string;
  CHECK_RUN_DETAILS_URL?: string;
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

    const appSlug = env.GITHUB_APP_SLUG;
    if (typeof appSlug !== "string" || appSlug.length === 0) {
      console.error("GITHUB_APP_SLUG is not configured");
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

      if (githubEvent !== "pull_request" && githubEvent !== "issue_comment") {
        return new Response("Invalid GitHub event", { status: 400 });
      }

      let payload: unknown;
      try {
        payload = JSON.parse(new TextDecoder().decode(rawBody));
      } catch {
        return new Response("Invalid payload", { status: 400 });
      }

      if (githubEvent === "pull_request") {
        if (!isPullRequestWebhookPayload(payload)) {
          return new Response("Invalid payload", { status: 400 });
        }

        const action = payload.action;

        // PR 開設・更新時のみトリガー
        if (action === "opened" || action === "synchronize" || action === "reopened") {
          const repoOwner = payload.repository.owner.login;
          const repoName = payload.repository.name;
          const prNumber = payload.number;
          const token = await getInstallationToken(env, payload.installation.id);
          const checkRunId = await createCheckRun(
            env,
            token,
            repoOwner,
            repoName,
            payload.pull_request.head.sha,
          );
          if (checkRunId === null) {
            console.warn("Proceeding without a progress check run because createCheckRun returned null");
          }
          const dispatchResponse = await sendRepositoryDispatch(env, token, {
            target_repo: `${repoOwner}/${repoName}`,
            pr_number: prNumber,
            commit_sha: payload.pull_request.head.sha,
            base_ref: payload.pull_request.base.ref,
            installation_id: payload.installation.id,
            check_run_id: checkRunId,
          });
          if (dispatchResponse !== null) {
            return dispatchResponse;
          }
        }
      }

      if (githubEvent === "issue_comment") {
        if (!isIssueCommentPayload(payload)) {
          return new Response("Invalid payload", { status: 400 });
        }

        if (
          payload.action === "created" &&
          payload.issue.pull_request !== undefined &&
          isMentioningReviewer(appSlug, payload.comment.body)
        ) {
          const repoOwner = payload.repository.owner.login;
          const repoName = payload.repository.name;
          const prNumber = payload.issue.number;

          const token = await getInstallationToken(env, payload.installation.id);
          await addReaction(token, repoOwner, repoName, payload.comment.id);

          const prAbortController = new AbortController();
          const prTimeout = setTimeout(() => prAbortController.abort(), 10_000);
          let pullRequestResponse;
          try {

            pullRequestResponse = await fetch(
              `https://api.github.com/repos/${repoOwner}/${repoName}/pulls/${prNumber}`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  Accept: "application/vnd.github.v3+json",
                  "User-Agent": "Cloudflare-Worker-OCR-App",
                },
                signal: prAbortController.signal,
              },
            );
          } finally {
            clearTimeout(prTimeout);
          }
          if (!pullRequestResponse.ok) {
            return new Response("Pull request lookup failed", {
              status: pullRequestResponse.status,
            });
          }

          let pullRequestPayload: unknown;
          try {
            pullRequestPayload = await pullRequestResponse.json();
          } catch (error: unknown) {
            console.error("Error parsing pull request response:", error instanceof Error ? error.message : error);
            return new Response("Invalid pull request response", { status: 502 });
          }

          if (
            !isRecord(pullRequestPayload) ||
            !isRecord(pullRequestPayload.head) ||
            typeof pullRequestPayload.head.sha !== "string" ||
            pullRequestPayload.head.sha.trim().length === 0 ||
            !isRecord(pullRequestPayload.base) ||
            typeof pullRequestPayload.base.ref !== "string"
          ) {
            return new Response("Invalid pull request response", { status: 502 });
          }

          const checkRunId = await createCheckRun(
            env,
            token,
            repoOwner,
            repoName,
            pullRequestPayload.head.sha,
          );
          if (checkRunId === null) {
            console.warn("Proceeding without a progress check run because createCheckRun returned null");
          }

          const dispatchResponse = await sendRepositoryDispatch(env, token, {
            target_repo: `${repoOwner}/${repoName}`,
            pr_number: prNumber,
            commit_sha: pullRequestPayload.head.sha,
            base_ref: pullRequestPayload.base.ref,
            installation_id: payload.installation.id,
            check_run_id: checkRunId,
          });
          if (dispatchResponse !== null) {
            return dispatchResponse;
          }
          return new Response("OK", { status: 200 });
        }
      }

      return new Response("OK", { status: 200 });
    } catch (error: unknown) {
      console.error("Worker error:", error instanceof Error ? error.stack ?? error.message : String(error));
      return new Response("Internal Error", { status: 500 });
    }
  },
};
