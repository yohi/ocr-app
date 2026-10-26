# 12. 入力原本来歴と照合記録（Input Provenance R1.8）

## 1. 入力原本の完全性検証結果

本 R1.8 最終限定是正パッケージ作成において使用された公式入力ファイルおよび先行成果物について、静的検証（ハッシュ、サイズ、内部完全性）を実施しました。

### 1.1 R1.7 意思決定パッケージ（直接の是正対象）
- **外側アーカイブ名**: `OCR_APP_G1_D1_OWNER_DECISION_PACKAGE_R1_7_2026-10-26.tar.gz`
- **期待 SHA-256**: `fb6229108fffca9388c4ac5dd523644b7d22cc7483b5ea044e7d59e3ee3f8dd1`
- **実測 SHA-256**: `fb6229108fffca9388c4ac5dd523644b7d22cc7483b5ea044e7d59e3ee3f8dd1`
- **期待バイトサイズ**: `123,176 bytes`
- **実測バイトサイズ**: `123,176 bytes`
- **検証ステータス**: **`MATCH (完全一致検証 PASS)`**
- **内部完全性**: 内部 `SHA256SUMS.txt` 27 項目全件一致検証 PASS

### 1.2 R1.6 意思決定パッケージ（先行比較原本）
- **外側アーカイブ名**: `OCR_APP_G1_D1_OWNER_DECISION_PACKAGE_R1_6_2026-10-26.tar.gz`
- **期待/実測 SHA-256**: `f99e1a635a1498dcc2e25417b38a6ac7f8cca7fb96b5b54f00cb97286507ab3d`
- **期待/実測バイトサイズ**: `108,590 bytes`
- **検証ステータス**: 完全一致確認 PASS

### 1.3 上位の再試験計画 R1.3
- **ファイル名**: `OCR_APP_G1_D1_UNRESOLVED_19_RETEST_PLAN_R1_3_2026-10-26.tar.gz`
- **期待/実測 SHA-256**: `e293e59b865f973cc8f4af259589cf8d99956044c701d9baa6277085ad8e7ed7` (`MATCH`)
- **期待/実測バイトサイズ**: `33,389 bytes` (`MATCH`)
- **既存レビュー結果**: `R1_3_INDEPENDENT_RE_REVIEW_PASS / DOCUMENT_REVIEW_CLOSURE_RECOMMENDED`

---

## 2. 固定HEADおよびソースツリー照合記録

- **Repository**: `https://github.com/yohi/ocr-app`
- **Branch**: `fix/shadow-graphql-post-scope-guards`
- **Fixed HEAD コミットハッシュ**: `6b08251170265c444ce8957377e6bfca23b21fd7`（Git 40桁 SHA-1 オブジェクト識別子）
- **Git作業ツリー状態**:
  - `git rev-parse HEAD` 出力: `6b08251170265c444ce8957377e6bfca23b21fd7`（完全一致）
  - 追跡ファイル変更: なし（クリーン）
- **全体回帰テストファイル集合（全39ファイル）**:
  - `git ls-tree -r --name-only 6b08251170265c444ce8957377e6bfca23b21fd7 -- .github/workflows/scripts/`
  - 照合ステータス: **`TEST_SCOPE_INDEPENDENT_VERIFICATION_PASS`**（39ファイル実在確認済み）

---

## 3. 証跡台帳と環境保護

本限定是正プロセスにおいて、入力原本の破壊・上書きは一切行われておらず、すべての分析は完全読み取り専用で行われました。
ホスト側の稼働中26コンテナは完全無停止で保全されています。
