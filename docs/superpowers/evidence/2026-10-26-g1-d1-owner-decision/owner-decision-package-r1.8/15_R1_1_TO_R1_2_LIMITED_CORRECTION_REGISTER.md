# 15. R1.1 から R1.2 への是正登録簿（R1.1 to R1.2 Limited Correction Register）

## 1. 概要

本書は、G1-D1 Human Owner Decision Package R1.1 に対する独立再レビューで検出された 2 件の残存 Finding（FND-ODP-001: Major, FND-ODP-007: Major）について、その修正前後の比較、是正根拠、修正対象ファイル、および残存事項を記録した是正登録台帳です。

---

## 2. 2件の Finding 是正詳細

### FND-ODP-001: Method A（Stage別承認）における単一Stage承認の強制（重要度: Major）
- **修正前 (R1.1)**:
  - DEC-03 のテンプレートにおいて、Stage 0〜5 の複数選択肢がチェックボックス形式で並んでおり、複数 Stage が同時に選択・承認される余地があった。「連続実行を許可しない」という記述だけでは複数事前承認が排除しきれなかった。
- **修正後 (R1.2)**:
  - `METHOD_A_STAGE_BY_STAGE` における「1 Record = 1 Stage 原則」を規範的契約規則（10原則）として定義。
  - DEC-03 テンプレートの Stage 入力を単一選択・単一入力方式（`Authorized Stage: [単一Stage識別子のみ記入]`）へ改修。
  - 複数 Stage 指定、範囲指定（例: `Stage 0-3`）、ワイルドカード指定（例: `ALL`）をすべて明示的に無効化。次 Stage の承認には必ず新しい Decision Record ID を持つ別個の独立判断記録の発行を義務付けた。
- **是正根拠**: Stage 承認の不可分性と事前包括承認の完全排除。
- **修正ファイル**: `04_DEC_03_EXECUTION_RESOURCES_R1_2.md`, `10_OWNER_DECISION_RECORD_TEMPLATE_R1_2.md`, `01_DECISION_MATRIX_R1_2.csv`, `09_APPROVAL_DEPENDENCY_AND_SEQUENCE_R1_2.md`
- **残存事項**: なし（完全に単一化）。

---

### FND-ODP-007: 外部 Owner Decision Record 共通必須スキーマおよび一意 ID 発行規則の完成（重要度: Major）
- **修正前 (R1.1)**:
  - 外部判断記録方式の枠組みは導入されたものの、全 DEC 共通の厳密な論理スキーマ定義、ID の一意性保証・過去 ID 再利用禁止の手続き規則、および証跡 ID と SHA-256 の 1対1 結合規則が具体化しきれていなかった。
- **修正後 (R1.2)**:
  - 7 つの論理ブロック（Record Identity, Package Binding, Evidence Binding, Environment Binding, Authorization Scope, Validity, Human Owner）から構成される共通必須スキーマを定義。
  - 規範的 ID フォーマット（`ODR-G1-D1-<YYYYMMDD>-<PACKAGE_REV>-<DEC_ID>-<STAGE_OR_NA>-<SEQUENCE>`）と、ID 重複防止・再利用禁止の 7 原則を策定。
  - 証跡 ID と SHA-256 の 1対1 結合、Package/HEAD/VM/Scope 結合、および発効条件（11項目論理積）と失効条件（8項目）を完全定義。
- **是正根拠**: 承認記録の不変性、一意性、および監査追跡可能性の確立。
- **修正ファイル**: `10_OWNER_DECISION_RECORD_TEMPLATE_R1_2.md`, `00_OWNER_EXECUTIVE_SUMMARY_R1_2.md`, `11_INDEPENDENT_REVIEW_HANDOFF_R1_2.md`
- **残存事項**: なし。
