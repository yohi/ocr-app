# 01 — R1.8 Independent Review Provenance Record

**作成日:** 2026-10-26 JST / **文書版:** R1 / **性質:** 静的証跡記録。過去の独立レビュアー発行物ではない。

**権限:** `READ_ONLY / STATIC_DOCUMENTATION / PROVENANCE_VERIFICATION_ONLY / NO_EXECUTION_GRANT / NO_OWNER_AUTHORITY / NO_GATE_AUTHORITY`

## 1. 結論と保証範囲

**結果:** `REVIEW_PROVENANCE_UNVERIFIED` / `SECONDARY_REVIEW_CLAIMS_CONSISTENT` / `FULL_REVIEW_TRANSCRIPT_NOT_AVAILABLE`。

R1.8独立レビュー最終報告**全文・その原本バイト列・発行元認証/署名**は受領アーカイブ内と検索可能な提供資料中で取得できていない。過去のChatGPT回答に関する会話履歴由来の二次記録は見つかったが、原本として固定できない。この記録を `ORIGINAL_REVIEW_ARTIFACT_VERIFIED` または `REVIEW_TRANSCRIPT_CONTENT_VERIFIED` と判定しない。ユーザーから与えられた判定とHandoff R0の転記値を記録するだけであり、独立レビュアーが確証したという新しい主張ではない。

正式な文書クローズは `OWNER_CONFIRMATION_PENDING`、実行権限なし、G1-D1 Formal Gateは `BLOCKED`。

## 2. 固定入力・静的整合性

- Repository: `https://github.com/yohi/ocr-app`
- Fixed HEAD（資料記載値の一致）: `6b08251170265c444ce8957377e6bfca23b21fd7`
- R1.8原本: `OCR_APP_G1_D1_OWNER_DECISION_PACKAGE_R1_8_2026-10-26.tar.gz`、SHA-256 `c3f318a8267b9137abae682e79a7ebe4baa635b4bc8b597108865ead7885ef2e`、`135,826 bytes`
- Handoff R0原本: `OCR_APP_G1_D1_OWNER_HANDOFF_R0_2026-10-26.tar.gz`、SHA-256 `59fda04781546c58e8a71d4ebf0391411a118762f8f3816e3b8e73d8993b8df5`、`15,972 bytes`
- 当該会話で受領したローカル名は各々 `(2).gz`。バイト列の一致で同一内容を確認。ファイル名末尾は実体の別バージョンを意味する証拠ではない。

- R1.8: 外側SHA-256/サイズ一致、SHA256SUMS **29/29**一致、通常ファイル30件（29成果物＋チェックサム）・通常ディレクトリ1件、危険パス・重複・リンク・特殊ファイルなし。
- Handoff R0: 外側SHA-256/サイズ一致、SHA256SUMS **3/3**一致、通常ファイル4件、危険パス・重複・リンク・特殊ファイルなし。
- R1.8およびHandoff R0に記載の固定HEAD: **一致**（リポジトリ実行状態の検証ではない）。
- 二原本の論理結合SHA-256: `8449948ba13e6425ef8b696b5926f5d0fe82dd663e16e8ebf54e8ac5fd8ecee0`。**このハッシュは第三者署名でも発行者認証でもない。** 下記の正規化した2行（UTF-8、タブ区切り、各行末 LF）について計算したもの:

```text
R1_8	c3f318a8267b9137abae682e79a7ebe4baa635b4bc8b597108865ead7885ef2e	135826	6b08251170265c444ce8957377e6bfca23b21fd7
HANDOFF_R0	59fda04781546c58e8a71d4ebf0391411a118762f8f3816e3b8e73d8993b8df5	15972	6b08251170265c444ce8957377e6bfca23b21fd7
```

## 3. 最終レビューの必須属性と来歴

