# 13. R0 から R1 への是正登録簿（R0 to R1 Finding Correction Register）

## 1. 概要

本書は、G1-D1 Human Owner Decision Package R0 に対する独立レビューで検出された 8 件の Finding（FND-ODP-001〜008）について、その修正前後の比較、是正根拠、修正対象ファイル、および残存事項を記録した是正登録台帳です。

---

## 2. 8件の Finding 是正詳細

### FND-ODP-001: DEC-03承認方式の矛盾解消（重要度: Major）
- **修正前 (R0)**:
  - 推奨が `CONDITIONAL_APPROVE / Method A` と記載されている一方、Decision Options の選択肢定義において `APPROVE` が Method A に、`CONDITIONAL_APPROVE` が Method B に固定対応していた。このため、条件付き承認を選択すると自動的に Method B（連続進行）の権限が解釈される危険があった。
- **修正後 (R1)**:
  - `Approval Method`（`METHOD_A_STAGE_BY_STAGE` / `METHOD_B_CONDITIONAL_PROGRESSION`）と `Decision Disposition`（`APPROVE` / `CONDITIONAL_APPROVE` / `HOLD` / `REJECT`）、および `Authorized Scope`（対象Stage）を完全に独立した選択フィールドに分離。
  - 未指定時は `AUTHORIZATION_INCOMPLETE / NO_EXECUTION_GRANT` となる安全契約を導入。
- **是正根拠**: 人間の承認意図と実行権限の一意な対応付け。
- **修正ファイル**: `01_DECISION_MATRIX_R1.csv`, `04_DEC_03_EXECUTION_RESOURCES_R1.md`, `09_APPROVAL_DEPENDENCY_AND_SEQUENCE_R1.md`, `10_OWNER_DECISION_RECORD_TEMPLATE_R1.md`
- **残存事項**: なし（完全に分離）。

---

### FND-ODP-002: DEC-01BとStage 1実行権限の分離（重要度: Major）
- **修正前 (R0)**:
  - DEC-01B の許可操作範囲に、特定パッケージの転送だけでなく `npm ci --offline --ignore-scripts` の実行が含まれていた。これは Stage 1 の実行権限と重複・混同していた。
- **修正後 (R1)**:
  - 調査（DEC-01A）、転送（DEC-01B）、インストール実行（DEC-03 Stage 1）の3つを明確に分離。
  - `DEC-01B APPROVED` は `npm ci` の実行を許可しないことを禁止事項に明記。Stage 1 の実行には DEC-03（Stage 1）の明示承認を必須とした。
- **是正根拠**: 境界越境操作（転送）と実行権限（`npm ci`）の責務分離。
- **修正ファイル**: `02_DEC_01_DEPENDENCY_TRANSFER_R1.md`, `04_DEC_03_EXECUTION_RESOURCES_R1.md`, `09_APPROVAL_DEPENDENCY_AND_SEQUENCE_R1.md`, `01_DECISION_MATRIX_R1.csv`
- **残存事項**: なし。

---

### FND-ODP-003: Git固定HEAD再現方式とオブジェクト検証契約（重要度: Moderate）
- **修正前 (R0)**:
  - `git init` とファイル配置だけで固定HEADが再現可能であるかのように読め、SHA-256 と Git Object ID（40桁 SHA-1）の混同が見られた。また、3件PASSだけで環境原因が確定すると読める余地があった。
- **修正後 (R1)**:
  - commit, tree, blob オブジェクトの来歴検証、バイト同一性、インデックス整合性、hooks無効化、リモート未設定を含む10要件を策定。
  - 40桁 Git Object ID を SHA-256 と呼ぶことを禁止。オブジェクト来歴未検証時は `GIT_OBJECT_PROVENANCE_NOT_ESTABLISHED` と規定。Group B の失敗原因は公式に `CAUSE_UNDETERMINED` を維持。
- **是正根拠**: Gitオブジェクト整合性の厳密化と反証可能性の担保。
- **修正ファイル**: `03_DEC_02_LOCAL_GIT_R1.md`
- **残存事項**: なし。

---

### FND-ODP-004: 実行単位の正確な表現とテスト並列度の定義（重要度: Moderate）
- **修正前 (R0)**:
  - 「単一プロセスで実行」という曖昧な表現が用いられ、Node CLI のファイル並列度と子プロセス・非同期処理が混同されていた。また既存の失敗/キャンセル件数がテスト総数と混同されるリスクがあった。
- **修正後 (R1)**:
  - `--test-concurrency=1` を「Node.js CLI テストランナーが同時に並行実行するテストファイル数の上限を1とすること」と定義。
  - cgroup メモリ制限、PID制限、タイムアウト、非同期・子プロセス制御の4領域の責務を厳密に分離。既存件数（Group B: 3件, Group C: 6件）はファイル内総件数とは別個の追跡対象と明記。
