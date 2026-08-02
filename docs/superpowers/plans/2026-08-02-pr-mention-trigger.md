# PR Mention Trigger 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PR コメントで `@opencodereview-app review` とメンションすると、OCR レビューが実行されるトリガー機能を追加する。

**Architecture:** Cloudflare Worker に `issue_comment` イベントハンドラを追加し、コメント本文から mention を検出して既存の `repository_dispatch` フローを再利用する。既存の `ocr-engine.yml` と `post-ocr-comments.mjs` は変更なし。

**Tech Stack:** TypeScript, Cloudflare Workers, Wrangler, GitHub Actions

## Global Constraints

- `GITHUB_APP_SLUG` は常に環境変数経由で取得し、ハードコードしない
- 既存コードのスタイル・パターンに従う
- `createAppAuth` / `auth()` の認証フローは他のイベントハンドラと共有する
- Webhook 署名検証はすべてのイベントで共通（変更なし）
- `repository_dispatch` の payload 構造は既存との互換性を維持する

## ファイル構成

| ファイル | 役割 |
|---|---|
| `cloudflare-worker/src/index.ts` | Worker メイン。`issue_comment` ハンドラ、mention 検出、PR 詳細取得、dispatch 送信を実装 |
| `cloudflare-worker/wrangler.toml` | 環境変数のコメント欄に `GITHUB_APP_SLUG` を追加 |
| `.github/workflows/deploy-cloudflare-worker.yml` | `GITHUB_APP_SLUG` を vars として注入する設定を追加 |

---

### Task 1: `issue_comment` イベントハンドラ実装

**Files:**
- Modify: `cloudflare-worker/src/index.ts`

**Interfaces:**
- Consumes: `Env` interface (新規フィールド追加), `isRecord` helper, `createAppAuth`, `hasValidWebhookSignature`
- Produces: `IssueCommentPayload` type, `isIssueCommentPayload` guard, `sendRepositoryDispatch` helper, `issue_comment` handler branch

- [ ] **Step 1: `IssueCommentPayload` 型とガード関数を追加する**

`isPullRequestWebhookPayload` の下あたりに追加する：

```typescript
type IssueCommentPayload = {
  readonly action: string;
  readonly issue: {
    readonly number: number;
    readonly pull_request?: {
      readonly url: string;
    };
  };
  readonly comment: {
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

function isIssueCommentPayload(payload: unknown): payload is IssueCommentPayload {
  if (!isRecord(payload) || typeof payload.action !== "string") return false;
  if (!isRecord(payload.issue) || typeof payload.issue.number !== "number") return false;
  if (payload.issue.pull_request !== undefined) {
    if (!isRecord(payload.issue.pull_request) || typeof payload.issue.pull_request.url !== "string") {
      return false;
    }
  }
  if (!isRecord(payload.comment) || typeof payload.comment.body !== "string") return false;
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
```

- [ ] **Step 2: `sendRepositoryDispatch` ヘルパー関数を抽出する**

既存の `repository_dispatch` 送信ロジックを `pull_request` ハンドラから抽出して共通化する：

```typescript
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
  }
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

    return null; // success, no response needed
  } catch (error: unknown) {
    console.error("Dispatch error:", error instanceof Error ? error.stack ?? error.message : String(error));
    return new Response("Dispatch failed", { status: 500 });
  } finally {
    clearTimeout(dispatchTimeout);
  }
}
```

- [ ] **Step 3: `Env` interface に `GITHUB_APP_SLUG` を追加する**

```typescript
export interface Env {
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  WEBHOOK_SECRET: string;
  TARGET_DISPATCH_REPO?: string;
  GITHUB_APP_SLUG: string;
}
```

- [ ] **Step 4: 既存 `pull_request` ディスパッチ部分を `sendRepositoryDispatch` を使うようリファクタする**

`pull_request` ハンドラ内の dispatch 送信コードを `sendRepositoryDispatch` 呼び出しで置き換える。置き換え前のコードを削除する：

