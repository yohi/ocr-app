# 03 — G1-D1 Human Owner Final Submission Index

**作成日:** 2026-10-26 JST / **提出種別:** 来歴未回収を明示した判断準備資料 / **承認効力:** なし。

**最終状態:** `G1_D1_REVIEW_PROVENANCE_PENDING / OWNER_HANDOFF_PREPARED / NO_EXECUTION_GRANT`。
**G1-D1 Formal Gate:** `BLOCKED`。文書レビュー正式クローズ、Owner DEC署名、Host実行のいずれも未実施。

## 1. 提出文書・参照SHA-256

| 文書・原本 | SHA-256 | 用途・場所 |
|---|---|---|
| `01_R1_8_INDEPENDENT_REVIEW_PROVENANCE_RECORD.md` | `eb7e1d98d89922090a53574ac9a8ceff109e264f4ae89a05f5cc96d56544e414` | 本アーカイブ内。独立レビュー来歴・未回収項目・固定値 |
| `02_G1_D1_OWNER_HANDOFF_EVIDENCE_RECONCILIATION.md` | `2b153f7f500225435bd36e94b4df72d5f321c1d064c91f757f81bedad272b941` | 本アーカイブ内。12 Finding・8 DEC・Runtime未実証の照合 |
| `03_G1_D1_HUMAN_OWNER_FINAL_SUBMISSION_INDEX.md`（本書） | **本アーカイブ内 `SHA256SUMS.txt` を参照** | 自己参照ハッシュを本文に埋め込まないため。照合には本書の実バイト列を再ハッシュする |
| R1.8 Owner Decision Package | `c3f318a8267b9137abae682e79a7ebe4baa635b4bc8b597108865ead7885ef2e` | 別提供の原本（135,826 bytes）、原本名は本書§2 |
| Owner Handoff R0 | `59fda04781546c58e8a71d4ebf0391411a118762f8f3816e3b8e73d8993b8df5` | 別提供の原本（15,972 bytes）、原本名は本書§2 |
| R1.8独立レビュー最終報告原文 | **`NOT_AVAILABLE / SHA256_NOT_COMPUTABLE`** | 提出資料には同梱されず。原文と発行来歴の受領が必要 |

**ハッシュ形式上の制約:** 本書の自己SHA-256を本書に埋め込むとファイル内容が変わりハッシュが循環するため、3文書のSHA-256正本は別ファイル `SHA256SUMS.txt` に置く。外側アーカイブSHA-256は作成完了後に本アーカイブの**外**で通知する。これらは内容照合用で、発行者署名ではない。

## 2. 固定原本・結合範囲

- Repository: `https://github.com/yohi/ocr-app`
- Fixed HEAD（資料記載値の一致）: `6b08251170265c444ce8957377e6bfca23b21fd7`
- R1.8原本: `OCR_APP_G1_D1_OWNER_DECISION_PACKAGE_R1_8_2026-10-26.tar.gz`、SHA-256 `c3f318a8267b9137abae682e79a7ebe4baa635b4bc8b597108865ead7885ef2e`、`135,826 bytes`
- Handoff R0原本: `OCR_APP_G1_D1_OWNER_HANDOFF_R0_2026-10-26.tar.gz`、SHA-256 `59fda04781546c58e8a71d4ebf0391411a118762f8f3816e3b8e73d8993b8df5`、`15,972 bytes`
- 当該会話で受領したローカル名は各々 `(2).gz`。バイト列の一致で同一内容を確認。ファイル名末尾は実体の別バージョンを意味する証拠ではない。

- 2原本の結合検査値（UTF-8、タブ区切り、LF行末、`01` §2参照）: `8449948ba13e6425ef8b696b5926f5d0fe82dd663e16e8ebf54e8ac5fd8ecee0`。
- R1.8内29成果物＋`SHA256SUMS.txt`：29/29 PASS。R0内3文書＋`SHA256SUMS.txt`：3/3 PASS。安全な通常ファイルだけを静的読取。差分7ファイルもハッシュ検証対象で、patchを**適用していない**。
- R0 3文書は**変更していない**。R1.8の固定HEAD一致はドキュメント上の一致であり、Host/Runtimeテストを伴わない。

