# OCR App — Google AI Pro / Gemini 4 Hydrogen 対応

基準日: 2026-11-13（JST）

## 目的と確定済みの事実

- Google公式: Google AI ProはGemini 4 Hydrogenを利用可能。CarbonはPro対象外。Argonは有料Proまたは対象デバイストライアルに限る。
- agy CLI v1.5.8の公式Linux x64アーカイブSHA-256:
  `905d4accfbd61bc00bee84bfaf24c59b85d334cabd786cf99237b66cfe06ab98`
- Google AI ProのAntigravity OAuthで実際に`agy models`が返す内容と、Hydrogenの実行可否は**未検証**。
- OCR App本番はCLI v1.5.1、固定モデル13件、Decision LLM opt-in、既存の固定SHA/認可/監査を維持する。
- GPT-OSS 120Bは2026-11-18に廃止予定。既存Deep Fallbackへの影響は未解消として記録する。

根拠:
- https://antigravity.google/docs/models
- https://github.com/google-antigravity/antigravity-cli/releases/tag/1.5.8
- https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-hydrogen/

## 実装した準備

- `.github/workflows/config/google-ai-pro-hydrogen-probe.json` にGoogle AI ProのHydrogen候補4件（Low/Medium/High/XHigh）とCarbon除外を固定。
- `.github/workflows/scripts/agy-google-ai-pro-model-probe.mjs` で、ログイン済み`agy --output-format json models`の構造化応答を読み、Hydrogenと現行の既知モデルID**だけ**を比較する。
- `.github/workflows/agy-google-ai-pro-model-probe.yml` は手動起動専用。公式アーカイブをSHA検証して取り出したCLI v1.5.8の実行ファイルSHAを計算し、既存の`ANTIGRAVITY_OAUTH_JSON`でモデル一覧を取得する（推論・レビュー処理は行わない）。
- GitHub Actions Step Summaryには固定されたIDのLISTED/NOT_LISTEDと検証済みハッシュだけを書き込む。OAuth、自由形式のCLIエラー、raw JSONは投稿・Artifact化しない。

## 実行方法（Human Ownerが判断して実施）

このPRを採用した場合、masterにマージ後、GitHub Actionsで **OCR App Google AI Pro model compatibility probe** の **Run workflow** を明示的に実行する。通常のOCR Appレビューは起動しない。

結果の解釈:

- `LISTED` は**OAuthアカウントのCLI一覧に表示された**という意味のみ。実際のモデル推論、利用枠残量、レビュー品質、モデル承認を意味しない。
- `NOT_LISTED` は現行のOAuth認証情報では確認できないことを示す。自動的にGoogleのモデルを有効化しない。
- `AGY_OAUTH_SECRET_NOT_CONFIGURED` は実OAuth未検証。エラーやレート制限とは混同しない。
- `AGY_OAUTH_MODEL_LIST_COMMAND_FAILED` は一覧取得失敗。生のstderrは公開しない。

## 将来の適用判断（自動開始禁止）

HydrogenがOAuth一覧に存在し、さらに実行・レビュー品質を確認できた場合のみ、Human Ownerの判断でCLI v1.5.8バイナリSHA、固定インベントリ、モデル認定、カタログ、Fallback方針を一括更新する。

- Fast候補: `gemini-4-hydrogen-medium`
- Deep候補: `gemini-4-hydrogen-high`
- 規定モデル: 現行`gemini-3.8-flash-medium`を維持（変更時はPinned Fast preferredと整合させる）。
- CarbonはGoogle AI Proで利用不可なので採用しない。
- HydrogenがGemini共通枠を消費するなら、FlashへのFallbackが**独立した利用枠の追加**にはならない可能性がある。

実機検証なしで`certification_status=certified`にすることや、テストが存在するだけで本番モデルを切り替えることは禁止。追加レビューの自動起票や認定期限の再設定も行わない。

## 完了条件

このPRでは、Google AI Proに合う候補と、機密情報を漏らさず実際のOAuth利用可能モデルおよびCLIハッシュを取得する経路までを完成とする。OAuth実証と本番移行は**未承認かつ未実施**。本PR作業はここで終了可能。
