# 11. 独立再レビューハンドオフ（Independent Re-review Handoff R1.8）

## 1. 独立再レビューの目的とスコープ

本ハンドオフ文書は、最終限定是正された「**G1-D1 Human Owner Decision Package (R1.8)**」について、独立した技術レビュアーが R1.7 再レビューで指摘された **FND-ODP-R17-001**（STOP 解除条件と DEC-07 Phase C の循環依存）の解消状況、および既存 10 件の解決済み Finding に対する非退行性（特に FND-ODP-008 の非循環性回復）を検証し、Human Owner に提示可能な品質であることを保証するためのレビュー依頼仕様書です。

### レビュアーの責務
- FND-ODP-R17-001（`STOP_CLEARANCE_VALID` と `EXECUTION_ELIGIBLE` の分離、`NO_ACTIVE_STOP` からの Phase C 依存除去、STOP 未発生時と発生時の分岐、非循環 DAG 確立）の是正検証。
- FND-ODP-007-R15-003（STOP 6階層識別、論理的親子結合、Attempt/Slot STOP による親予約遮断、上位 STOP の下位全面遮断、STOP 波及と Record Status 変質の分離、16条件論理積維持）の是正検証。
- 解決済み Finding（FND-ODP-001〜006, FND-ODP-007-R13-A, FND-ODP-007-R15-001, FND-ODP-007-R15-002, FND-ODP-008）に対する非退行性の検証（特に FND-ODP-008 の非循環性完全回復）。
- 静的反証ケース（T01〜T25）の判定期待値・非循環性の論理的整合性検証。
- アーカイブ構造および内部ハッシュの完全性検証。

---

## 2. 重点再レビュー項目（Mandatory Re-review Matrix）

独立レビュアーは、以下の各 Finding について個別に判定を実施してください：

### 2.1 重点審査 Finding（Mandatory Review）

| Finding サブID | 重要度 | 重点審査内容 | 判定基準 |
| :--- | :--- | :--- | :--- |
| **FND-ODP-R17-001** | Major | `10_OWNER_DECISION_RECORD_TEMPLATE_R1_8.md` において、`STOP_CLEARANCE_VALID`（Phase A 修復証拠・Phase B 真正 Owner 解除判断・範囲一致・条件充足）が Phase C の完了を要求しない独立概念として定義され、`NO_ACTIVE_STOP` の定義から Phase C 完了依存が完全に除去されているか。STOP 履歴なし時と解除履歴あり時が適切に分岐し、`STOP_CLEARANCE_VALID DOES NOT IMPLY EXECUTION_ELIGIBLE` が徹底され、Phase C が適格性判定式によって独立して実行適格性を評価する非循環 DAG が確立されているか。 | `RESOLVED` / `PARTIAL` / `OPEN` / `REGRESSION` |
| **FND-ODP-007-R15-003** | Major | STOP の適用範囲が 6 階層（Attempt, Slot, Record, Stage, VM, Environment）で識別され、論理的親子結合が定義され、Attempt / Slot STOP が親 Decision Record による新規スロット予約（LP-R）を即座に遮断（残回数があっても予約拒絶）し、上位 STOP が下位の開始（LP-S）および保護入場（LP-A）を全面遮断する契約が確立されているか。全 16 条件論理積が維持されているか。 | `RESOLVED` / `PARTIAL` / `OPEN` / `REGRESSION` |

### 2.2 既存解決済み10件の非退行性判定（Mandatory Non-regression）