## 3. 判定表（権限・範囲を分離）

| 報告対象 | 結果 | 意味 |
|---|---|---|
| 1. R1.8 Input Integrity | `PASS` | 外側・内部SHA、サイズ、安全パス一致 |
| 2. Handoff R0 Input Integrity | `PASS` | 外側・内部SHA、サイズ、安全パス一致 |
| 3. Independent Review Content Consistency | `SECONDARY_CLAIMS_CONSISTENT / FULLTEXT_NOT_VERIFIED` | 6つの判定文字列とR0の転記は一致。独立レビュー全文は未回収 |
| 4. Independent Review Provenance | **`REVIEW_PROVENANCE_UNVERIFIED`** | 原本バイト列、発行主体、署名・発行時刻の認証なし |
| 5. Finding Closure Consistency | `12/12 DOCUMENTARY_MATCH / REVIEWER_REPORTED` | 2 RESOLVED・10 NON_REGRESSION_PASSがR0に存在。原報告認証ではない |
| 6. Runtime Gate Separation | `PASS (DOCUMENTARY ONLY)` | 全Runtime実証は未実行、`NO_EXECUTION_GRANT` |
| 7. Human Owner Submission Readiness | `OWNER_HANDOFF_PREPARED / PROVENANCE_OPEN` | 受領・判断のため提出可能。正式文書クローズの完了ではない |

**最終文書レビュー（伝達値のみ）:** `OWNER_DECISION_PACKAGE_R1_8_INTEGRITY_PASS / FND_ODP_R17_001_RESOLVED / FND_ODP_007_R15_003_RESOLVED / 10_NON_REGRESSION_PASS / DOCUMENT_REVIEW_CLOSE_ELIGIBLE / NO_EXECUTION_GRANT`。独立レビュー原本の真正性は未立証。新規の独立レビューを実施したと主張しない。

## 4. Human Ownerへ引き渡す未決事項

1. **必須来歴確認:** 2026-10-26のR1.8独立レビューレポートの真正な最終原文・発行元・発行日時・対象SHA・Finding12件・権限境界を含む原本を回収。取得方法・出典・ハッシュを別途検証。
2. **原文が会話コピーのみの場合:** 内容・全体性を確認しても発行元認証がないことを受領記録に明記。本人が十分な証拠か判断すること。AIが `ORIGINAL_REVIEW_ARTIFACT_VERIFIED` を付与しない。
3. **正式文書クローズ:** Human Owner自身が別記録で判断し、本人署名・日時を記入する。本アーカイブは未決欄に値を入力しない。
4. **全8 DEC:** `DEC-01A/01B/02/03/04/05/06/07 = NOT_APPROVED`。Human Ownerの個別Decision Recordと必要な後段GateなしにStage許可を発生させない。
5. **後段受入:** Authorization・LP-R・LP-S・LP-A・STOP6階層・Host26コンテナ隔離・Stage/Qualityの実地証拠は全て未取得。独立Gate審査は将来の別行為。

## 5. 永続するSTOP・禁止事項

- 固定履歴: Total 455 / PASS 436 / FAIL 13 / CANCELLED 6 / SKIPPED 0 / TODO 0。
- 未解決19件: **`Allowed Execution = NO / Owner Approval = REQUIRED / Retest Result = NOT_EXECUTED`**。
- **Runtimeテスト禁止、Host/VM/Docker操作禁止、GitHub書込禁止、STOP解除禁止、署名・承認代行禁止、正式Gate解除禁止。**
- 文書の内容照合は `DOCUMENT_REVIEW_CLOSE_ELIGIBLE` を再発行しない。未実証事項は `RUNTIME_NOT_VERIFIED`、正式Gateは**`G1_D1_FORMAL_GATE_BLOCKED`**を維持。
- `OWNER_CONFIRMATION_REQUIRED / NO_EXECUTION_GRANT`。Human OwnerおよびFormal Gate Authorityの責務を一切代行しない。