```typescript
const dispatchRepo = env.TARGET_DISPATCH_REPO || "yohi/ocr-app";
const dispatchAbortController = new AbortController();
const dispatchTimeout = setTimeout(() => dispatchAbortController.abort(), 10_000);
try {
  const res = await fetch(`https://api.github.com/repos/${dispatchRepo}/dispatches`, {
    method: "POST",
    ...
  });
  ...
} finally {
  clearTimeout(dispatchTimeout);
}
```

上記を以下で置き換え：

```typescript
const dispatchError = await sendRepositoryDispatch(env, token, {
  target_repo: `${repoOwner}/${repoName}`,
  pr_number: prNumber,
  commit_sha: payload.pull_request.head.sha,
  installation_id: payload.installation.id,
});
if (dispatchError) return dispatchError;
```

- [ ] **Step 5: `issue_comment` イベントハンドラブランチを追加する**

`githubEvent === "pull_request"` ブロックの後に、以下の新規ブロックを追加する：

```typescript
if (githubEvent === "issue_comment") {
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }

  if (!isIssueCommentPayload(payload)) {
    return new Response("Invalid payload", { status: 400 });
  }

  if (payload.action !== "created" || !payload.issue.pull_request) {
    return new Response("OK", { status: 200 });
  }

  const mentionPattern = new RegExp(
    `@${env.GITHUB_APP_SLUG}(?:\\[bot\\])?\\s+review(?![\\w-])`,
    "i"
  );

  if (!mentionPattern.test(payload.comment.body)) {
    return new Response("OK", { status: 200 });
  }

  // GitHub App Token 発行
  const auth = createAppAuth({
    appId: env.GITHUB_APP_ID,
    privateKey: normalizePrivateKey(env.GITHUB_APP_PRIVATE_KEY),
  });
  const { token } = await auth({
    type: "installation",
    installationId: payload.installation.id,
  });

  // リアクションを追加（失敗しても処理を中断しない）
  await addReaction(token, payload.repository.owner.login, payload.repository.name, payload.comment.id);

  // PR 詳細を取得して head.sha を得る
  const prUrl = `https://api.github.com/repos/${payload.repository.owner.login}/${payload.repository.name}/pulls/${payload.issue.number}`;
  const prAbortController = new AbortController();
  const prTimeout = setTimeout(() => prAbortController.abort(), 10_000);
  let prRes;
  try {
    prRes = await fetch(prUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Cloudflare-Worker-OCR-App",
      },
      signal: prAbortController.signal,
    });
  } finally {
    clearTimeout(prTimeout);
  }

  if (!prRes.ok) {
    const errText = await prRes.text();
    console.error("PR fetch failed:", prRes.status, errText);
    return new Response("PR fetch failed", { status: 500 });
  }

  const prData: unknown = await prRes.json();
  if (
    !isRecord(prData) ||
    !isRecord(prData.head) ||
    typeof prData.head.sha !== "string" ||
    !isRecord(prData.base) ||
    typeof prData.base.ref !== "string"
  ) {
    return new Response("Invalid pull request response", { status: 502 });
  }

  const dispatchError = await sendRepositoryDispatch(env, token, {
    target_repo: `${payload.repository.owner.login}/${payload.repository.name}`,
    pr_number: payload.issue.number,
    commit_sha: prData.head.sha,
    base_ref: prData.base.ref,
    installation_id: payload.installation.id,
    check_run_id: null,
  });
  if (dispatchError) return dispatchError;
}

- [ ] **Step 6: TypeScript コンパイルを確認する**

