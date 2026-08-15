#!/usr/bin/env bash
#
# sync-agy-credentials.sh
# ローカルの Antigravity / Gemini CLI (agy) 認証情報を GitHub Actions の Secrets / Variables に同期します。
#
set -euo pipefail

echo "==> Antigravity (agy) 認証情報の GitHub Actions 同期を開始します..."

# 1. gh CLI の存在確認
if ! command -v gh &> /dev/null; then
  echo "❌ [Error] GitHub CLI (gh) がインストールされていません。" >&2
  echo "   インストール手順: https://cli.github.com/" >&2
  exit 1
fi

# 2. gh 認証状態の確認
if ! gh auth status &> /dev/null; then
  echo "❌ [Error] GitHub CLI (gh) にログインしていません。" >&2
  echo "   以下のコマンドを実行して GitHub にログインしてください:" >&2
  echo "   $ gh auth login" >&2
  exit 1
fi

# 3. リポジトリへのアクセス権限確認
echo "--> リポジトリのアクセス権限を確認中..."
VIEWER_PERM=$(gh repo view --json viewerPermission --jq '.viewerPermission' 2>/dev/null || echo "UNKNOWN")
if [ "$VIEWER_PERM" != "ADMIN" ] && [ "$VIEWER_PERM" != "WRITE" ]; then
  echo "⚠️  [Warning] 現在ログインしているユーザーのリポジトリ権限: $VIEWER_PERM" >&2
  echo "   GitHub Actions Secrets を設定するにはリポジトリの管理者権限(ADMIN)が必要です。" >&2
  echo "   権限スコープが不足している場合は、以下を実行してスコープを更新してください:" >&2
  echo "   $ gh auth refresh -s repo" >&2
  echo ""
fi

# Secret 設定ヘルパー関数
set_github_secret() {
  local secret_name="$1"
  local secret_val="$2"

  if printf '%s' "$secret_val" | gh secret set "$secret_name" 2>/dev/null; then
    echo "    ✔ Secret '$secret_name' を更新しました。"
    return 0
  else
    echo "❌ [Error] Secret '$secret_name' の設定に失敗しました。" >&2
    echo "   - リポジトリの管理者権限があるか確認してください。" >&2
    echo "   - トークンの権限を更新する場合: $ gh auth refresh -s repo" >&2
    return 1
  fi
}

SUCCESS_COUNT=0

# 4. ANTIGRAVITY_OAUTH_JSON の同期
AGY_OAUTH_PATH=""
if [ -f "$HOME/.gemini/antigravity-cli/oauth.json" ]; then
  AGY_OAUTH_PATH="$HOME/.gemini/antigravity-cli/oauth.json"
elif [ -f "$HOME/.gemini/oauth.json" ]; then
  AGY_OAUTH_PATH="$HOME/.gemini/oauth.json"
fi

if [ -n "$AGY_OAUTH_PATH" ]; then
  echo "--> $AGY_OAUTH_PATH を Secret 'ANTIGRAVITY_OAUTH_JSON' として登録中..."
  CONTENT=$(cat "$AGY_OAUTH_PATH")
  if set_github_secret "ANTIGRAVITY_OAUTH_JSON" "$CONTENT"; then
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  fi
else
  echo "    ⚠ Antigravity OAuth ファイル ($HOME/.gemini/antigravity-cli/oauth.json) が見つかりませんでした (スキップ)"
fi

# 5. GEMINI_OAUTH_CREDS_B64 / GEMINI_GOOGLE_ACCOUNTS_B64 の同期 (存在する場合)
if [ -f "$HOME/.gemini/oauth_creds.json" ]; then
  echo "--> $HOME/.gemini/oauth_creds.json を Secret 'GEMINI_OAUTH_CREDS_B64' として登録中..."
  B64_CONTENT=$(base64 -w 0 "$HOME/.gemini/oauth_creds.json")
  if set_github_secret "GEMINI_OAUTH_CREDS_B64" "$B64_CONTENT"; then
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  fi
fi

if [ -f "$HOME/.gemini/google_accounts.json" ]; then
  echo "--> $HOME/.gemini/google_accounts.json を Secret 'GEMINI_GOOGLE_ACCOUNTS_B64' として登録中..."
  B64_CONTENT=$(base64 -w 0 "$HOME/.gemini/google_accounts.json")
  if set_github_secret "GEMINI_GOOGLE_ACCOUNTS_B64" "$B64_CONTENT"; then
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  fi
fi

echo ""
if [ "$SUCCESS_COUNT" -gt 0 ]; then
  echo "==> 完了: $SUCCESS_COUNT 件の認証情報を GitHub Actions Secrets に正常に設定しました。"
else
  echo "==> 警告: 対象の認証情報ファイルが見つかりませんでした。"
  echo "    ~/.gemini/ 配下に agy の認証情報が存在するか確認してください。"
fi
