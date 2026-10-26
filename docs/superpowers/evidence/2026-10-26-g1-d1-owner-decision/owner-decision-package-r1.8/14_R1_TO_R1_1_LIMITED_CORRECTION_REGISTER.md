# 14. R1 から R1.1 への是正登録簿（R1 to R1.1 Limited Correction Register）

## 1. 概要

本書は、G1-D1 Human Owner Decision Package R1 に対する独立再レビューで検出された 3 件の残存 Finding（FND-ODP-001: Major, FND-ODP-007: Major, FND-ODP-008: Moderate）について、その修正前後の比較、是正根拠、修正対象ファイル、および残存事項を記録した是正登録台帳です。

---

## 2. 3件の Finding 是正詳細

### FND-ODP-001: 推奨値と Owner 判断値の構造的分離（重要度: Major）
- **修正前 (R1)**:
  - `01_DECISION_MATRIX_R1.csv` の `approval_method` および `decision_disposition` 列に、AI の技術的推奨値（`METHOD_A_STAGE_BY_STAGE` や `APPROVE`）が既に入力されていた。このため、Human Owner が決定した正式な判断値であるかのように誤認される危険があった。
- **修正後 (R1.1)**:
  - CSV スキーマを改訂し、AI 推奨用フィールド（`recommended_approval_method`, `recommended_disposition`, `recommendation_rationale`）と、Human Owner 判断用フィールド（`owner_selected_approval_method`, `owner_decision_disposition`, `owner_authorized_stage`, `owner_authorized_scope`, `owner_decision_record_id`, `owner_decision_date`, `owner_signature`）に明確に分離。
  - すべての Owner 判断フィールドを完全な未記入（空文字）とし、`current_status` は全項目 `NOT_APPROVED` を維持。
  - DEC-03 において Method A/B、判断区分、対象 Stage を独立選択とし、未指定時は `NO_EXECUTION_GRANT` となるフェイルクローズ契約を徹底。
- **是正根拠**: 人間の承認意思と AI の助言の混同排除。
- **修正ファイル**: `01_DECISION_MATRIX_R1_1.csv`, `04_DEC_03_EXECUTION_RESOURCES_R1_1.md`, `09_APPROVAL_DEPENDENCY_AND_SEQUENCE_R1_1.md`, `10_OWNER_DECISION_RECORD_TEMPLATE_R1_1.md`
- **残存事項**: なし（完全に分離）。

---

### FND-ODP-007: 外部 Owner 判断記録方式と自己参照ハッシュ循環の排除（重要度: Major）
- **修正前 (R1)**:
  - パッケージの確定 SHA-256 をパッケージ内のテンプレート自身に埋め込むことが想定され、自己参照的なハッシュ循環の懸念があった。また、個別の DEC ごとの判断記録 ID や対象 VM 識別子、実行回数、証跡 ID 等のバインディングが一部不十分であった。
- **修正後 (R1.1)**:
  - パッケージ本体を「生成・ハッシュ計算後に不変となる資料」として扱い、署名済み判断記録をパッケージとは独立した「外部判断記録（External Owner Decision Record）」として管理するアーキテクチャを確立。
  - 各 DEC テンプレートに固有の Decision Record ID（例: `ODR-G1-D1-20261026-R1.1-DEC01A-01`）、対象 VM 識別子、審査証跡 ID、許容実行回数、失効条件、および実行資格判定（Eligibility Check）規則を追加。
  - パッケージ内部への確定ハッシュ埋め込みを廃止し、独立レビューにより公表されたパッケージハッシュを外部記録側で参照する契約とした。
- **是正根拠**: 承認記録の不変性・追跡可能性の担保およびハッシュ循環の排除。
- **修正ファイル**: `10_OWNER_DECISION_RECORD_TEMPLATE_R1_1.md`, `00_OWNER_EXECUTIVE_SUMMARY_R1_1.md`, `11_INDEPENDENT_REVIEW_HANDOFF_R1_1.md`
- **残存事項**: なし。

---

### FND-ODP-008: STOP 再開 Gate の 3 段階非循環化（重要度: Moderate）
- **修正前 (R1)**:
  - STOP 後の再開 Gate において、10条件すべての充足を再開の前提としていたが、その10条件の1つに「Human Owner の明示的承認」が含まれていたため、「承認前に承認済みであることを要求する論理的循環」が存在していた。
- **修正後 (R1.1)**:
  - 旧10条件の安全要件をすべて維持した上で、プロセスを以下の 3 段階に再編：
    - **Phase A (Pre-approval)**: STOP 原因特定、ログ保全、修復文書化、HEAD整合、隔離確認等の客観検証（旧条件1〜4, 6〜9）。
    - **Phase B (Owner Decision)**: Phase A 完了確認に基づく Human Owner の明示的判断（旧条件5: 署名・判断記録発行）。
    - **Phase C (Post-approval Eligibility Check)**: 再実行直前の実行資格確認（旧条件10: 単一Stage限定・回数上限・条件充足）。
  - 条件付き承認の場合、条件未充足時は `CONDITION_PENDING / EXECUTION_BLOCKED` となり、Phase C を通過するまで再実行できない契約を明確化。
- **是正根拠**: 再開判断プロセスの論理的整合性と安全停止原則の堅持。
- **修正ファイル**: `07_DEC_07_STOP_RESUME_R1_1.md`, `09_APPROVAL_DEPENDENCY_AND_SEQUENCE_R1_1.md`, `10_OWNER_DECISION_RECORD_TEMPLATE_R1_1.md`
- **残存事項**: なし。