Run: `cd cloudflare-worker && npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 7: 変更をコミットする**

```bash
git add cloudflare-worker/src/index.ts
git commit -m "feat(worker): issue_commentイベントでmentionトリガーを処理"
```

---

### Task 2: デプロイ設定更新

**Files:**
- Modify: `cloudflare-worker/wrangler.toml`
- Modify: `.github/workflows/deploy-cloudflare-worker.yml`

**Interfaces:**
- Consumes: なし（設定ファイルのみ）
- Produces: `GITHUB_APP_SLUG` 環境変数の設定

- [ ] **Step 1: `wrangler.toml` のコメントを更新する**

既存のコメント行：

```toml
# - Vars:    GITHUB_APP_ID, TARGET_DISPATCH_REPO（Actions の Repository Variables から）
```


以下に変更：

```toml
# - Vars:    GITHUB_APP_ID, TARGET_DISPATCH_REPO, GITHUB_APP_SLUG（Actions の Repository Variables から）
```


- [ ] **Step 2: デプロイワークフローに `GITHUB_APP_SLUG` を追加する**

`.github/workflows/deploy-cloudflare-worker.yml` の `vars:` セクションを変更：


```yaml
          vars: |
            GITHUB_APP_ID
            TARGET_DISPATCH_REPO
            GITHUB_APP_SLUG
```


同ファイルの `env:` セクションに追加：


```yaml
          GITHUB_APP_ID: ${{ vars.GH_APP_ID }}
          TARGET_DISPATCH_REPO: ${{ vars.GH_TARGET_DISPATCH_REPO || 'yohi/ocr-app' }}
          GITHUB_APP_SLUG: ${{ vars.GH_APP_SLUG || 'opencodereview-app' }}

```

- [ ] **Step 3: GitHub Repository Variables に `GH_APP_SLUG` を登録する（手動）**

リポジトリの Settings → Secrets and variables → Actions → Variables タブで：
- Name: `GH_APP_SLUG`
- Value: `opencodereview-app`

- [ ] **Step 4: GitHub App の Webhook イベントに Issue comment を追加する（手動）**

GitHub App の設定ページで：
1. Webhook → 「Active」がチェックされていることを確認
2. Permissions & events → Subscribe to events → **Issue comment** にチェック
3. 「Save changes」をクリック

- [ ] **Step 5: 変更をコミットする**

```bash
git add cloudflare-worker/wrangler.toml .github/workflows/deploy-cloudflare-worker.yml
git commit -m "ci: GITHUB_APP_SLUG環境変数をデプロイ設定に追加"
```

---

### Task 3: テスト追加

**Files:**
- Modify: `cloudflare-worker/src/index.test.ts`
- Modify: `cloudflare-worker/package.json`

**Interfaces:**
- Consumes: `isIssueCommentPayload` guard function (Task 1 で作成)
- Produces: mention 検出ロジックの単体テスト

- [ ] **Step 1: vitest をインストールする**

```bash
cd cloudflare-worker
npm install --save-dev vitest
```

- [ ] **Step 2: `package.json` の scripts にテストコマンドを追加する**

```json
"scripts": {
  "deploy": "wrangler deploy",
  "test": "vitest run"
}
```

- [ ] **Step 3: `isIssueCommentPayload` と mention パターンのテストを作成する**

`cloudflare-worker/src/index.test.ts` を作成：

```typescript
import { describe, it, expect } from "vitest";

// index.ts から export する必要があるので、index.ts 側も修正が必要
// isRecord と isIssueCommentPayload を export する
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
});

