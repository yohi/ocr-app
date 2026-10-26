# 16. R1.2 から R1.3 への是正登録簿（R1.2 to R1.3 Limited Correction Register）

## 1. 概要

本書は、G1-D1 Human Owner Decision Package R1.2 に対する独立再レビューで検出された残存 Finding（FND-ODP-007: Major / PARTIAL）について、その修正前後の比較、是正根拠、修正対象ファイル、および残存事項を記録した是正登録台帳です。

---

## 2. FND-ODP-007 是正詳細

### FND-ODP-007: 外部 Owner Decision Record の発効判定式および実行回数安全消費契約の完成（重要度: Major）
- **修正前 (R1.2)**:
  - 外部判断記録の 11 項目発効判定式において、署名の真正性は確認されていたが、「Owner の判断内容が明示的に肯定的承認（`APPROVE` / `CONDITIONAL_APPROVE`）であること」および「記録状態が `EFFECTIVE` であること」が独立した必須論理条件として明示されていなかった。このため、署名付きの `HOLD` や `REJECT`、あるいは `ISSUED` / `DRAFT` 状態の記録が誤って実行可能と解釈される危険があった。
  - 実行回数の消費タイミングが「実行完了時」のように読める余地があり、プロセスの中断・ハング・強制終了時に回数が未消費のまま再使用されるリスクが存在した。
- **修正後 (R1.3)**:
  - 実行資格判定式に以下の 3 条件を追加し、既存 11 条件をすべて維持した**全 14 条件論理積**として完成：
    1. **`OWNER_DECISION_IS_APPROVAL`**: `owner_decision` が明示的に `APPROVE` または `CONDITIONAL_APPROVE` であること。`HOLD` / `REJECT` の場合は署名が真正であっても `DECISION_NOT_APPROVING / NO_EXECUTION_GRANT` として実行遮断。
    2. **`RECORD_STATUS_EFFECTIVE`**: `record_status` が厳密に `EFFECTIVE` であること。`DRAFT`, `ISSUED`, `EXPIRED`, `REVOKED`, `INVALID` 等は実行不可。
    3. **`CONDITIONAL_APPROVAL_CONDITIONS_SATISFIED`**: 条件付き承認の場合、付帯条件が具体的に記録され、対応する条件充足証跡のハッシュ突合により全条件が充足されていること。未充足時は `CONDITION_PENDING / NO_EXECUTION_GRANT`。無条件承認の場合は追加条件が存在しないことを確認した上で充足扱いとする。
  - 実行回数の消費契約を「実行完了時」から「**実行開始権割当時（Slot Reservation）**」へ是正。
    - 実行開始前に残量を確認し、実行枠の確定的割当（減算）を行った上で起動を許可。
    - 実行失敗・タイムアウト等による回数の自動返却（ロールバック）を永久禁止。
    - 単一承認記録に対する二重割当を排除（`AT_MOST_ONCE_EXECUTION_SLOT_ALLOCATION`）。
    - 結果不明時はフェイルクローズ（再開停止）。
    - Runtime 実証については文書上の契約定義（`DOCUMENTARY_CONTRACT_ONLY / RUNTIME_NOT_VERIFIED`）である旨を明記。
- **是正根拠**: 承認意味論の厳密化、無効・拒否記録の実行遮断、および同一実行枠の二重使用防止。
- **修正ファイル**: `10_OWNER_DECISION_RECORD_TEMPLATE_R1_3.md`, `00_OWNER_EXECUTIVE_SUMMARY_R1_3.md`, `11_INDEPENDENT_REVIEW_HANDOFF_R1_3.md`
- **残存事項**: なし（FND-ODP-007 完全解消）。
