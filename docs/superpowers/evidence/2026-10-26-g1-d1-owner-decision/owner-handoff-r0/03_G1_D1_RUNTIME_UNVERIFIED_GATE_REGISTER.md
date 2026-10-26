# 03 — G1-D1 Runtime Unverified Gate Handoff Register

> **権限**: `READ_ONLY / STATIC_DOCUMENTATION / HANDOFF_PREPARATION_ONLY / NO_EXECUTION_GRANT / NO_OWNER_AUTHORITY / NO_GATE_AUTHORITY`  
> **固定原本**: `OCR_APP_G1_D1_OWNER_DECISION_PACKAGE_R1_8_2026-10-26.tar.gz`（アップロード時のローカル名に `(1)` あり）  
> **原本 SHA-256**: `c3f318a8267b9137abae682e79a7ebe4baa635b4bc8b597108865ead7885ef2e` / **135,826 bytes**  
> **Repository**: `https://github.com/yohi/ocr-app` / **Branch**: `fix/shadow-graphql-post-scope-guards` / **Fixed HEAD**: `6b08251170265c444ce8957377e6bfca23b21fd7`  
> **原則**: 原本不変更、Owner判断代行なし、Runtime/テスト未実行、G1-D1正式Gate `BLOCKED`。
## 1. 凡例・責任境界

| フラグ | 解釈 |
|---|---|
| `DOCUMENTARY_CONTRACT_DEFINED` | R1.8静的文書中に**要件が定義されている**。動作証明ではない |
| `RUNTIME_NOT_VERIFIED` | Runtime/Host/CIでの実行・実測を**本作業では実施していない** |
| `RUNTIME_EVIDENCE_REQUIRED` | 独立Gateが実物・ログ・競合・否定ケースの証跡を受領する必要がある |

以下**全項目**の統一状態は `DOCUMENTARY_CONTRACT_DEFINED / RUNTIME_NOT_VERIFIED / RUNTIME_EVIDENCE_REQUIRED`。文書で列挙した将来の証跡取得計画は**実行指示、実行承認、試験成功の宣言ではない**。

**責任区分**: `Human Owner` は外部Decision Record、STOP解除の本人判断と正式文書クローズを行う唯一の主体。`Runtime Implementer / Host Operator` は将来の実装・実測の技術責任主体（このHandoffでは実行権限なし）。`Independent Runtime/Security Reviewer` は将来の実装・証跡評価主体。`Formal Gate Authority` は別個の正式Gate判定主体。本Handoff担当AIは権限を一切代行しない。

## 2. 未実証Gate Register

