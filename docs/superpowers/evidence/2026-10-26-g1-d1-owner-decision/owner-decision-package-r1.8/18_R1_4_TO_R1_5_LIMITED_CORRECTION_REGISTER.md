# 18. R1.4 から R1.5 への限定是正登録簿（R1.4 to R1.5 Limited Correction Register）

## 1. 概要

本書は、G1-D1 Human Owner Decision Package R1.4 に対する独立再レビューで検出された FND-ODP-007 の残存 2 点（**FND-ODP-007-R13-B**: Execution Start Fence と実際のプロセス起動との競合、**FND-ODP-007-R13-C**: 予約前後の適格性判定、および Decision Record / Slot / Attempt の状態整合性）について、その修正前後の比較、是正根拠、修正対象ファイル、および残存事項を記録した限定是正登録台帳です。

---

## 2. 残存 2 点の是正詳細

### FND-ODP-007-R13-B: 2つの線形化点（LP-R / LP-S）の明確な区別とプロセス起動防御柵の確立（重要度: Major）
- **修正前 (R1.4)**:
  - 単一の「線形化予約境界」と「実行開始フェンス（`EXECUTION_START_FENCE`）」の記述にとどまっており、開始フェンスを通過した後の実際の OS プロセス起動（exec）との境界、および起動直前の競合（フェンス合格後・プロセス起動前の取消や STOP）に対する物理的防御機構との関係が曖昧であった。
- **修正後 (R1.5)**:
  - **スロット予約線形化点（`LP-R: RESERVATION_LINEARIZATION_POINT`）** と **実行開始線形化点（`LP-S: EXECUTION_START_LINEARIZATION_POINT`）** の 2 つの線形化点を明確に分離。
  - LP-S 通過後の第3境界として **`FENCED_PROCESS_ADMISSION`（プロセス起動防御柵）** を明示的に定義。
  - LP-S を通過してスロットが `START_CONSUMED` に遷移した後であっても、実際の OS プロセス起動前に取消や STOP が発生した場合には、プロセス起動防御柵により物理的プロセス起動を確実に阻止（`PROCESS_LAUNCH_ABORTED / FAIL_CLOSED`）し、消費スロットの自動返却・再利用を永久禁止する多層防御契約を完成。
  - ランタイム免責条項を `DOCUMENTARY_CONTRACT_ONLY / RUNTIME_START_FENCING_NOT_VERIFIED` として再定義。
- **是正根拠**: プロセス起動直前における認可レース条件の完全排除と、多層防護による未承認実行の防止。
- **修正ファイル**: `10_OWNER_DECISION_RECORD_TEMPLATE_R1_5.md`, `00_OWNER_EXECUTIVE_SUMMARY_R1_5.md`, `11_INDEPENDENT_REVIEW_HANDOFF_R1_5.md`
- **残存事項**: なし（文書契約として完成。Runtime 実装・実証は将来の実行基盤の責務）。

---

### FND-ODP-007-R13-C: 予約前後の適格性判定分離と状態整合性（重要度: Major）
- **修正前 (R1.4)**:
  - 第 5 節の発効判定式 `EXECUTION_ELIGIBLE` が予約時と開始時で共通の全15条件となっており、条件13 `EXECUTION_LIMIT_NOT_EXCEEDED`（未消費スロット残存）が含まれていた。そのため、スロット予約によって残数が 0 になった場合、予約済みスロットの実行開始時に「残数 0」によって自己否定される論理矛盾の余地があった。
  - また、第 7 節では回数消費による `EXPIRED` への変質を否定していたにもかかわらず、第 9 節の失効条件一覧に「スロット割当完了」が失効事由として残存しており、文書間で矛盾していた。
- **修正後 (R1.5)**:
  - 適格性判定を **スロット予約適格性（`RESERVATION_ELIGIBLE`: 全15条件）** と **実行開始適格性（`START_ELIGIBLE(slot_id)`: スロット単位の正当性・未消費性判定）** の 2 段階に厳密に分離。
  - `START_ELIGIBLE` では `EXECUTION_LIMIT_NOT_EXCEEDED`（未割当スロット残数 > 0）を再評価せず、予約された当該スロット自体が `RESERVED` かつ未消費であることを検証する論理構成へ是正。
  - 第 9 節を改訂し、「9.1 判断記録の失効・無効化事由（Record Status -> REVOKED / EXPIRED / INVALID）」から「スロット割当完了」を完全に除外。「9.2 スロット枯渇時の取扱」を新設し、スロット枯渇時も `record_status` は `EFFECTIVE` を維持し、単に新規スロット予約（LP-R）のみが禁止される契約を徹底。
- **是正根拠**: スロット予約確定後における開始権の正当性確保と、3層状態モデルおよび失効契約の完全な論理的一致。
- **修正ファイル**: `10_OWNER_DECISION_RECORD_TEMPLATE_R1_5.md`, `00_OWNER_EXECUTIVE_SUMMARY_R1_5.md`, `11_INDEPENDENT_REVIEW_HANDOFF_R1_5.md`
- **残存事項**: なし。

---

## 3. 非退行性および整合性確認結果

1. **既存 8 件の解決済み Finding に対する非退行性**:
   - FND-ODP-001（単一Stage契約）、FND-ODP-002（権限分離）、FND-ODP-003（Git検証・原因未確定）、FND-ODP-004（concurrency=1定義）、FND-ODP-005（診断実験事前明示承認）、FND-ODP-006（読取リスク・パス相対化）、FND-ODP-007-R13-A（判断区分 Authority 一致）、FND-ODP-008（STOP 3段階非循環Gate）のすべてについて、変更なしまたは整合性を維持（`NON_REGRESSION_PASS`）。
2. **静的反証ケース（T01〜T20）**:
   - T01〜T20 の全ケースについて、2段階適格性および2線形化点＋起動防御柵に整合するよう期待判定を更新し、完全な論理的一貫性を確認。
3. **署名欄・判断欄の保護**:
   - `10_OWNER_DECISION_RECORD_TEMPLATE_R1_5.md` 内の全 8 意思決定項目の判断値・署名・日付はすべて未記入を維持。
