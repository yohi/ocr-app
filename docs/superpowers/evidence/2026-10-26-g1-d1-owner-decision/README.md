# G1-D1 Human Owner Decision Package R1.8 & Handoff Archive

## 概要

本ディレクトリは、OCR App (`yohi/ocr-app`) における **G1-D1 Human Owner Decision Package R1.8**、**Human Owner Handoff R0**、および **Independent Review Provenance R1** の文書成果物・証跡アーカイブを永続化するためのものです。

### 文書レビューと実行許可の厳格な区別
- **文書レビュー状態**: **`COMPLETE`**（独立限定再レビューにより R1.8 の全指摘事項是正を確認済み）
- **意思決定パッケージ**: **`R1.8`**
- **DEC-01A〜07 承認状態**: **`NOT_APPROVED`**（Human Owner による個別判断待ち）
- **未解決再試験項目 (Unresolved Retests)**: **`19 / NOT_EXECUTED`**
- **Runtime Safety Verification**: **`NOT_VERIFIED`**
- **G1-D1 Formal Gate**: **`BLOCKED`**

> [!IMPORTANT]
> 本アーカイブの保存および PR 作成は、**完成済み文書成果物の Git 管理・証跡保全のみ**を目的としており、Node.js / npm の実行、Runtime 環境の操作、テスト実行、Owner 承認の代行、および G1-D1 Gate の解除を伴うものではありません。

---

## 保存アーカイブ一覧と検証ハッシュ

| 区分 | アーカイブファイル名 | サイズ (bytes) | SHA-256 チェックサム | 内部構成 |
| :--- | :--- | :--- | :--- | :--- |
| **A** | `OCR_APP_G1_D1_OWNER_DECISION_PACKAGE_R1_8_2026-10-26.tar.gz` | 135,826 | `c3f318a8267b9137abae682e79a7ebe4baa635b4bc8b597108865ead7885ef2e` | 29成果物＋`SHA256SUMS.txt` (全29件検証 PASS) |
| **B** | `OCR_APP_G1_D1_OWNER_HANDOFF_R0_2026-10-26.tar.gz` | 15,972 | `59fda04781546c58e8a71d4ebf0391411a118762f8f3816e3b8e73d8993b8df5` | 3文書＋`SHA256SUMS.txt` (全3件検証 PASS) |
| **C** | `OCR_APP_G1_D1_OWNER_HANDOFF_PROVENANCE_R1_2026-10-26.tar.gz` | 8,699 | `7b1f61972c4760041306d3ed22c1e795e3028538c00e9fc19d7184a2e3bada63` | 3文書＋`SHA256SUMS.txt` (全3件検証 PASS) |

---

## 固定 HEAD と参照環境

- **Fixed HEAD**: `6b08251170265c444ce8957377e6bfca23b21fd7`
- **対象リポジトリ**: `yohi/ocr-app`
- **Base ブランチ**: `master` (`ce477332aaef8068a94cfc8cc7343971ae045488`)

---

## ディレクトリ構成

```text
docs/superpowers/evidence/2026-10-26-g1-d1-owner-decision/
├── README.md                           # 本説明文書
├── SHA256SUMS.txt                      # 格納ファイル全件の SHA-256 チェックサム一覧
├── archives/                           # 元アーカイブ（.tar.gz）保存領域
│   ├── OCR_APP_G1_D1_OWNER_DECISION_PACKAGE_R1_8_2026-10-26.tar.gz
│   ├── OCR_APP_G1_D1_OWNER_HANDOFF_R0_2026-10-26.tar.gz
│   └── OCR_APP_G1_D1_OWNER_HANDOFF_PROVENANCE_R1_2026-10-26.tar.gz
├── owner-decision-package-r1.8/        # R1.8 展開文書（29成果物＋内部SHA256SUMS.txt）
├── owner-handoff-r0/                   # Handoff R0 展開文書（3文書＋内部SHA256SUMS.txt）
└── owner-handoff-provenance-r1/        # Provenance R1 展開文書（3文書＋内部SHA256SUMS.txt）
```

---

## 独立レビュー来歴に関する注記

Provenance R1 の記録において、独立レビュー原文の取得元来歴に関する一部の検証記録が整理されています。
この記録は文書トレーサビリティの保全として本ディレクトリ内にそのまま記録・保存されており、新たな文書レビューサイクルを開始するものではありません。
すべての展開ファイルは、元の内容およびチェックサムを変更せずにそのまま保存されています。