| ID / 分野 | R1.8文書契約（根拠） | 将来必要なRuntime証跡・反証 | 受入責任 | Owner/DEC依存と実行禁止条件 |
|---|---|---|---|---|
| **RT-AUTH-01** 記録真正性 | `10:§1-3,§5.2` 外部Record、7ブロック、署名真正性 | 独立署名/期限/ID/Package SHA-256/Fixed HEAD/VM/証拠ハッシュ結合の成功・改ざん失敗の証跡 | Runtime実装者→独立セキュリティレビュー | 全DEC。Owner署名原本なし、来歴不明→**BLOCK** |
| **RT-AUTH-02** 最新状態 | `10:§5.2` `OWNER_DECISION_IS_APPROVAL`、`DECISION_DISPOSITION_CONSISTENT`、`RECORD_STATUS_EFFECTIVE` | HOLD/REJECT/ISSUED/無効/取消/更新と競合する認可拒絶、正本一意性の実測ログ | 独立Runtimeレビュー | 全DEC。未承認/不一致/未確定→**BLOCK** |
| **RT-AUTH-03** 条件付き承認 | `10:L360-363,§2` 証跡1対1バインド、条件充足 | 条件ハッシュ照合、未充足/期限切れ/不一致/見かけ上承認済みの拒絶 | 独立Runtimeレビュー | CONDITIONAL_APPROVEは未充足時 `CONDITION_PENDING / NO_EXECUTION_GRANT` |
| **RT-AUTH-04** 発効回数・取消 | `10:§5-6,§9` 回数管理と取消、レコード/スロット/試行の独立状態 | 並行予約、取消競合、期限境界、Slot割当済みの再利用防止、監査台帳 | Runtime実装者＋独立競合検証 | DEC-03/07。回数不明・取消反映不能→**BLOCK** |
| **RT-LPR-01** Eligibility+Reservation | `10:L306-345,L419-430` 全16条件＋LP-R原子化 | 直前取消/STOP、競合予約、原子的残数減算/Slot-ID生成/監査順序の証跡 | 独立Runtime競合レビュー | DEC-03単一Stage。原子化なし・二重予約可能→**BLOCK** |
| **RT-LPR-02** Slot二重予約/STOP | `10:L397-411,L423-430,L606-610` 下位STOPで親Record予約遮断 | Attempt/Slot STOPが他Slotの予約を遮断、残量ありでも拒絶、状態不明時拒絶 | 独立Runtime＋STOP担当 | DEC-07解除なし/未確証STOP→**BLOCK** |
| **RT-LPS-01** 一回限り開始権 | `10:L306-345,L432-438` `START_ELIGIBLE(slot_id)`、`RESERVED→START_CONSUMED` | 予約後残数0でも正当Slotを評価、同一Slot開始並行時1件のみ、Slot/Attempt結合、消費不可逆性 | 独立Runtime競合レビュー | DEC-03、予約正当性/Slot ID不明→**BLOCK** |
| **RT-LPS-02** STOP/取消競合 | `10:L432-438,L488-515` Pending Admission遷移 | LP-S前のRevocation/STOPを拒絶、順序不明UNKNOWN/Block、LAUNCH_ABORTEDでも自動返却なし | 独立Runtime競合レビュー | STOP/失効/証跡欠如→**BLOCK** |
| **RT-LPA-01** Protected Admission | `10:L439-484` `LP-A`、`PROTECTED_PROCESS_ADMISSION_BOUNDARY` | 実OSプロセスが存在してもAdmission前にGit/ファイル/テスト操作不可能である強制機構と検証ログ | Host Operator＋独立Security Gate | DEC-03/07。`PROTECTED_ADMISSION_MEDIATION_NOT_ESTABLISHED`→**NO_EXECUTION_GRANT** |
| **RT-LPA-02** 未仲介実行経路 | `10:L457-478` Admission判断と実許可適用の不可分性 | fork/exec/子プロセス/別API経路/競合の網羅Census、未仲介プロセスの拒絶、fail-closed反証 | 独立Security Gate | 未仲介経路1件でも→**BLOCK** |
| **RT-LPA-03** Admissionの状態/競合 | `10:L441-474,L492-515` Pending→STARTEDはLP-A合格時のみ | STOP/Revocation時系列の確定、UNKNOWN時遮断、LP-A成功後STOP即停止、二重Admission拒絶 | 独立Runtime競合レビュー | Slot/Attempt不整合、取消・STOP順序不明→**BLOCK** |
| **RT-STOP-01** 6階層STOP検出 | `10:L397-411,L516-561` Attempt/Slot/Record/Stage/VM/Environment | 階層ID/親子関係、監査ログ、子→親予約遮断/親→子開始・Admission遮断の可観測実例 | STOP実装者＋独立Security Gate | DEC-07。どの階層もUNKNOWNなら**NO_EXECUTION_GRANT** |
| **RT-STOP-02** 解除有効性 | `10:L563-577` `STOP_CLEARANCE_VALID`と`EXECUTION_ELIGIBLE`分離 | Phase A/Bの署名真正性、適用範囲、取消/後続STOP、広域STOP非解除、未発生分岐の検証 | Human Owner（B判断）＋独立STOP Gate（実装受入） | Phase C合格を解除有効性の入力としない。Owner解除未署名→**BLOCK** |
| **RT-STOP-03** 非循環再開/16条件 | `10:L397-411,L578-610`; `07:§2-3` | Phase A→B→clearance→NO_ACTIVE_STOP→Phase C→LP-R/S/Aの証跡とT01-T25の将来独立反証 | 独立STOP/Runtime Gate | DEC-07＋単一Stage DEC-03。条件1件不充足→**BLOCK** |
| **RT-STOP-04** STOP状態不明 | `10:L408-411,L543-561` `STOP_STATE_UNKNOWN` fail-closed | 台帳欠落/不一致/紛失/親子ID不一致/監査中断/解除競合時の実拒絶 | 独立Security Gate | 原因不明や「観測なし」のみでSTOP_CLEAR扱い禁止 |
| **RT-HOST-01** 26コンテナ非干渉 | `00:L8-16`; `02:§3`; `08:§2` | Host 26コンテナの稼働・CPU/IO/メモリへの非干渉、隔離VM実施境界、変更ゼロの比較証跡 | Host Operator＋独立Host Gate | 全DEC。影響なしと証明できない場合→**BLOCK** |
| **RT-HOST-02** Docker Socket非共有 | `00:L14-16`; `08:§2` | Socket/ホストDocker API/特権・マウント・コンテナRuntimeアクセス不可の否定的証跡 | 独立Host/Security Gate | Socketアクセス可能、特権迂回→**BLOCK** |
| **RT-HOST-03** Secrets隔離 | `02:§3`; `03:§2`; `08:§2` | ホストSecrets/資格情報/環境変数/マウント/ログの非露出・最小権限検証 | 独立Host/Security Gate | Secrets参照可能→**BLOCK** |
| **RT-HOST-04** 外部通信遮断 | `02:§3-4`; `03:§2`; `08:§2` | VMおよび子プロセスの外部egress/DNS/メタデータアクセスdeny、経路網羅の実証 | 独立Host/Network Gate | 外部通信可能/UNKNOWN→**BLOCK** |
| **RT-HOST-05** OSプロセス・資源 | `04:§2-3`; `08:§2` | cgroup memory/PID/CPU/IO、外側60秒、Node同時ファイル数1、fork/async/OOM/timeoutSTOPの証跡 | 独立Host Gate | 候補上限の有効性未実証、失敗をPASSと誤認→**BLOCK** |
| **RT-STAGE-01** 7エッジDAG | `09:§2-3`; `04:§3` | 前提Stage PASSハッシュ、単一Stage Owner Record、逐次専有、不可逆回数・STOP連鎖のログ | Runtime実装者＋独立Stage Gate | 前提未達、並行Stage、包括承認→**BLOCK** |
| **RT-TEST-01** Group A/B/C 未解決19 | `00:§4`; `06:§2-3`; `05:§3` | 将来再試験の個別結果・取消/timeoutの区別、Group B CAUSE_UNDETERMINED、TEST-14 deny期待、Stage5全39結果 | 独立Quality Gate | 現状19/19 `NOT_EXECUTED`、未承認、FAIL/CANCELLED→**BLOCK** |
| **RT-REVIEW-01** 独立レビュー来歴 | `11:§1-3`はレビュー依頼、R1.8判定文字列は依頼者伝達 | R1.8独立レビュアーの最終レポート、対象パッケージSHA-256との結合、10+2の結果と発行主体確認 | Human Owner（確認）＋独立Document Reviewer（原本提供） | 真正なレビュー結果の確認ができない限り**正式文書クローズを保留** |
| **RT-GATE-01** 正式Gate | `00:§7`; `05:§3-4`; `10:§5-7` | 別の独立Runtime/Host/Quality受入記録＋Human Owner承認記録＋正式Gate判断 | Formal Gate Authorityのみ | 文書クローズ・DEC署名だけで自動解放しない：**G1-D1 BLOCKED** |

