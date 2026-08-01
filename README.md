# OpenCodeReview GitHub App Backend (ocr-app)

このリポジトリは、Alibaba 製 AI コードレビューツール **OpenCodeReview (OCR)** を
GitHub App (Zero-YAML 構成) として提供するための専用バックエンドリポジトリです。

## コンポーネント構造

- **`cloudflare-worker/`**: GitHub App からの Webhook を受信し、
  `repository_dispatch` を送る Cloudflare Worker (無料枠)
- **`.github/workflows/deploy-cloudflare-worker.yml`**: Cloudflare Worker 自動/手動デプロイ用ワークフロー
- **`.github/workflows/ocr-engine.yml`**: `repository_dispatch` を検知して対象 PR に
  `ocr review` を実行するワークフローエンジン
- **`.github/workflows/scripts/post-ocr-comments.js`**: レビュー結果を PR にインライン投稿するスクリプト

## Cloudflare Worker 設定契約

### 環境変数

| 環境変数 | 必須 | 説明 |
| --- | --- | --- |
| `GITHUB_APP_ID` | はい | GitHub App の ID |
| `GITHUB_APP_PRIVATE_KEY` | はい | GitHub App の秘密鍵 |
| `WEBHOOK_SECRET` | はい | Webhook 署名検証用シークレット |
| `TARGET_DISPATCH_REPO` | いいえ | dispatch 先リポジトリ。未設定時は `yohi/.github` |

### Webhook と GitHub App

| 項目 | 値・要件 |
| --- | --- |
| Webhook の `Content-Type` | `application/json` |
| Webhook event | `pull_request`（`ping` も受信可） |
| 署名検証 | `X-Hub-Signature-256` ヘッダー（`sha256=<64桁の16進数>`） |
| 送信イベント種別 | `open_code_review_trigger` |
| GitHub App 権限（dispatch 先） | `TARGET_DISPATCH_REPO` の `Contents: write` |

> **注意**: Webhook の Secret と Worker の環境変数 `WEBHOOK_SECRET` には必ず同じ値を設定してください。

## セットアップ詳細

セットアップおよびドキュメント詳細は [OPEN_CODE_REVIEW_SETUP.md][setup-doc] を参照してください。

[setup-doc]:
  https://github.com/yohi/.github/blob/master/docs/OPEN_CODE_REVIEW_SETUP.md
