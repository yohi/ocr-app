# 17. R1.3 から R1.4 への是正登録簿（R1.3 to R1.4 Limited Correction Register）

## 1. 概要

本書は、G1-D1 Human Owner Decision Package R1.3 に対する独立再レビューで検出された FND-ODP-007 の残存 3 点（FND-ODP-007-R13-A: 判断区分の単一Authority、FND-ODP-007-R13-B: 競合線形化と実行開始フェンス、FND-ODP-007-R13-C: 3層状態モデル分離）について、その修正前後の比較、是正根拠、修正対象ファイル、および残存事項を記録した是正登録台帳です。

---

## 2. 残存 3 点の是正詳細

### FND-ODP-007-R13-A: 判断区分の単一 Authority および整合性の必須化（重要度: Major）
- **修正前 (R1.3)**:
  - `decision_disposition` と `owner_decision` の 2 つのフィールドが存在したが、発効判定式は `owner_decision` のみを参照していた。そのため、`decision_disposition = HOLD` かつ `owner_decision = APPROVE` のような不一致・矛盾が存在しても明示的に拒絶できず、実行権限が生成される危険があった。
- **修正後 (R1.4)**:
  - `owner_decision` を判断値の単一の正本 Authority と位置付け、`DECISION_DISPOSITION_CONSISTENT`（`decision_disposition == owner_decision`）を必須条件として明記。
  - 発効判定式を**全 15 条件の論理積**として厳密に定義し、不一致・欠落・未定義値の場合は直ちに `DECISION_INCONSISTENT / NO_EXECUTION_GRANT` として実行資格を遮断する契約を確立。
- **是正根拠**: 判断区分の二重表現による矛盾の排除とフェイルクローズの徹底。
- **修正ファイル**: `10_OWNER_DECISION_RECORD_TEMPLATE_R1_4.md`, `00_OWNER_EXECUTIVE_SUMMARY_R1_4.md`, `11_INDEPENDENT_REVIEW_HANDOFF_R1_4.md`
- **残存事項**: なし。

---

### FND-ODP-007-R13-B: 承認取消・失効と Slot Reservation の競合制御および開始直前フェンス（重要度: Major）
- **修正前 (R1.3)**:
  - 実行資格確認とスロット予約が時系列で別個のステップとして記載されていたため、適格性確認直後に承認取消が行われた場合、古い適格性判定に基づいてスロットが予約される競合窓が存在した。また、予約成功後に取消が発生した場合の起動制御が不明確であった。
- **修正後 (R1.4)**:
  - 線形化予約境界（`AUTHORIZATION_AND_RESERVATION_LINEARIZATION`）を導入し、最新の承認状態・取消有無・残回数の確認と実行枠引当をアトミックに確定する契約を要求。二重予約や競合順序不明をフェイルクローズ化。
  - 実行起動直前の防護柵として `EXECUTION_START_FENCE` を定義。予約確定後からプロセス起動までの間に承認取消や STOP が成立していた場合、起動を安全側に阻止（`START_DENIED`）し、消費スロットの自動返却を禁止。
  - 本契約は文書上の規範的契約定義（`DOCUMENTARY_CONTRACT_ONLY / RUNTIME_LINEARIZABILITY_NOT_VERIFIED`）である旨を明記。
- **是正根拠**: 並行競合時における古い認可状態の利用防止と起動直前の安全防御。
- **修正ファイル**: `10_OWNER_DECISION_RECORD_TEMPLATE_R1_4.md`, `00_OWNER_EXECUTIVE_SUMMARY_R1_4.md`, `11_INDEPENDENT_REVIEW_HANDOFF_R1_4.md`
- **残存事項**: なし（文書契約として完成）。

---

### FND-ODP-007-R13-C: 3層状態モデルの完全分離と消費・失効の区別（重要度: Major）
- **修正前 (R1.3)**:
  - スロット予約確定時に `record_status` を `EXPIRED` に変更する契約が記載されていたため、「承認自体の法性・有効性」と「実行枠の消費状態」が混同され、予約済みスロットに基づく実行開始の正当性が不明確になっていた。
- **修正後 (R1.4)**:
  - 「Decision Record Status（承認の有効性: DRAFT/ISSUED/EFFECTIVE/EXPIRED/REVOKED等）」「Execution Slot Status（予約消費枠: NOT_ALLOCATED/RESERVED/START_CONSUMED等）」「Execution Attempt Status（実行試行: NOT_STARTED/STARTED/COMPLETED等）」の 3 つの状態機械へ完全に分離。
  - `EXPIRED` は承認の時間的有効期限切れのみを表し、回数消費を表さないことを明確化。回数残量は Execution Slot の割当可能残数で管理。
  - 予約済みスロット（`RESERVED`）は新規予約を拒否するが開始フェンス通過により実行可能。開始時点で `START_CONSUMED` へ遷移し二重開始を禁止。結果不明（UNKNOWN）や失敗時の自動返却を永久禁止。
- **是正根拠**: 状態機械の責務分離とライフサイクルの明確化。
- **修正ファイル**: `10_OWNER_DECISION_RECORD_TEMPLATE_R1_4.md`, `00_OWNER_EXECUTIVE_SUMMARY_R1_4.md`, `11_INDEPENDENT_REVIEW_HANDOFF_R1_4.md`
- **残存事項**: なし。
