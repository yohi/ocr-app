import { describe, it, expect } from "vitest";
import { isRecord, isIssueCommentPayload, isMentioningReviewer } from "./index";

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
      comment: { body: "@opencodereview-app review" },
      repository: { owner: { login: "owner" }, name: "repo" },
      installation: { id: 123 },
    };
    expect(isIssueCommentPayload(payload)).toBe(true);
  });

  it("returns false for missing fields", () => {
    expect(isIssueCommentPayload({})).toBe(false);
    expect(isIssueCommentPayload({ action: "created" })).toBe(false);
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

  it("is case-insensitive", () => {
    expect(isMentioningReviewer("opencodereview-app", "@OPENCODEREVIEW-APP REVIEW")).toBe(true);
  });

  it("escapes regex metacharacters in slug", () => {
    expect(isMentioningReviewer("review.app", "@review.app review")).toBe(true);
    expect(isMentioningReviewer("review.app", "@reviewXapp review")).toBe(false);
  });
});