**注意**: R1.8文書内の設計主張が実OSで実現可能か/未仲介経路が存在しないかは**判定未了**である。文書品質の `RESOLVED` をRuntimeの `VERIFIED` に翻訳しない。

## 3. 固定 Stage DAG とRuntime受入の順序

```text
Stage 0 -> Stage 1
Stage 1 -> Stage 2
Stage 0 -> Stage 3
Stage 0 -> Stage 4
Stage 2 -> Stage 5
Stage 3 -> Stage 5
Stage 4 -> Stage 5
```

Stage 0/1/2/3/4/5 は**同時実行禁止**。任意のStageについて、(a) 先行証拠、(b) 対応する単一Stageの真正なOwner DEC-03、(c) 独立のHost/Runtime Gate、(d) 最新STOP/取消不在、(e) LP-R/S/A受入、(f) 1回限りのSlot拘束、を必要とする。DAG上の複数親は**すべて**PASS必須。どれか欠ければ実行不可。DEC-01A/01B/02/04は準備/基準判断でありStageの実行権限と混同不可。DEC-05/06は失敗後の個別診断のみ。DEC-07は特定STOP後にのみ判断され、実行許可と異なる。

## 4. STOP解除とRuntime停止の非循環性

```text
STOP Event
  -> Phase A (修復証拠; 承認前)
  -> Phase B (Human Ownerの個別解除判断)
  -> STOP_CLEARANCE_VALID (Phase C完了に依存しない)
  -> NO_ACTIVE_STOP (権威ある6階層状態台帳)
  -> Phase C (全16条件を独立検証)
  -> LP-R -> LP-S -> LP-A
```