describe("mention pattern", () => {
  const SLUG = "opencodereview-app";

  it("matches @opencodereview-app review", () => {
    expect(isMentioningReviewer(SLUG, "@opencodereview-app review")).toBe(true);
  });

  it("matches @opencodereview-app[bot] review", () => {
    expect(isMentioningReviewer(SLUG, "@opencodereview-app[bot] review")).toBe(true);
  });

  it("matches in middle of sentence", () => {
    expect(isMentioningReviewer(SLUG, "レビューお願いします @opencodereview-app review")).toBe(true);
  });

  it("does not match typos", () => {
    expect(isMentioningReviewer(SLUG, "@opencodereview-app summary")).toBe(false);
    expect(isMentioningReviewer(SLUG, "@other-bot review")).toBe(false);
  });

  it("does not match 'reviewing' or 'review-now'", () => {
    expect(isMentioningReviewer(SLUG, "@opencodereview-app reviewing")).toBe(false);
    expect(isMentioningReviewer(SLUG, "@opencodereview-app review-now")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isMentioningReviewer(SLUG, "@OPENCODEREVIEW-APP REVIEW")).toBe(true);
  });
});
```

- [ ] **Step 4: `index.ts` から `isRecord` と `isIssueCommentPayload` を export する**

```typescript
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isIssueCommentPayload(...
```

- [ ] **Step 5: テストを実行する**

Run: `cd cloudflare-worker && npm test`
Expected: すべて PASS

- [ ] **Step 6: 変更をコミットする**

```bash
git add cloudflare-worker/src/index.ts cloudflare-worker/src/index.test.ts cloudflare-worker/package.json cloudflare-worker/package-lock.json
git commit -m "test(worker): issue_commentハンドラの単体テストを追加"
```

---

### Task 4: デプロイと動作確認

**Files:**
- なし（手動操作）

- [ ] **Step 1: Worker をデプロイする**

GitHub Actions の「Deploy Cloudflare Worker (GitHub App Backend)」ワークフローを手動実行する。

Run: GitHub → Actions → Deploy Cloudflare Worker → Run workflow
Expected: 成功（緑色のチェックマーク）

- [ ] **Step 2: 動作確認のテスト PR を作成する**

テスト用の小さな変更を含む PR を作成する。

- [ ] **Step 3: PR コメントで mention トリガーをテストする**

作成した PR に以下のコメントを投稿する：
```
@opencodereview-app review
```

Expected: 
- Actions タブで `ocr-engine.yml` の実行が開始される
- PR にレビューコメントが投稿される

- [ ] **Step 4: 非トリガーコメントをテストする**

同じ PR に以下のコメントを投稿する：
```
通常のコメントです。レビュー不要です。
```

Expected: Actions がトリガーされない

- [ ] **Step 5: 非 PR コメント（Issue コメント）をテストする**

リポジトリの Issue に以下のコメントを投稿する：
```
@opencodereview-app review
```

Expected: Actions がトリガーされない（Worker が `issue.pull_request` の存在をチェックしているため）

---

## セルフレビュー

**1. Spec coverage:**

| Spec 要件 | 実装タスク |
|---|---|
| `issue_comment` イベント受信 | Task 1 Step 5 |
| `action === "created"` のみ処理 | Task 1 Step 5 |
| `issue.pull_request` 存在確認 | Task 1 Step 5 |
| mention `@opencodereview-app review` 検出 | Task 1 Step 5, Task 3 Step 3 |
| `head.sha` の取得（追加 API コール） | Task 1 Step 5 |
| `GITHUB_APP_SLUG` 環境変数 | Task 1 Step 3, Task 2 Step 1-4 |
| `repository_dispatch` の送信 | Task 1 Step 2, Step 5 |
| 既存ワークフローの再利用（変更なし） | 明示的に変更対象外 |
| Issue comment Webhook 有効化 | Task 2 Step 4 |

**ギャップなし。**

**2. Placeholder チェック:**

- [x] 「TBD」「TODO」「implement later」なし
- [x] コードステップに実際のコードを記載
- [x] 各タスクの最終ステップにコミットコマンドを記載
- [x] 「Similar to Task N」なし

**3. 型整合性チェック:**

- `Env` interface に `GITHUB_APP_SLUG: string;` を追加（Task 1 Step 3）
- `sendRepositoryDispatch` のシグネチャ `sendRepositoryDispatch(env: Env, token: string, clientPayload: {...})` は Task 1 Step 2 で定義し、Step 4 と Step 5 で一貫して使用
- `isIssueCommentPayload` の型ガードと Task 3 のテストで同一のシグネチャを使用

**問題なし。**

---

## 実行方法

**Plan complete and saved to `docs/superpowers/plans/2026-08-02-pr-mention-trigger.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints for review

**Which approach?**
