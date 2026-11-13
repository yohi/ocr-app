# OCR App — Google AI Pro / Gemini 4 Hydrogen 対応

基準日: 2026-11-13（JST）

## Human Ownerの追加採択（2026-11-13）

- **採用する規定モデルは `gemini-4-hydrogen-medium`**。低負荷レビューと通常レビューに優先利用し、より高い推論深度が必要な実証ではHighを候補にする。
- **採用するagy CLIバージョンは `1.5.8`**。公式Linux x64アーカイブSHAは下記固定値を利用する。
- PR #144では既存レビューワークフローに `OCR_AGY_158_ENABLE` 切替機構を実装。新構成の実行には固定済みv1.5.8実行ファイルSHA、対応する新CLIインベントリ、認定済みHydrogen、認定Index更新の四点を必須とする。満たさなければFail-Closed。**既定の値は`false`で、masterの既存レビューは停止しない。**
- 新構成を有効にした場合は`OCR_LLM_MODEL`の旧設定よりもHydrogen Mediumを優先し、明示的に`agentMode=""`・`toolPermission=strict`・deny-allツール設定を使用する。
- 変更の目的は本番切替の実装と安全な移行の完成であり、証拠のないモデルを`certified`と偽装しない。現時点では実運用開始前の証拠取得が残っている。


### ユーザー観測に基づく暫定インベントリ

- `routing-evidence/pro-cli-inventory-20261113.json` に、2026-11-13のユーザー実機で観測した **agy 1.5.8 / 18モデル / SHA-256 `9db59b6371107b939befa9c507c0a24989fda974e75d81d8529f3689ef7322e5`** を記録した。
- `observed_at` は提示された端末時刻から `2026-11-13T06:54:37.000Z` に換算。`expires_at` は暫定の7日有効期限であり、稼働保証ではない。
- このファイルは **Owner観測によるstaged candidate** であり、公式アーカイブからのバイナリ一致確認、Actions OAuth実推論、モデル認定承認を意味しない。
- 既存の `review-certification-index.json` とモデル認定ファイルは変更しない。CLI 1.5.1に結び付いた旧認定を新SHAへ流用せず、将来の実証・認定が完了するまで本番切替は拒否する。

### 残っている必須証拠

