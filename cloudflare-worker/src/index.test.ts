import { describe, it, expect } from "vitest";
import { isRecord, isIssueCommentPayload } from "./index";

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

describe("mention pattern", () => {
  const SLUG = "opencodereview-app";
  const pattern = new RegExp(`@${SLUG}(?:\\[bot\\])?\\s+review`, "i");

  it("matches @opencodereview-app review", () => {
    expect(pattern.test("@opencodereview-app review")).toBe(true);
  });

  it("matches @opencodereview-app[bot] review", () => {
    expect(pattern.test("@opencodereview-app[bot] review")).toBe(true);
  });

  it("matches in middle of sentence", () => {
    expect(pattern.test("レビューお願いします @opencodereview-app review")).toBe(true);
  });

  it("does not match typos", () => {
    expect(pattern.test("@opencodereview-app summary")).toBe(false);
    expect(pattern.test("@other-bot review")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(pattern.test("@OPENCODEREVIEW-APP REVIEW")).toBe(true);
  });
});