- STOP未発生を正規記録で検証できた場合、架空のPhase B承認を要求しない。単にSTOP通知が見えなかっただけでは不可。
- 履歴ありで未解除/新規STOP/上位STOPがあれば`NO_ACTIVE_STOP=FALSE`。不明・不一致では`STOP_STATE_UNKNOWN / NO_EXECUTION_GRANT`。
- 子から親への予約遮断・親から子への開始/Admission遮断、スロット不返却、UNKNOWN中の自動再実行禁止は必須。
- RuntimeでのSTOP波及や取消線形化は**未証明**。`STOP_CLEARANCE_VALID DOES NOT IMPLY EXECUTION_ELIGIBLE`を維持する。

## 5. 歴史的テスト不変値、実行禁止条件、必要別Gate

| Total | PASS | FAIL | CANCELLED | SKIPPED | TODO |
|---:|---:|---:|---:|---:|---:|
| 455 | 436 | 13 | 6 | 0 | 0 |

Group A=10 / Group B=3 / Group C=6。全19件 `Allowed Execution = NO / Owner Approval = REQUIRED / Retest Result = NOT_EXECUTED`。このHandoffで新しいテスト結果を生成していない。

TEST-14の将来検証に要求されるセキュリティ期待契約：

```javascript
assert.equal(grant.allowed, false);
assert.equal(grant.reason, 'egress_denied');
```

**独立Gate順序（役割分離）**: 原本とR1.8独立レビュー原本の照合 → Human Ownerによる文書正式クローズ判断（別記録） → 各DECについて個別Human Owner Record → Runtime実装者の証跡準備と独立Runtime/Security/Host Gate（今は未着手） → 各Stageの別Owner・Stage Gate → 独立Quality Gate → 正式G1-D1 Gate担当の判断。**前段の判断は後段を自動承認しない**。

**このHandoffの状態**: `DOCUMENTARY_CONTRACT_DEFINED / RUNTIME_NOT_VERIFIED / RUNTIME_EVIDENCE_REQUIRED / NO_EXECUTION_GRANT / G1_D1_FORMAL_GATE_BLOCKED`。