| Finding ID | 重要度 | 検証内容 | 判定基準 |
| :--- | :--- | :--- | :--- |
| **FND-ODP-001** | Major | Method A における単一 Stage 契約（1 Record = 1 Stage）が維持され、複数指定・範囲指定・ワイルドカードが無効化されているか。 | `NON_REGRESSION_PASS` / `REGRESSION` |
| **FND-ODP-002** | Major | DEC-01A（調査）、DEC-01B（転送）、DEC-03 Stage 1（`npm ci` 実行）の権限が分離され、DEC-01B 承認のみで `npm ci` が実行可能にならないか。 | `NON_REGRESSION_PASS` / `REGRESSION` |
| **FND-ODP-003** | Moderate | 独立ローカルGit配備において、固定HEAD（40桁 Git Object ID）のオブジェクト来歴・整合性検証が定義され、Group B 原因が `CAUSE_UNDETERMINED` に維持されているか。 | `NON_REGRESSION_PASS` / `REGRESSION` |
| **FND-ODP-004** | Moderate | `--test-concurrency=1` が「同時実行テストファイル数上限」として正確に定義され、cgroup PID や非同期処理と分離されているか。 | `NON_REGRESSION_PASS` / `REGRESSION` |
| **FND-ODP-005** | Moderate | 診断実験（DEC-05/06）において、「無条件事前包括承認の禁止」と「実験開始前の Owner 明示承認必須」が矛盾なく定義されているか。 | `NON_REGRESSION_PASS` / `REGRESSION` |
| **FND-ODP-006** | Moderate | 過剰なゼロリスク断定がなく、DEC-01A 読取リスクが明記され、ホスト固有内部絶対パスが排除されているか。 | `NON_REGRESSION_PASS` / `REGRESSION` |
| **FND-ODP-007-R13-A** | Major | `owner_decision` が単一正本 Authority となり、`DECISION_DISPOSITION_CONSISTENT`（`decision_disposition == owner_decision`）の完全一致検証が維持されているか。 | `NON_REGRESSION_PASS` / `REGRESSION` |
| **FND-ODP-007-R15-001** | Major | `LP-A: PROTECTED_ADMISSION_LINEARIZATION_POINT` および未仲介区間の排除、競合時の fail-closed（`UNKNOWN / BLOCKED`）が維持されているか。 | `NON_REGRESSION_PASS` / `REGRESSION` |
| **FND-ODP-007-R15-002** | Major | LP-S 後の Admission 待機状態 `START_AUTHORIZED_PENDING_ADMISSION`、LP-A 確定合格時のみ `STARTED` への遷移、スロット自動返却禁止が維持されているか。 | `NON_REGRESSION_PASS` / `REGRESSION` |
| **FND-ODP-008** | Major | STOP 再開 Gate において、Pre-approval（Phase A）、Owner Decision（Phase B）、Post-approval Eligibility（Phase C）の非循環 3 段階構造の非循環性が完全に回復・確立されているか。 | `NON_REGRESSION_PASS` / `REGRESSION` |

---

## 3. 重点審査領域（Focus Areas）

### 3.1 Non-circular DAG & Clearance vs. Eligibility（非循環DAGと解除・適格性の分離）
- `NO_ACTIVE_STOP` が DEC-07 Phase C の完了を前提条件としていないこと。
- Phase C が `NO_ACTIVE_STOP` を評価しても論理的な循環が発生しないこと。
- `STOP_CLEARANCE_VALID` の有効性と再実行適格性（`EXECUTION_ELIGIBLE`）が分離されており、解除承認だけで自動実行が許可されないこと。

### 3.2 STOP Branching & Scoping Rules（STOP履歴分岐と範囲規則）
- STOP 発生履歴がない場合に、架空の DEC-07 解除判断を要求せず、正規の状態確認によって `NO_ACTIVE_STOP = TRUE` となること。
- STOP 状態不明（`STOP_STATE_UNKNOWN`）時は確実に `NO_EXECUTION_GRANT` としてフェイルクローズすること。
- 狭い Attempt / Slot の解除で広域 Stage / VM / 環境 STOP が解除されないこと。

### 3.3 Linearization Points & Runtime Disclaimer（線形化点とRuntime免責事項）
- LP-R、LP-S、LP-A の各線形化点における STOP 判定が一貫していること。
- スロット自動返却禁止、自動再試行禁止が維持されていること。
- Runtime 未実証（`DOCUMENTARY_CONTRACT_ONLY`）の免責事項が明記されていること。

---