| 属性 | 判明した内容 | 確認水準 |
|---|---|---|
| レビュー対象 | G1-D1 Owner Decision Package R1.8、固定HEAD上の静的文書品質 | 当該パッケージ・R0記載と一致 |
| 対象アーカイブ | `OCR_APP_G1_D1_OWNER_DECISION_PACKAGE_R1_8_2026-10-26.tar.gz` | 入力原本SHA-256で固定 |
| 対象SHA-256 | `c3f318a8267b9137abae682e79a7ebe4baa635b4bc8b597108865ead7885ef2e` | パッケージ実測済／レビュー原文での直接結合は未確認 |
| レビュー実施日 | 過去の会話履歴検索結果では `2026-10-26T02:49:57Z`（JST 11:49:57）という回答メタデータが示された | 二次記録のみ。本人発行日・日時原本は未確認 |
| レビュー発行主体 | 過去会話の区分は ChatGPT の過去回答／独立限定レビュアーとして記載 | 本人証明・署名・会話原本の発行認証は未確認 |
| レビュー権限 | `READ_ONLY / STATIC_DOCUMENT_REVIEW / NO_EXECUTION_GRANT` 相当の文書限定レビュー | 伝達内容・依頼仕様に基づく。発行原本の全文未照合 |
| 最終レビュー判定 | `DOCUMENT_REVIEW_CLOSE_ELIGIBLE` | 依頼者伝達とR0転記が一致。独立原文未照合 |
| Finding別判定 | 解決2件・非退行10件 | Handoff R0の12行とR1.8参照箇所の整合まで確認 |
| 非退行 | `10_NON_REGRESSION_PASS` | 転記結果として確認、独立最終レビューの全文未確認 |
| Gate分離 | `NO_EXECUTION_GRANT` / Runtime未実証 / Formal Gate `BLOCKED` | R1.8とR0の規範内容で確認。Runtimeの実証ではない |

原文のSHA-256: **`NOT_COMPUTABLE / ORIGINAL_BYTES_NOT_OBTAINED`**。原文の長さ・完全性・最終判定節の全文・独立した発行URI/会話識別子・本人署名・失効/訂正履歴も未確認。二次記録から再構成したテキストを原本と誤表示しない。

## 4. 提示・継承された判定文字列（原本の直接引用ではない）

```text
OWNER_DECISION_PACKAGE_R1_8_INTEGRITY_PASS
FND_ODP_R17_001_RESOLVED
FND_ODP_007_R15_003_RESOLVED
10_NON_REGRESSION_PASS
DOCUMENT_REVIEW_CLOSE_ELIGIBLE
NO_EXECUTION_GRANT
```

この6行はユーザー提示・Handoff R0記載・過去回答の二次的検索記録で一致する。**発行者を認証済みとする根拠ではない。** R1.8内部 `11_INDEPENDENT_REVIEW_HANDOFF_R1_8.md` は独立レビュー**依頼書**であり、レビュー結果の最終報告原本ではない。Handoff R0の `01` §1もこの来歴制限を明記している。

## 5. 原本・要約・転記の区別と所在

| 種別 | 参照方法 | 区分 |
|---|---|---|
| R1.8原本 | 提供アーカイブ（本表SHA-256で識別）、内部 `11_INDEPENDENT_REVIEW_HANDOFF_R1_8.md` | **レビュー依頼書**。独立最終報告ではない |
| Handoff R0原本 | 提供アーカイブ（本表SHA-256で識別）、内部 `01_G1_D1_R1_8_DOCUMENT_REVIEW_CLOSURE_RECORD.md` | 過去判定の転記・まとめ |
| 過去ChatGPT R1.8レビュー回答 | 会話履歴の検索対象として存在を示す二次メタデータあり。元チャットの参照URL・エクスポート・保存済み原本IDは**未取得** | **原文全文未回収**。ハッシュ不可 |
| 本文書および同梱R1文書 | 今回新規作成した補助文書 | **レビュアー原本ではない** |

## 6. 独立原文と照合する際の未完了受領項目

1. 発行された最終レビュー回答の**改変されていない全文バイト列**、採取日時、採取方法、会話リンクまたはエクスポートの出典。
2. 対象R1.8の外側SHA-256・レビュー対象版・Finding全12行・非退行10件・Gate制限が原文に記されていることの逐語照合。
3. 発行主体・発行日時・レビュー権限および訂正/差替え履歴を、信頼できる出所で結合できるかの判定。出所認証が無ければ `REVIEW_TRANSCRIPT_CONTENT_VERIFIED` 止まりにする。
4. Human Owner本人による証跡受領・正式文書クローズの**別記録**。本書の作成・取得・整合結果は本人判断ではない。

## 7. 最終来歴区分

- `ORIGINAL_REVIEW_ARTIFACT_VERIFIED`: **NO**（原本・発行来歴・署名を未取得）。
- `REVIEW_TRANSCRIPT_CONTENT_VERIFIED`: **NO**（比較可能な原文全文が未取得）。
- `REVIEW_PROVENANCE_UNVERIFIED`: **YES**。
- `OWNER_CONFIRMATION_PENDING / NO_EXECUTION_GRANT / G1_D1_FORMAL_GATE_BLOCKED` を維持。
