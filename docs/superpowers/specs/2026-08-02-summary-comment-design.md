# Summary コメント投稿 設計書

## 概要

OCR のレビュー結果を投稿する際、従来のインラインコメント（ファイル・行に紐づく）に加えて、
**1件の PR コメント**に「Summary（自動生成の統計）+ 全コメントを1つのコードブロックに連結した内容」を
投稿する機能を追加する。

## 背景

- 現状はインラインコメントのみの投稿で、複数コメントがあるときに「一つ一つコピペするのが面倒」
  という不満がある
- コメント本文に該当箇所（ソースや行番号）が含まれていないため、どこに対する指摘か分かりにくい
- CodeRabbit のように、1件のコメントに全体をまとめて見られる形式が欲しい

## 変更後の投稿内容

### 1. インラインコメント（既存・維持）

`postReviewComments` は変更しない。バッチレビュー → 個別フォールバックの既存フローをそのまま使う。

### 2. Summary コメント（新規）

`POST /issues/{prNumber}/comments` に1件投稿する。形式は以下のとおり。

````markdown
## 📋 OpenCodeReview Summary

3 件のコメント / 2 ファイル

| ファイル | コメント数 |
| --- | --- |
| `src/indexer/pipeline.ts` | 2 |
| `packages/dashboard/src/utils/metrics.ts` | 1 |

```text
[src/indexer/pipeline.ts:235]
Bug: Setting totalFiles to `events.length` ...

[src/indexer/pipeline.ts:84]
Warning: ...

[packages/dashboard/src/utils/metrics.ts:120]
Suggestion: ...
```

---
*Posted by OpenCodeReview*
````

- **Summary 本文の長さ制限**: 投稿本文は 65,536 文字（GitHub API 上限）を超えないようにする
  - 超過する場合はコードブロック内の transcript を末尾から切り詰め、`...（残りは省略）` を付与する
  - 切り捨ては `wrapInCodeBlock` 適用前の transcript に対して行い、コードフェンスの閉じタグが破損しないようにする
  - フッターは常に末尾に保持する
- **Summary セクション**: コメント総数・対象ファイル数・ファイル別コメント数を自動生成する
  - OCR 出力の `summary` フィールドは実行統計(`files_reviewed` / `comments` / `elapsed` など)であり LLM 要約ではない。
  - 自前生成の統計を主とし、`summary.elapsed` が存在する場合は所要時間を補足表示する
- **コードブロック**: 全コメントを `[path:line]` ヘッダー付きで連結し、1つのコードブロックにする
  - 既存の `wrapInCodeBlock`（動的フェンス）を再利用し、本文内のバッククォートでフェンスが壊れないようにする
  - コメント本文に含まれる Markdown（コード例など）はそのままプレーンテキストとして保持する

## コンポーネント詳細

### `post-ocr-comments.mjs` の変更

| 関数 | 責務 |
| --- | --- |
| `buildSummarySection(comments)` | コメント統計（件数・ファイル別件数）を Markdown 表に整形 |
| `buildCombinedCodeBlock(comments)` | 各コメントを `[path:line]\n{body}` に変換し、空行区切りで連結して `wrapInCodeBlock` で1つのコードブロックに |
| `buildSummaryBody(comments, ocrSummary?)` | 上記 2 つ + フッターを結合して最終的なコメント本文を生成 |
| `postSummaryComment({ comments, githubApi, prNumber, ocrSummary })` | `POST /issues/{pr}/comments` で投稿。成功時 0、失敗時 1 |

### `run()` の変更

```
1. result.status === 'skipped' → 従来どおり postSkipComment
2. getValidComments(result.comments) で有効コメントを抽出
3. postReviewComments（インライン投稿・既存）
4. postSummaryComment（Summary コメント投稿・新規）
5. exit code を合成
```

## エラーハンドリング

- コメント 0 件 → Summary コメントも投稿しない（現状どおり何もせず exit 0）
- インライン投稿失敗 → 従来どおり exit 1（Summary 投稿はスキップして早期リターン）
- Summary 投稿が 4xx/5xx → `console.error` でログ出力し exit 1
  - インラインは投稿済みのため、失敗時は CI ログと Artifact で確認可能

## テスト

`post-ocr-comments.test.mjs` に以下を追加する。

- Summary コメントの body が期待形式（統計表 + 連結コードブロック）と一致する
- `[path:line]` ヘッダーが正しく付く
- 本文にバッククォートを含む場合、動的フェンスで正しく連結される
- コメント 0 件時は Summary 投稿 API が呼ばれない
- Summary 投稿失敗時の exit code = 1

## 影響範囲

- `.github/workflows/scripts/post-ocr-comments.mjs` とテストファイルのみ変更
- `ocr-engine.yml` の変更は不要（既に `--result` で結果ファイルを渡しているため）
- 既存 18 テストは全て維持（インライン投稿ロジックは不変）