1. **Human Ownerのローカルで観測した実行ファイルSHA-256: \`9db59b6371107b939befa9c507c0a24989fda974e75d81d8529f3689ef7322e5\`（2026-11-13 16:37 JST）**を候補ピンとして固定済み。CLI v1.5.8のリリース・アーカイブSHAは公式確認済みだが、この作業環境からアーカイブ本体の取得ができず、**公式アーカイブ内バイナリとの一致は未検証**。GitHub Actionsのインストーラが両SHAを検証し、一方でも不一致なら実行を拒否する。
2. GitHub ActionsのOAuth環境でHydrogen Mediumの実推論成功（スモーク実行はQuotaを消費するためOwnerが手動で選択する）。
3. `pro-cli-inventory-20261113.json`の実測CLI SHAを固定してインデックスのDigestを更新し、Hydrogen Mediumのモデル証拠・認定Referenceを新CLIと一致させる。
4. `review-model-catalog.json`のFast規定モデル、対応モデルの認定と新しいCLIインベントリ・Owner承認の一致。既存`enforce`については新しいCatalog/Source digestの認可が必要。
5. PR #144ではSonarCloud Security Rating Cが観測されており、個別指摘が未特定。この状態でマージ可能とは主張しない。

これらが揃う前に`OCR_AGY_158_ENABLE=true`を設定すると、CLIインストール前の検証で拒否される。バイナリSHAは `9db59b6371107b939befa9c507c0a24989fda974e75d81d8529f3689ef7322e5` に固定した。ユーザーから追加のSHA設定は不要。公式バイナリと実測SHAの一致はCIインストーラがFail-Closedで検証する。

## 目的と確定済みの事実

- 2026-11-13にHuman Ownerのローカル環境で `agy --version` = `1.5.8`、`agy models` = **18件**（既存13件 + Hydrogen Low/Medium/High/XHigh + Orchestrator）を観測。Carbonは表示されなかった。これは**実モデル一覧の観測証拠**であり、Hydrogenの推論成功やGitHub Actions内のOAuth同等性を証明しない。
- 公開リリースノートはAPIキー／ADC／Enterprise Gateway向けHydrogen対応を明記している。Human Ownerのローカル一覧からHydrogenが表示されることは確認できたが、**GitHub Actionsに保存された `ANTIGRAVITY_OAUTH_JSON` で同じ一覧が取得できるか**は未検証。CarbonはPro対象外。
- agy CLI v1.5.8の公式Linux x64アーカイブSHA-256:
  `905d4accfbd61bc00bee84bfaf24c59b85d334cabd786cf99237b66cfe06ab98`
- `agy models` にHydrogen 4件が表示されることはローカルで確認済み。**Hydrogenの実際の推論成功、利用枠、レビュー品質、GitHub Actions内のOAuth表示**は未検証。
- OCR App本番はCLI v1.5.1、固定モデル13件、Decision LLM opt-in、既存の固定SHA/認可/監査を維持する（GPT-OSSを通常Fallbackからのみ除外）。
- GPT-OSS 120Bは2026-11-18に廃止予定。**Deepの通常Fallbackからは事前除外**し、選択順を `claude-opus-5-5-high → gemini-4-argon-high → claude-sonnet-5-5-high` に短縮した。既存の固定CLIインベントリの13モデルと認定記録自体はバイト単位で維持する。

根拠:
- https://antigravity.google/docs/models
- https://github.com/google-antigravity/antigravity-cli/releases/tag/1.5.8
- https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-hydrogen/

## 実装した準備

- `.github/workflows/config/google-ai-pro-hydrogen-probe.json` にGoogle AI ProのHydrogen候補4件（Low/Medium/High/XHigh）とCarbon除外を固定。
- `.github/workflows/scripts/agy-google-ai-pro-model-probe.mjs` で、ログイン済み`agy --output-format json models`の構造化応答を読み、Hydrogenと現行の既知モデルID**だけ**を比較する。
- `.github/workflows/agy-google-ai-pro-model-probe.yml` は手動起動専用。公式アーカイブをSHA検証して取り出したCLI v1.5.8の実行ファイルSHAを計算し、既存の`ANTIGRAVITY_OAUTH_JSON`でモデル一覧を取得する。既定の `run_hydrogen_smoke=false` では推論しない。**Ownerが`run_hydrogen_smoke=true`を指定した場合に限り**、既存OAuthでHydrogen Medium/Highを各1回だけヘッドレス推論し、成功/失敗だけを安全に報告する（Google AI Proの利用枠を消費する）。
- GitHub Actions Step Summaryには固定されたIDのLISTED/NOT_LISTEDと検証済みハッシュだけを書き込む。OAuth、自由形式のCLIエラー、raw JSONは投稿・Artifact化しない。

## 実行方法（Human Ownerが判断して実施）

このPRを採用した場合、masterにマージ後、GitHub Actionsで **OCR App Google AI Pro model compatibility probe** の **Run workflow** を明示的に実行する。**本番レビューは起動しない**。既定の `run_hydrogen_smoke=false` はSHAとモデル一覧だけ。`true` を選択するとモデル一覧の成功後に Medium / High の固定プロンプトを各1回（最大2回）実行し、失敗時は後続を停止する。

結果の解釈:

- `LISTED` は**OAuthアカウントのCLI一覧に表示された**という意味のみ。実際のモデル推論、利用枠残量、レビュー品質、モデル承認を意味しない。
- `NOT_LISTED` は現行のOAuth認証情報では確認できないことを示す。自動的にGoogleのモデルを有効化しない。
- `AGY_OAUTH_SECRET_NOT_CONFIGURED` は実OAuth未検証。エラーやレート制限とは混同しない。
- `AGY_OAUTH_MODEL_LIST_COMMAND_FAILED` は一覧取得失敗。生のstderrは公開しない。
- `INFERENCE_PASS` は固定プロンプトに対する実行成功。コードレビュー品質・利用枠量・全モデルの利用可能性を示さない。
- `INFERENCE_FAILED` はスモークテスト失敗。CLIの生の応答・stderr・OAuthは公開しない。推論を明示要求しても該当モデルが表示されなければFail-Closedで失敗とする。

## 将来の適用判断（自動開始禁止）

ローカルモデル一覧は既に確認できたため、次の実質的な必要条件は **(a) GitHub Actions OAuthでも同じモデルが見える、(b) OAuthでHydrogen Medium/Highの実推論が成功する、(c) v1.5.8のバイナリSHAを実測しヘッドレスの権限境界が保たれる、(d) 固定インベントリ・承認・監査を新バージョンに整合させる** こと。実行・レビュー品質を確認できたモデルだけ、Human Ownerの判断で有効化する。

- 規定Fastモデルの確定候補: `gemini-4-hydrogen-medium`
- Deep候補: `gemini-4-hydrogen-high`
- 新規定モデル: `gemini-4-hydrogen-medium`を採択（実運用開始までは従来の`gemini-3.8-flash-medium`を維持）。
- CarbonはGoogle AI Proで利用不可なので採用しない。
- Hydrogenが利用可能でも、専用利用枠が存在するとは確認できない。既存のFlashを最終Fallbackとして維持し、独立枠を前提にしない。

実機検証なしで`certification_status=certified`にすることや、テストが存在するだけで本番モデルを切り替えることは禁止。スモークテストはOwnerのQuota消費承認なしに自動実行しない。実行前に `--mode plan` と `toolPermission=strict`、禁止権限でツール操作を抑止する。追加レビューの自動起票や認定期限の再設定も行わない。

## 完了条件

このPRでは、廃止予定モデルをDeep通常Fallbackから除外し、機密情報を漏らさずOAuth利用可能モデル・CLIハッシュを取得し、Ownerが選択した場合のみHydrogen Medium/Highを最大2回推論する経路までを完成とする。Actions OAuth実証・実際のHydrogen推論・本番移行は**未実施**。本PR作業はここで終了可能。
