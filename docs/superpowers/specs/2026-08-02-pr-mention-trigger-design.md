# PR Mention Trigger 設計書

## 概要

CodeRabbit のように、PR コメントに `@opencodereview-app review` とメンションすることで、オンデマンドでコードレビュー（OCR）を実行できる機能を追加する。

## 現状のフロー

```
pull_request webhook (opened/synchronize/reopened)
  → Cloudflare Worker
    → repository_dispatch (open_code_review_trigger)
      → ocr-engine.yml
        → ocr review
          → post-ocr-comments.mjs
```

## 変更後のフロー

```
issue_comment webhook (created)
  → Cloudflare Worker
    → repository_dispatch (open_code_review_trigger)
      → ocr-engine.yml
        → ocr review
          → post-ocr-comments.mjs
```

## 目標

- PR コメントで `@opencodereview-app review` と入力するとレビューが実行される
- 既存の `ocr-engine.yml` ワークフローと `post-ocr-comments.mjs` をそのまま再利用する
- 追加コマンドは `review` のみ（将来の拡張は別途検討）

## アーキテクチャ

### 変更対象

| ファイル | 変更内容 |
|---|---|
| `cloudflare-worker/src/index.ts` | `issue_comment` イベントハンドラ追加 |
| `cloudflare-worker/wrangler.toml` | 環境変数定義欄に `GITHUB_APP_SLUG` を追加 |
| `.github/workflows/deploy-cloudflare-worker.yml` | `GITHUB_APP_SLUG` を vars として注入 |

### 新規追加なし

- `ocr-engine.yml`
- `post-ocr-comments.mjs`

## コンポーネント詳細

### Cloudflare Worker (`index.ts`)

#### 受信イベント

`issue_comment` イベントを新規受信する。

- `action === "created"` のみ処理
- `issue.pull_request` が存在することを確認（PR に紐づくコメントのみ）

#### Mention 検出

コメント本文から以下の正規表現でメンションを検出する：

```typescript
/@opencodereview-app(?:\[bot\])?\s+review/i
```

#### commit_sha の取得

`issue_comment` の payload には `commit_sha` が含まれないため、GitHub API で取得する。

```
GET /repos/{owner}/{repo}/pulls/{number}
→ response.pull_request.head.sha
```

GitHub App token を使って認証し、API を呼び出す。

#### repository_dispatch の送信

`commit_sha` を取得後、既存と同じ payload で `repository_dispatch` を送信する。

```json
{
  "event_type": "open_code_review_trigger",
  "client_payload": {
    "target_repo": "{owner}/{repo}",
    "pr_number": "{number}",
    "commit_sha": "{head.sha}",
    "installation_id": "{installation.id}"
  }
}
```

### 環境変数

| 環境変数 | 必須 | 説明 |
|---|---|---|
| `GITHUB_APP_SLUG` | はい | GitHub App の slug。mention 検出に使用。値: `opencodereview-app` |

### GitHub App Webhook 設定

GitHub App の Webhook イベントに **Issue comment** を追加する（1 回のみの手動設定）。

## セキュリティ

- Webhook 署名検証は既存の `WEBHOOK_SECRET` で継続
- GitHub App のインストール範囲外のリポジトリでは動作しない
- `issue_comment` の `created` アクションのみを処理し、編集・削除は無視

## テスト

### Worker 単体テスト（今後の検討事項）

- `@opencodereview-app review` を含むコメント → dispatch 実行
- `@opencodereview-app[bot] review` を含むコメント → dispatch 実行
- `@opencodereview-app summary` → 無視
- 通常の PR コメント → 無視
- Issue（PR ではない）コメント → 無視

## デプロイ手順

1. GitHub App の Webhook 設定で **Issue comment** イベントを有効化
2. `deploy-cloudflare-worker.yml` を実行して Worker をデプロイ
3. 動作確認：PR コメントで `@opencodereview-app review` を入力

## 制約・注意事項

- `issue_comment` の処理で追加の GitHub API コールが発生する（Rate limit に注意）
- 同じ PR で連続して mention した場合、複数回のレビューが実行される
- GitHub App の slug を変更した場合、`GITHUB_APP_SLUG` 環境変数の更新が必要
