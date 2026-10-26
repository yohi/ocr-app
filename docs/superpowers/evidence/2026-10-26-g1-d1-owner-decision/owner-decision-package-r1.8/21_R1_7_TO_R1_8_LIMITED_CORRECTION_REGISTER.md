# 21. R1.7 から R1.8 への限定是正登録簿（R1.7 to R1.8 Limited Correction Register）

## 1. 概要

本書は、G1-D1 Human Owner Decision Package R1.7 に対する独立再レビューで検出された **FND-ODP-R17-001**（STOP 解除条件と DEC-07 Phase C の循環依存）について、その修正前後の比較、是正根拠、修正対象ファイル、および残存事項を記録した限定是正登録台帳です。

---

## 2. 是正詳細

### FND-ODP-R17-001: STOP 解除条件と DEC-07 Phase C の循環依存解消（重要度: Major）
- **修正前 (R1.7)**:
  - `NO_ACTIVE_STOP = TRUE` の必須条件（第5.2節 条件10）に「STOP 再開に必要な Human Owner の個別判断（DEC-07 Phase B）および Phase A/B/C の全条件が充足済みであること」と記載されていた。
  - しかし、DEC-07 Phase C は再実行直前の適格性判定プロセスであり、その適格性判定式（`RESERVATION_ELIGIBLE`）自体が条件16として `NO_ACTIVE_STOP` を評価する設計となっていた。
  - この結果、`Phase C -> RESERVATION_ELIGIBLE -> NO_ACTIVE_STOP -> Phase C 完了` という論理的な循環依存が発生し、FND-ODP-008（非循環性）に対する退行となっていた。
- **修正後 (R1.8)**:
  - **概念の分離**: `STOP_CLEARANCE_VALID`（過去の STOP に対する解除記録自体の有効性判定）と `EXECUTION_ELIGIBLE`（再実行資格判定）を厳格に分離。
  - **Phase C 依存の除去**: `STOP_CLEARANCE_VALID` および `NO_ACTIVE_STOP` の定義から「DEC-07 Phase C の完了」を完全に排除。`STOP_CLEARANCE_VALID` は Phase A（修復証拠）および Phase B（真正な Owner 解除判断）のみに基づいて独立して評価可能とした。
  - **非循環 DAG の確立**:
    ```text
    STOP Event -> Phase A -> Phase B -> STOP_CLEARANCE_VALID -> NO_ACTIVE_STOP -> Phase C -> LP-R/S/A
    ```
    下流の Phase C が上流の `STOP_CLEARANCE_VALID` や `NO_ACTIVE_STOP` の成立要件となる逆向きの依存関係を完全に排除。
  - **STOP 履歴分岐の明確化**:
    - STOP 発生履歴なし: 正規の状態確認により有効 STOP なしと確定された場合、架空の DEC-07 解除判断を要求せず直ちに `NO_ACTIVE_STOP = TRUE`。
    - STOP 発生履歴あり: 真正な `STOP_CLEARANCE_VALID` が確認され、新規未解除 STOP や上位広域 STOP が残存していない場合に `NO_ACTIVE_STOP = TRUE`。
    - 状態不明時: `STOP_STATE_UNKNOWN / NO_EXECUTION_GRANT` としてフェイルクローズ。
  - **非同一性の徹底**: `STOP_CLEARANCE_VALID DOES NOT IMPLY EXECUTION_ELIGIBLE`。STOP 解除有効確認後も、Phase C において全 16 条件が独立再検証される契約を確立。
  - **全 16 条件論理積の維持**: `RESERVATION_ELIGIBLE` の 16 条件論理積および STOP 6 階層波及モデルを完全維持。
- **是正根拠**: 循環依存の完全排除、一方向な順序DAGの確立、および FND-ODP-008 非循環性の回復。
- **修正ファイル**: `10_OWNER_DECISION_RECORD_TEMPLATE_R1_8.md`, `00_OWNER_EXECUTIVE_SUMMARY_R1_8.md`, `11_INDEPENDENT_REVIEW_HANDOFF_R1_8.md`
- **残存事項**: なし（文書契約として完成。Runtime 実装・実証は将来の実行基盤の責務）。

---

## 3. 非退行性および整合性確認結果

1. **既存 10 件の解決済み Finding に対する非退行性**:
   - FND-ODP-001（単一Stage契約）、FND-ODP-002（権限分離）、FND-ODP-003（Git検証・原因未確定）、FND-ODP-004（concurrency=1定義）、FND-ODP-005（診断実験事前明示承認）、FND-ODP-006（読取リスク・パス相対化）、FND-ODP-007-R13-A（判断区分 Authority 一致）、FND-ODP-007-R15-001（LP-A 順序契約）、FND-ODP-007-R15-002（Attempt 状態整合性）、FND-ODP-008（STOP 3段階非循環Gate回復）のすべてについて、整合性を維持（`NON_REGRESSION_PASS`）。
2. **静的反証ケース（T01〜T25）**:
   - T01〜T25 の全ケースについて、Preconditions、Applicable Scope、Clearance State、Expected Decision、Fail-closed Result、Runtime Evidence Required を規定し、循環依存が存在しないことを静的に確認。
3. **署名欄・判断欄の保護**:
   - `10_OWNER_DECISION_RECORD_TEMPLATE_R1_8.md` 内の全 8 意思決定項目の判断値・署名・日付はすべて未記入を維持。
