# 20. R1.6 から R1.7 への限定是正登録簿（R1.6 to R1.7 Limited Correction Register）

## 1. 概要

本書は、G1-D1 Human Owner Decision Package R1.6 に対する独立再レビューで指摘された FND-ODP-007 の残存 1 点（**FND-ODP-007-R15-003**: Execution Slot または Execution Attempt で発生した STOP が、親の Owner Decision Record、関連 Stage・VM・実行環境の新規予約・実行開始資格へ及ぼす影響の完全規範化）について、その修正前後の比較、是正根拠、修正対象ファイル、および残存事項を記録した限定是正登録台帳です。

---

## 2. 是正詳細

### FND-ODP-007-R15-003: STOP 適用範囲の 6 階層識別・親子結合および双方向波及規則の規範化（重要度: Major）
- **修正前 (R1.6)**:
  - `NO_ACTIVE_STOP` を独立条件として追加し 16 条件論理積としたが、STOP 対象が Record, Stage, VM, Environment の 4 レベルにとどまり、Execution Slot や Execution Attempt に直接発生した STOP の取り扱いが不十分であった。
  - Attempt や Slot に STOP が発生した場合に、親 Decision Record に未消費残回数が残っていると新規スロット予約が可能となる解釈の余地が残存していた。また、狭い解除判断で広域 STOP が解除されるリスクに対する規範契約が未充足であった。
- **修正後 (R1.7)**:
  - STOP の適用範囲を **6 階層（Attempt, Slot, Record, Stage, VM, Environment）** で識別するスキーマ（`stop_id`, `stop_scope_type`, `stop_scope_identifier`, `source_attempt_id`, `source_slot_id`, `decision_record_id`, `stage_id`, `vm_identifier`, `environment_identifier`, `stop_reason`, `stop_effective_state`, `stop_evidence_id`, `stop_evidence_sha256`, `stop_clearance_record_id`, `stop_clearance_status`）を確立。
  - 論理的親子結合モデル（Environment -> VM -> Stage -> Decision Record -> Execution Slot -> Execution Attempt）を明定。
  - **子から親への波及**: Attempt または Slot に有効な STOP が存在する場合、**結合親 Decision Record による新規スロット予約（LP-R）を即座に遮断（残回数があっても予約拒絶: `RESERVATION_DENIED`）** する契約を確立。
  - **親から子への波及**: 親 Decision Record, Stage, VM, Environment に STOP が存在する場合、配下の全 Slot / Attempt の開始（LP-S）および保護入場（LP-A）を全面遮断。
  - **状態分離の維持**: Attempt STOP が発生しても親 Decision Record の `record_status` を `REVOKED` や `EXPIRED` に書き換えず、`EFFECTIVE` を維持したまま `NO_ACTIVE_STOP` 判定によって安全側に予約を遮断する契約を徹底。
  - **解除範囲の厳格化**: Attempt / Slot 単位の解除で広域 STOP を解除することを禁止し、DEC-07 非循環 Gate（Phase A/B/C）との完全整合を確立。
  - `NO_ACTIVE_STOP` を再定義し、**全 16 条件論理積** を維持。
- **是正根拠**: 下位で発生した安全停止事由の確実な親波及による迂回予約の排除、および全階層での安全停止契約の完全化。
- **修正ファイル**: `10_OWNER_DECISION_RECORD_TEMPLATE_R1_7.md`, `00_OWNER_EXECUTIVE_SUMMARY_R1_7.md`, `11_INDEPENDENT_REVIEW_HANDOFF_R1_7.md`
- **残存事項**: なし（文書契約として完成。Runtime 実装・実証は将来の実行基盤の責務）。

---

## 3. 非退行性および整合性確認結果

1. **既存 10 件の解決済み Finding に対する非退行性**:
   - FND-ODP-001（単一Stage契約）、FND-ODP-002（権限分離）、FND-ODP-003（Git検証・原因未確定）、FND-ODP-004（concurrency=1定義）、FND-ODP-005（診断実験事前明示承認）、FND-ODP-006（読取リスク・パス相対化）、FND-ODP-007-R13-A（判断区分 Authority 一致）、FND-ODP-007-R15-001（LP-A 順序契約）、FND-ODP-007-R15-002（Attempt 状態整合性）、FND-ODP-008（STOP 3段階非循環Gate）のすべてについて、変更なしまたは整合性を維持（`NON_REGRESSION_PASS`）。
2. **静的反証ケース（T01〜T25）**:
   - T01〜T25 の全ケースについて、Preconditions、STOP Scope、Parent/Child Binding、Expected Decision、Fail-closed Outcome、Runtime Evidence Required を規定し、完全な論理的一貫性を確認。
3. **署名欄・判断欄の保護**:
   - `10_OWNER_DECISION_RECORD_TEMPLATE_R1_7.md` 内の全 8 意思決定項目の判断値・署名・日付はすべて未記入を維持。