- **是正根拠**: リソース制御の責務境界明確化。
- **修正ファイル**: `04_DEC_03_EXECUTION_RESOURCES_R1.md`, `09_APPROVAL_DEPENDENCY_AND_SEQUENCE_R1.md`
- **残存事項**: なし。

---

### FND-ODP-005: 診断実験の事前承認表現の是正（重要度: Moderate）
- **修正前 (R0)**:
  - DEC-05/06 の禁止事項に「事前承認」と記載されていたが、本来は実験開始前の Owner 明示承認が必須であり、表現が矛盾していた。
- **修正後 (R1)**:
  - 禁止事項を「無条件包括事前承認 (`UNCONDITIONAL_ADVANCE_APPROVAL`)」と再定義し、必須要件を「実験開始前の明示的個別承認 (`EXPLICIT_PRE_EXECUTION_OWNER_APPROVAL`)」と定義して矛盾を解消。
- **是正根拠**: 意図しない包括承認の排除と、事前の個別統制の確立。
- **修正ファイル**: `00_OWNER_EXECUTIVE_SUMMARY_R1.md`, `01_DECISION_MATRIX_R1.csv`, `06_DEC_05_06_DIAGNOSTIC_EXPERIMENTS_R1.md`
- **残存事項**: なし。

---

### FND-ODP-006: リスク評価・調査範囲・内部パスの是正（重要度: Moderate）
- **修正前 (R0)**:
  - 「完全排除」「リスクゼロ」「必ず安全」といった過剰な断定表現が存在した。また DEC-01A 読取調査のリスクが未記載で、ホスト固有絶対パス（`file:///home/...`）が露出していた。
- **修正後 (R1)**:
  - リスク評価を客観判定ステータス（`MITIGATED`, `RESIDUAL_RISK_REMAINS`, `EXECUTION_NOT_VERIFIED` 等）へ是正。
  - DEC-01A の読取対象パス限定・秘密情報除外・I/O負荷に関する調査契約を明記。
  - 文書内のホスト固有絶対パスをすべてリポジトリ相対パス（`.github/workflows/...`）へ置換。
- **是正根拠**: 証拠に基づく客観的記述と可搬性の向上。
- **修正ファイル**: `02_DEC_01_DEPENDENCY_TRANSFER_R1.md`, `03_DEC_02_LOCAL_GIT_R1.md`, `06_DEC_05_06_DIAGNOSTIC_EXPERIMENTS_R1.md`, `08_RISK_REGISTER_R1.md`
- **残存事項**: なし。

---

### FND-ODP-007: Owner承認記録の対象識別追加（重要度: Major）
- **修正前 (R0)**:
  - Owner 判断記録テンプレートにおいて、どのパッケージ版、どの固定HEAD、どの証跡に対する承認であるかのバインディングが不足していた。改訂後の誤適用リスクがあった。
- **修正後 (R1)**:
  - Decision Record ID、Package Revision、Package SHA-256、Fixed Repository、Fixed HEAD、審査文書一覧、失効条件をテンプレートに必須バインディングとして追加。
  - 必須項目未記入時は `AUTHORIZATION_INCOMPLETE / NO_EXECUTION_GRANT` となる規定を導入。
- **是正根拠**: 承認記録のトレーサビリティおよび誤適用防止。
- **修正ファイル**: `10_OWNER_DECISION_RECORD_TEMPLATE_R1.md`, `01_DECISION_MATRIX_R1.csv`, `11_INDEPENDENT_REVIEW_HANDOFF_R1.md`
- **残存事項**: なし。

---

### FND-ODP-008: DEC-07 STOP再開承認の一意化と条件付き承認の扱い（重要度: Moderate）
- **修正前 (R0)**:
  - STOP 後の「調査」「修復」「再実行」が混同され、条件付き承認によって未充足条件のまま再実行できるかのように読める余地があった。
- **修正後 (R1)**:
  - 調査、修復、再実行の3操作を明確に分離。
  - 条件付き承認は未充足状態での再実行を許可せず、`CONDITION_PENDING / EXECUTION_BLOCKED` となることを明記。10条件すべての客観的充足検証を再開の絶対前提とした。
- **是正根拠**: STOP 発生時の安全停止原則の堅持。
- **修正ファイル**: `07_DEC_07_STOP_RESUME_R1.md`, `09_APPROVAL_DEPENDENCY_AND_SEQUENCE_R1.md`, `10_OWNER_DECISION_RECORD_TEMPLATE_R1.md`
- **残存事項**: なし。
