# GitHub Actions レビュー進捗表示 設計

## 背景

`ocr-engine.yml` は `agy` を JSON 出力モードで起動し、
`antigravity-host.mjs` の `runHost` で結果を受け取る。現在のホストは子プロセスの
`stderr` を内部バッファへ保存するだけなので、レビュー中に `agy` が出す進捗行が
GitHub Actions の実行ログへ届かない。

OpenCodeReview v1.9.8 以降は、機械可読な出力と進捗表示を両立するため、進捗を
`stderr` へ出力する。これを Actions のログへ転送する。

## 目的

- レビュー実行中に `Run Antigravity review host` のログへ進捗行を表示する。
- 最終結果の JSON を `stdout` から解析する既存動作を維持する。
- リトライ、fallback、timeout、失敗判定の動作を変更しない。
- `runThreadHost` など、進捗転送を指定しない呼び出しへ影響を与えない。

## 対象外

- GitHub Actions に割合を示すプログレスバーを追加すること。
- PR の Check Run 概要をレビュー中に段階更新すること。
- 進捗を構造化 JSON イベントへ変更すること。

## 設計

### 子プロセス出力の転送

`readChild` と `runMode` に任意の `onProgress` コールバックを追加する。

- 子プロセスの `stderr` を従来どおり上限付きバッファへ保存する。
- 子プロセスが実行中であれば、`stderr` を行単位で `onProgress` へ渡す。
- `onProgress` へ渡す前に、既存の秘密情報マスキング、ANSI/制御文字除去、出力総量の上限を適用する。
- コールバックが未指定の場合は、現在と同じくバッファ保存だけを行う。
- コールバックの失敗はレビュー結果の判定へ影響させない。
- `stdout` は最終 JSON の解析専用として、Actions ログへ転送しない。

### Actions ワークフロー

`ocr-engine.yml` のホスト実行処理で次のログを出す。

1. `runHost` 呼び出し前にレビュー開始を通知する。
2. `onProgress` で受け取った `stderr` を Actions の標準エラーへ逐次転送する。
3. `runHost` 完了後に結果の `status` を通知する。

進捗行は `agy` が生成した形式を維持する。Actions のログへ流すのは子プロセスの
`stderr` だけとし、最終 JSON と混在させない。

### エラー処理

- 既存の `stderr` バッファを使ったエラー内容の抽出と fallback 判定を維持する。
- timeout 後に遅れて到着した出力は、既存の `settled` 判定どおり無視する。
- 進捗転送が利用できない場合でも、レビュー結果の生成と既存の失敗処理を継続する。
- 認証情報や環境変数を新たにログへ出力しない。

## テスト

`.github/workflows/scripts/antigravity-host.test.mjs` に次を追加する。

- 子プロセスの複数の `stderr` チャンクが `onProgress` へ順番どおり渡ること。
- 進捗転送と同時に `stdout` の有効な JSON が正常に解析されること。
- `onProgress` 未指定時の既存動作が維持されること。
- 既存の timeout、fallback、リトライのテストが通ること。

## 受け入れ条件

- レビュー完了を待たず、Actions のホスト実行ステップに `agy` の進捗行が表示される。
- 最終レビュー結果が従来どおり `/tmp/ocr-result.json` に JSON として保存される。
- 既存のホストテスト、ワークフロー構文検査、差分検査が成功する。
