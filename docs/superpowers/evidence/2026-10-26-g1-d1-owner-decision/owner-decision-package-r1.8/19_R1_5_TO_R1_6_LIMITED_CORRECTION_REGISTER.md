# 19. R1.5 から R1.6 への限定是正登録簿（R1.5 to R1.6 Limited Correction Register）

## 1. 概要

本書は、G1-D1 Human Owner Decision Package R1.5 に対する独立再レビューで検出された FND-ODP-007 の残存 3 点（**FND-ODP-007-R15-001**: FENCED_PROCESS_ADMISSION と取消・STOP の競合順序契約、**FND-ODP-007-R15-002**: LP-S 後・実起動前の Execution Attempt 状態整合性、**FND-ODP-007-R15-003**: STOP 中の新規 Slot 予約禁止と 16 条件論理積）について、その修正前後の比較、是正根拠、修正対象ファイル、および残存事項を記録した限定是正登録台帳です。

---

## 2. 残存 3 点の是正詳細

### FND-ODP-007-R15-001: FENCED_PROCESS_ADMISSION と取消・STOP の競合順序契約（重要度: Major）
- **修正前 (R1.5)**:
  - LP-R、LP-S、および FENCED_PROCESS_ADMISSION を分離していたが、FENCED_PROCESS_ADMISSION での検証完了後から実際の OS プロセス起動（exec）までの間に取消や STOP が成立した場合の不可分な調停契約が不十分であり、未仲介の実行可能区間が存在し得た。
- **修正後 (R1.6)**:
  - **保護されたプロセス入場境界（`PROTECTED_PROCESS_ADMISSION_BOUNDARY`）** および第3線形化点 **`LP-A: PROTECTED_ADMISSION_LINEARIZATION_POINT`** を規範的に確立。
  - 取消・STOP の状態確認と保護された起動許可適用の間に未仲介の実行可能区間が存在してはならない規範的要求を定義。
  - プロセスオブジェクト作成、OS プロセス起動、保護対象操作の実行許可、実際の保護操作開始を明確に区別し、**LP-A 確定合格による実行許可適用のみを権限付き実行開始（`STARTED`）と定義**。
  - LP-A と取消・STOP の競合順序（先行確定時の拒絶、順序特定不能時の fail-closed: `UNKNOWN / BLOCKED`）を厳格に規定。
  - `PROTECTED_ADMISSION_MEDIATION_NOT_ESTABLISHED => NO_EXECUTION_GRANT` および免責事項（`DOCUMENTARY_CONTRACT_ONLY`）を明示。
- **是正根拠**: プロセス起動直前における認可レース条件の完全排除と未仲介実行経路の遮断。
- **修正ファイル**: `10_OWNER_DECISION_RECORD_TEMPLATE_R1_6.md`, `00_OWNER_EXECUTIVE_SUMMARY_R1_6.md`, `11_INDEPENDENT_REVIEW_HANDOFF_R1_6.md`
- **残存事項**: なし（文書契約として完成。Runtime 実装・実証は将来の実行基盤の責務）。

---

### FND-ODP-007-R15-002: LP-S 後・実起動前の Execution Attempt 状態整合性（重要度: Major）
- **修正前 (R1.5)**:
  - LP-S 成功時に `Execution Attempt` を `NOT_STARTED -> STARTED` へ遷移させていたため、LP-S 成功後・実プロセス起動前に取消や STOP が発生した場合に、プロセスが起動されていないにもかかわらず Attempt が `STARTED` になる論理的矛盾が存在した。
- **修正後 (R1.6)**:
  - 開始権消費（LP-S）と保護された実行開始（LP-A）を分離。
  - LP-S 成功直後の Attempt 状態を **`START_AUTHORIZED_PENDING_ADMISSION`** と定義。
  - LP-A 確定合格時のみ **`STARTED`** へ遷移する契約を確立。
  - LP-A において取消・STOP 等で入場拒絶された場合は **`LAUNCH_ABORTED`**、成否不明時は **`UNKNOWN`** へ遷移。
  - スロットはすでに `START_CONSUMED` であり、`LAUNCH_ABORTED` や `UNKNOWN` からの自動再試行・スロット自動返却を永久禁止。
- **是正根拠**: 状態機械の責務と意味の一意性確立、およびプロセス未起動時の `STARTED` 誤表示の排除。
- **修正ファイル**: `10_OWNER_DECISION_RECORD_TEMPLATE_R1_6.md`, `00_OWNER_EXECUTIVE_SUMMARY_R1_6.md`, `11_INDEPENDENT_REVIEW_HANDOFF_R1_6.md`
- **残存事項**: なし。

---

### FND-ODP-007-R15-003: STOP 中の新規 Slot 予約禁止と 16 条件論理積（重要度: Major）
- **修正前 (R1.5)**:
  - STOP 発生時に既存実行を停止する契約は存在したが、`RESERVATION_ELIGIBLE` の 15 条件には STOP 状態を直接照合する独立条件がなく、回数残量がある場合に STOP 中でも新規スロット予約が可能となる論理的間隙が存在した。
- **修正後 (R1.6)**:
  - 独立判定条件 **`NO_ACTIVE_STOP`** を導入し、スロット予約適格性判定式を **全 16 条件の論理積** へ更新。
  - `NO_ACTIVE_STOP = FALSE` または STOP 状態不明（`STOP_STATE_UNKNOWN`）時は、即座に **`RESERVATION_DENIED / NO_EXECUTION_GRANT`** としてスロット予約を遮断する fail-closed を確立。
  - LP-R（予約）、LP-S（開始権消費）、LP-A（入場調停）の全 3 境界において STOP 判定を一貫して整合。
  - 既存 DEC-07 の STOP 再開 Gate（Phase A/B/C）との非循環契約を完全に維持。
- **是正根拠**: STOP 中における未承認実行枠確保の完全遮断と全実行境界での安全停止保証。
- **修正ファイル**: `10_OWNER_DECISION_RECORD_TEMPLATE_R1_6.md`, `00_OWNER_EXECUTIVE_SUMMARY_R1_6.md`, `11_INDEPENDENT_REVIEW_HANDOFF_R1_6.md`
- **残存事項**: なし。

---

## 3. 非退行性および整合性確認結果

1. **既存 8 件の解決済み Finding に対する非退行性**:
   - FND-ODP-001（単一Stage契約）、FND-ODP-002（権限分離）、FND-ODP-003（Git検証・原因未確定）、FND-ODP-004（concurrency=1定義）、FND-ODP-005（診断実験事前明示承認）、FND-ODP-006（読取リスク・パス相対化）、FND-ODP-007-R13-A（判断区分 Authority 一致）、FND-ODP-008（STOP 3段階非循環Gate）のすべてについて、変更なしまたは整合性を維持（`NON_REGRESSION_PASS`）。
2. **静的反証ケース（T01〜T25）**:
   - T01〜T25 の全ケースについて、Preconditions、Competing Events、Required Ordering、Expected Decision、Fail-closed Outcome、Runtime Evidence Required を規定し、完全な論理的一貫性を確認。
3. **署名欄・判断欄の保護**:
   - `10_OWNER_DECISION_RECORD_TEMPLATE_R1_6.md` 内の全 8 意思決定項目の判断値・署名・日付はすべて未記入を維持。
