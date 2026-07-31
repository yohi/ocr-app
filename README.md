# OpenCodeReview GitHub App Backend (ocr-app)

このリポジトリは、Alibaba 製 AI コードレビューツール **OpenCodeReview (OCR)** を GitHub App (Zero-YAML 構成) として提供するための専用バックエンドリポジトリです。

## コンポーネント構造

- **`cloudflare-worker/`**: GitHub App からの Webhook を受信し、`repository_dispatch` を送る Cloudflare Worker (無料枠)
- **`.github/workflows/deploy-cloudflare-worker.yml`**: Cloudflare Worker 自動/手動デプロイ用ワークフロー
- **`.github/workflows/ocr-engine.yml`**: `repository_dispatch` を検知して対象 PR に `ocr review` を実行するワークフローエンジン
- **`.github/workflows/scripts/post-ocr-comments.js`**: レビュー結果を PR にインライン投稿するスクリプト

## セットアップ詳細

セットアップおよびドキュメント詳細は [OPEN_CODE_REVIEW_SETUP.md](https://github.com/yohi/.github/blob/master/docs/OPEN_CODE_REVIEW_SETUP.md) を参照してください。
