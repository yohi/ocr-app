# Richer No-Findings Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the OpenCodeReview Summary useful when a review completes with no findings by showing the result, coverage, elapsed time, and changed files.

**Architecture:** Reuse the existing Pull Request Files API data already fetched for inline comments. When there are no valid findings, fetch the changed files before creating the Summary; when findings exist, return the existing file map from the inline-posting path. Extend Summary rendering with typed review metadata and a sorted changed-file table without changing marker, upsert, fence, or length-limit behavior.

**Tech Stack:** Node.js ESM, Node built-in test runner, GitHub REST API.

## Global Constraints

- Preserve the existing `<!-- antigravity-ocr-summary -->` marker and bot-owned Summary upsert behavior.
- Preserve UTF-16 code-unit file sorting, dynamic Markdown fences, and the 65536-character body limit.
- Display only typed result data: `coverage` must be a finite number from 0 through 1, and `summary.elapsed` must be a string.
- Keep invalid-only results from posting a Summary.
- Write the failing test before production changes and run the focused test before the full test file.

---

### Task 1: Extend the no-findings Summary contract

**Files:**
- Modify: `.github/workflows/scripts/post-ocr-comments.test.mjs`
- Modify: `.github/workflows/scripts/post-ocr-comments.mjs`

**Interfaces:**
- `postReviewComments()` produces `{ exitCode, filesMap }`, where `filesMap` is the existing `Map<string, object>` returned by `fetchAllPrFiles()`.
- `postSummaryComment()` consumes `changedFiles` as an array of file paths and `reviewMetadata` with optional `coverage` and `elapsed` values.

- [ ] **Step 1: Write the failing test**

Add a changed-file response to the empty-result test and assert that the Summary contains `レビュー結果: 指摘なし`, `レビュー対象: 1 ファイル`, `カバレッジ: 80%`, `所要時間: 1s`, and `` `src/example.js` ``.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .github/workflows/scripts/post-ocr-comments.test.mjs --test-name-pattern="informative Summary"`

Expected: FAIL because the current Summary has no result, coverage, or changed-file section.

- [ ] **Step 3: Implement minimal data flow**

Extend Summary rendering with typed metadata and a sorted changed-file table. Return the PR file map from inline posting, and fetch it before Summary posting when the valid comment list is empty.

- [ ] **Step 4: Run focused test**

Run: `node --test .github/workflows/scripts/post-ocr-comments.test.mjs --test-name-pattern="informative Summary"`

Expected: PASS.

- [ ] **Step 5: Add and run the zero-changed-files assertion**

Assert `レビュー対象: 0 ファイル` and no fabricated filename for an empty PR Files API response, then run:

`node --test .github/workflows/scripts/post-ocr-comments.test.mjs --test-name-pattern="zero changed files"`

Expected: PASS.

- [ ] **Step 6: Run the complete script test file**

Run: `node --test .github/workflows/scripts/post-ocr-comments.test.mjs`

Expected: PASS with no failures. Update only fixtures whose request sequence changes because an empty result now fetches PR files before posting its Summary.
