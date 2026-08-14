import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isRecord, isIssueCommentPayload, isMentioningReviewer, hasRequiredLabel } from "./index";
import worker from "./index";

vi.mock("@octokit/auth-app", () => ({
  createAppAuth: vi.fn(() => vi.fn(() => Promise.resolve({ token: "test-token" }))),
}));

async function calculateSignature(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return `sha256=${Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function createIssueCommentRequest(payload: unknown, signature: string): Request {
  return new Request("https://example.com/webhook", {
    method: "POST",
    headers: {
      "X-GitHub-Event": "issue_comment",
      "X-Hub-Signature-256": signature,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

describe("isRecord", () => {
  it("returns true for objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it("returns false for non-objects", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord("string")).toBe(false);
    expect(isRecord(123)).toBe(false);
  });
});

describe("isIssueCommentPayload", () => {
  it("returns true for valid payload", () => {
    const payload = {
      action: "created",
      issue: { number: 1, pull_request: { url: "https://..." } },
      comment: { id: 123, body: "@opencodereview-app review" },
      repository: { owner: { login: "owner" }, name: "repo" },
      installation: { id: 123 },
    };
    expect(isIssueCommentPayload(payload)).toBe(true);
  });

  it("returns false for missing fields", () => {
    expect(isIssueCommentPayload({})).toBe(false);
    expect(isIssueCommentPayload({ action: "created" })).toBe(false);
  });

  it("returns false when comment.id is missing or not a number", () => {
    const basePayload = {
      action: "created",
      issue: { number: 1, pull_request: { url: "https://..." } },
      repository: { owner: { login: "owner" }, name: "repo" },
      installation: { id: 123 },
    };
    expect(isIssueCommentPayload({ ...basePayload, comment: { body: "@opencodereview-app review" } })).toBe(false);
    expect(isIssueCommentPayload({ ...basePayload, comment: { id: "123", body: "@opencodereview-app review" } })).toBe(false);
  });

  it("returns false when issue.pull_request.url is not a string", () => {
    const basePayload = {
      action: "created",
      issue: { number: 1, pull_request: { url: 123 } },
      comment: { id: 123, body: "@opencodereview-app review" },
      repository: { owner: { login: "owner" }, name: "repo" },
      installation: { id: 123 },
    };
    expect(isIssueCommentPayload(basePayload)).toBe(false);
  });
});

describe("isMentioningReviewer", () => {
  it("matches @opencodereview-app review", () => {
    expect(isMentioningReviewer("opencodereview-app", "@opencodereview-app review")).toBe(true);
  });

  it("matches @opencodereview-app[bot] review", () => {
    expect(isMentioningReviewer("opencodereview-app", "@opencodereview-app[bot] review")).toBe(true);
  });

  it("matches in middle of sentence", () => {
    expect(isMentioningReviewer("opencodereview-app", "レビューお願いします @opencodereview-app review")).toBe(true);
  });

  it("does not match typos", () => {
    expect(isMentioningReviewer("opencodereview-app", "@opencodereview-app summary")).toBe(false);
    expect(isMentioningReviewer("opencodereview-app", "@other-bot review")).toBe(false);
  });

  it("does not match 'reviewing' or 'review-now'", () => {
    expect(isMentioningReviewer("opencodereview-app", "@opencodereview-app reviewing")).toBe(false);
    expect(isMentioningReviewer("opencodereview-app", "@opencodereview-app review-now")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isMentioningReviewer("opencodereview-app", "@OPENCODEREVIEW-APP REVIEW")).toBe(true);
  });

  it("escapes regex metacharacters in slug", () => {
    expect(isMentioningReviewer("review.app", "@review.app review")).toBe(true);
    expect(isMentioningReviewer("review.app", "@reviewXapp review")).toBe(false);
  });
});

describe("issue_comment mention flow", () => {
  const env = {
    GITHUB_APP_ID: "123",
    GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEA\n-----END PRIVATE KEY-----",
    WEBHOOK_SECRET: "test-secret",
    GITHUB_APP_SLUG: "opencodereview-app",
  };

  const basePayload = {
    action: "created",
    issue: { number: 1, pull_request: { url: "https://api.github.com/repos/owner/repo/pulls/1" } },
    comment: { id: 123, body: "@opencodereview-app review" },
    repository: { owner: { login: "owner" }, name: "repo" },
    installation: { id: 456 },
  };

  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds reaction, fetches pull request, creates check run, and dispatches", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 201, text: async () => "" }) // reaction
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ head: { sha: "abc123" }, base: { ref: "main" } }) }) // PR
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 98765 }) }) // create check run
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => "" }); // dispatch

    const body = JSON.stringify(basePayload);
    const request = createIssueCommentRequest(basePayload, await calculateSignature(env.WEBHOOK_SECRET, body));
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [reactionCall, prCall, checkRunCall, dispatchCall] = fetchMock.mock.calls;
    expect(reactionCall[0]).toBe("https://api.github.com/repos/owner/repo/issues/comments/123/reactions");
    expect((reactionCall[1] as RequestInit | undefined)?.method).toBe("POST");
    expect((reactionCall[1] as RequestInit | undefined)?.body).toBe(JSON.stringify({ content: "eyes" }));
    expect(prCall[0]).toBe("https://api.github.com/repos/owner/repo/pulls/1");
    const checkRunBody = JSON.parse((checkRunCall[1] as RequestInit | undefined)?.body as string);
    expect(checkRunBody.status).toBe("queued");
    expect(checkRunBody.head_sha).toBe("abc123");
    expect(checkRunCall[0]).toBe("https://api.github.com/repos/owner/repo/check-runs");
    expect((checkRunCall[1] as RequestInit | undefined)?.method).toBe("POST");
    expect(dispatchCall[0]).toBe("https://api.github.com/repos/yohi/ocr-app/dispatches");
    const dispatchBody = JSON.parse((dispatchCall[1] as RequestInit | undefined)?.body as string);
    expect(dispatchBody.event_type).toBe("open_code_review_trigger");
    expect(dispatchBody.client_payload.base_ref).toBe("main");
    expect(dispatchBody.client_payload.check_run_id).toBe(98765);
  });
  it("continues pull request fetch, check run creation and dispatch when reaction fails", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "Internal Server Error" }) // reaction fails
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ head: { sha: "abc123" }, base: { ref: "main" } }) }) // PR
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 98765 }) }) // create check run
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => "" }); // dispatch

    const body = JSON.stringify(basePayload);
    const request = createIssueCommentRequest(basePayload, await calculateSignature(env.WEBHOOK_SECRET, body));
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [reactionCall, prCall, checkRunCall, dispatchCall] = fetchMock.mock.calls;
    expect(reactionCall[0]).toContain("/issues/comments/123/reactions");
    expect(prCall[0]).toContain("/pulls/1");
    expect(checkRunCall[0]).toContain("/check-runs");
    expect(dispatchCall[0]).toContain("/dispatches");
    const dispatchBody = JSON.parse((dispatchCall[1] as RequestInit | undefined)?.body as string);
    expect(dispatchBody.client_payload.check_run_id).toBe(98765);
  });

  it("dispatches successfully when check run creation returns null", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 201, text: async () => "" }) // reaction
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ head: { sha: "abc123" }, base: { ref: "main" } }) }) // PR
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "Internal Server Error" }) // create check run fails
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => "" }); // dispatch

    const body = JSON.stringify(basePayload);
    const request = createIssueCommentRequest(basePayload, await calculateSignature(env.WEBHOOK_SECRET, body));
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [, , checkRunCall, dispatchCall] = fetchMock.mock.calls;
    expect(checkRunCall[0]).toBe("https://api.github.com/repos/owner/repo/check-runs");
    expect((checkRunCall[1] as RequestInit | undefined)?.method).toBe("POST");
    expect(dispatchCall[0]).toBe("https://api.github.com/repos/yohi/ocr-app/dispatches");
    const dispatchBody = JSON.parse((dispatchCall[1] as RequestInit | undefined)?.body as string);
    expect(dispatchBody.event_type).toBe("open_code_review_trigger");
    expect(dispatchBody.client_payload.check_run_id).toBeNull();
    expect(dispatchBody.client_payload.base_ref).toBe("main");
    expect(dispatchBody.client_payload.commit_sha).toBe("abc123");
  });

  it("returns 502 when pull request head.sha is empty", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 201, text: async () => "" }) // reaction
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ head: { sha: "" }, base: { ref: "main" } }),
      }); // PR with empty sha

    const body = JSON.stringify(basePayload);
    const request = createIssueCommentRequest(basePayload, await calculateSignature(env.WEBHOOK_SECRET, body));
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns 502 when pull request response is not valid JSON", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 201, text: async () => "" }) // reaction
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      }); // PR with invalid JSON

    const body = JSON.stringify(basePayload);
    const request = createIssueCommentRequest(basePayload, await calculateSignature(env.WEBHOOK_SECRET, body));
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("hasRequiredLabel", () => {
  it("returns true when default 'review' label is present", () => {
    expect(hasRequiredLabel([{ name: "review" }])).toBe(true);
    expect(hasRequiredLabel([{ name: "REVIEW" }])).toBe(true);
    expect(hasRequiredLabel([{ name: "bug" }, { name: "review" }])).toBe(true);
  });

  it("returns false when required label is not present", () => {
    expect(hasRequiredLabel(undefined)).toBe(false);
    expect(hasRequiredLabel([])).toBe(false);
    expect(hasRequiredLabel([{ name: "bug" }, { name: "feature" }])).toBe(false);
  });

  it("matches custom required label when specified", () => {
    expect(hasRequiredLabel([{ name: "opencode-review" }], "opencode-review")).toBe(true);
    expect(hasRequiredLabel([{ name: "OPENCODE-REVIEW" }], "opencode-review")).toBe(true);
    expect(hasRequiredLabel([{ name: "review" }], "opencode-review")).toBe(false);
  });
});

describe("pull_request opened flow", () => {
  const env = {
    GITHUB_APP_ID: "123",
    GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEA\n-----END PRIVATE KEY-----",
    WEBHOOK_SECRET: "test-secret",
    GITHUB_APP_SLUG: "opencodereview-app",
  };

  const basePayloadWithLabel = {
    action: "opened",
    number: 1,
    pull_request: {
      head: { sha: "abc123" },
      base: { ref: "main" },
      labels: [{ name: "review" }],
    },
    repository: { owner: { login: "owner" }, name: "repo" },
    installation: { id: 456 },
  };

  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches repository_dispatch when required label is present", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 98765 }) }) // create check run
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => "" }); // dispatch

    const body = JSON.stringify(basePayloadWithLabel);
    const signature = await calculateSignature(env.WEBHOOK_SECRET, body);
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "X-GitHub-Event": "pull_request",
        "X-Hub-Signature-256": signature,
        "Content-Type": "application/json",
      },
      body,
    });
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [checkRunCall, dispatchCall] = fetchMock.mock.calls;
    expect(checkRunCall[0]).toBe("https://api.github.com/repos/owner/repo/check-runs");
    expect((checkRunCall[1] as RequestInit | undefined)?.method).toBe("POST");
    expect((checkRunCall[1] as RequestInit | undefined)?.body).toContain("queued");
    expect(dispatchCall[0]).toBe("https://api.github.com/repos/yohi/ocr-app/dispatches");
    const dispatchBody = JSON.parse((dispatchCall[1] as RequestInit | undefined)?.body as string);
    expect(dispatchBody.event_type).toBe("open_code_review_trigger");
    expect(dispatchBody.client_payload.base_ref).toBe("main");
    expect(dispatchBody.client_payload.commit_sha).toBe("abc123");
    expect(dispatchBody.client_payload.check_run_id).toBe(98765);
  });

  it("skips dispatch when required label is not present", async () => {
    const payloadWithoutLabel = {
      ...basePayloadWithLabel,
      pull_request: {
        ...basePayloadWithLabel.pull_request,
        labels: [{ name: "other-label" }],
      },
    };

    const body = JSON.stringify(payloadWithoutLabel);
    const signature = await calculateSignature(env.WEBHOOK_SECRET, body);
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "X-GitHub-Event": "pull_request",
        "X-Hub-Signature-256": signature,
        "Content-Type": "application/json",
      },
      body,
    });
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("respects custom REQUIRED_LABEL environment variable", async () => {
    const customEnv = {
      ...env,
      REQUIRED_LABEL: "ocr-trigger",
    };

    const payloadWithCustomLabel = {
      ...basePayloadWithLabel,
      pull_request: {
        ...basePayloadWithLabel.pull_request,
        labels: [{ name: "ocr-trigger" }],
      },
    };

    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 98765 }) })
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => "" });

    const body = JSON.stringify(payloadWithCustomLabel);
    const signature = await calculateSignature(customEnv.WEBHOOK_SECRET, body);
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "X-GitHub-Event": "pull_request",
        "X-Hub-Signature-256": signature,
        "Content-Type": "application/json",
      },
      body,
    });
    const response = await worker.fetch(request, customEnv);
    expect(response.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
