# 02 — G1-D1 Human Owner Decision Brief

> **権限**: `READ_ONLY / STATIC_DOCUMENTATION / HANDOFF_PREPARATION_ONLY / NO_EXECUTION_GRANT / NO_OWNER_AUTHORITY / NO_GATE_AUTHORITY`  
> **固定原本**: `OCR_APP_G1_D1_OWNER_DECISION_PACKAGE_R1_8_2026-10-26.tar.gz`（アップロード時のローカル名に `(1)` あり）  
> **原本 SHA-256**: `c3f318a8267b9137abae682e79a7ebe4baa635b4bc8b597108865ead7885ef2e` / **135,826 bytes**  
> **Repository**: `https://github.com/yohi/ocr-app` / **Branch**: `fix/shadow-graphql-post-scope-guards` / **Fixed HEAD**: `6b08251170265c444ce8957377e6bfca23b21fd7`  
> **原則**: 原本不変更、Owner判断代行なし、Runtime/テスト未実行、G1-D1正式Gate `BLOCKED`。
## 1. 判断用エグゼクティブ要約

- **現在**: R1.8文書品質は依頼者伝達の独立レビューで `DOCUMENT_REVIEW_CLOSE_ELIGIBLE`。R1.8アーカイブは独立チェックサム・構造検査に合格。しかしHuman Ownerによる正式文書クローズ/8 DEC判断はすべて未実施、Runtimeは `RUNTIME_NOT_VERIFIED`、G1-D1正式Gateは `BLOCKED`。
- **参照限定**: R1.8アーカイブの`11_INDEPENDENT_REVIEW_HANDOFF_R1_8.md`はレビュー依頼仕様。独立レビュアー発行のR1.8最終判定レポートは入力未添付。正式判断前に独立レビュー原本の来歴、Package SHA-256、Finding 2 resolved + 10 non-regressionを照合すること。
- **Owner判断候補**: `APPROVE / CONDITIONAL_APPROVE / HOLD / REJECT`（選択なし）。本文中の技術的推奨、またはR1.8原本CSVの`recommended_disposition`は**Owner選択と異なる**。本資料は判断を代行せず、いかなるレコードも発行しない。
- **記録方式**: 原本と分離した**External Owner Decision Record**、`owner_decision`を唯一の判断Authorityとし`decision_disposition`との一致を要求。Package SHA-256、固定HEAD、VM、対象操作、Stage、証拠ID/SHA-256、期限、回数、取消条件を拘束する。署名の真正性、最新状態、付帯条件充足、Runtime認可がない限り `NO_EXECUTION_GRANT`。
- **Method A**: `1 Record = 1 Stage`。複数Stage、Stage範囲、ワイルドカード、一括/将来の包括承認を禁止。DEC-03はStageごとに新しい独立記録が必要。方法Bは `NOT_AUTHORIZED_UNTIL_SEPARATELY_APPROVED`。

## 2. DEC別Owner判断事項（8件、いずれも NOT_APPROVED）

### DEC-01A — 依存・キャッシュの読み取り専用調査

1. **判断質問**: 明示されたVM/ホストの限定パスを、Secretsを除外して読み取り専用走査し、不足依存集合を証拠化する作業を許容するか。
2. **対象／禁止**: 対象はキャッシュ・lockfile照合、SHA-512/欠損マニフェスト案のみ。パッケージ持込・展開・転送、`npm ci/install`、テスト、ホスト変更、外部通信を禁止。
3. **先行証拠**: 調査パスAllowlist、対象VM/固定HEAD、Secrets非収集ルール、I/O上限と26コンテナ非干渉設計、作業者の責務分離。
4. **依存**: DEC-01Bに先立つ限定調査。Stage 1への自動実行権限は付与しない。
5. **残存不確実性**: 読取でもホストI/O負荷・キャッシュ秘密混入・経路越境があり、実測は未実施。
6. **条件付き承認に必要**: 調査範囲/時間/負荷/ログマスキング/中断条件の記録と各条件の独立照合。
7. **判断後の別Gate**: 現場の読取権限・隔離受入、マニフェスト検証、必要時のDEC-01B判断。
8. **依然禁止**: 正本不在、対象パス不確定、ホスト影響の不明、STOP/権限不足、ネットワーク遮断未確証。

### DEC-01B — 不足依存資産の限定転送

1. **判断質問**: DEC-01Aで確定しハッシュ拘束した不足パッケージだけを限定的にVMへ渡すことを認めるか。
2. **対象／禁止**: 内容アドレスで特定した不足分のみ抽出・SHA-512照合・VMで再検証。`~/.npm`一括コピー、未認証アセット、インストール/テスト、外部通信を禁止。
3. **先行証拠**: DEC-01Aの承認範囲内での完了記録、不足集合マニフェストとpackage-lock整合、パッケージ単位ID/ダイジェスト、転送/隔離境界の設計。
4. **依存**: DEC-01A実績、Stage 1の準備。DEC-01B自体は**DEC-03 Stage 1実行権限ではない**。
5. **残存不確実性**: 悪意パッケージ、ハッシュ不一致、持込経路/Secrets混入、ホストからVMへの非干渉性。
6. **条件付き承認に必要**: 転送対象の完全固定・総容量・完全性・送受信者・隔離・中止基準を証跡結合。
7. **判断後の別Gate**: VM内SHA-512照合、Stage 0 PASS、DEC-03 Stage 1の別記録、依存/Runtime Gate。
8. **依然禁止**: 01A不足集合未確定、転送対象追加、ハッシュ不一致、STOP、未検証隔離、Stage 1 `npm ci`無断実行。

### DEC-02 — 独立ローカルGitの配備

1. **判断質問**: Stage 3のGroup B検証に必要なGitメタデータを、ホスト`.git`/Secrets/remoteと絶縁してテストVM内に配備するか。
2. **対象／禁止**: Commit/tree/blobの来歴、40桁Git Object ID、追跡ファイル一致、hooks無効化、remote未設定の独立検証のみ。ホスト`.git`共有、外部接続、ソース変更、テスト実行を禁止。
3. **先行証拠**: HEAD `6b08251170265c444ce8957377e6bfca23b21fd7`、commit/tree/blobの照合方式、VM隔離とGit hooks無効化、配備元ダイジェスト。
4. **依存**: Stage 3の先行配備、Stage 0 PASSとDEC-03 Stage 3承認は別途必要。
5. **残存不確実性**: Git object provenanceと隔離の実証不足。Group B原因は`CAUSE_UNDETERMINED`。
6. **条件付き承認に必要**: Remoteが空、hooks起動不可、対象追跡tree固定、VM閉域での配備後検証条件。
7. **判断後の別Gate**: Git物理実装/隔離の受入、Stage 3前提証拠、DEC-03 Stage 3、Runtime Gate。
8. **依然禁止**: HEAD/オブジェクト不一致、remote/hook有効、ホストGit/Secrets可視、STOP、無署名Owner記録。

### DEC-03 — Stage別実行資源・npm実行条件

1. **判断質問**: **その時点で選択する単一Stageのみ**について実行上限（通常1回）、メモリ/PID/タイムアウト/並列度および禁止操作を明示して認可するか。
2. **対象／禁止**: Stage 0〜5から**1つだけ**の受入/依存補完/限定テスト/全体回帰の操作。複数Stage事前承認、並行実行、Stage越境、外部通信、ホストDocker操作を禁止。`npm ci --offline --ignore-scripts`は**Stage 1のみ**、DEC-01Bのみでの実行は禁止。
3. **先行証拠**: Stage 0にはVM起動/固定HEAD/隔離予定証拠、Stage 1はStage 0 PASSとDEC-01A/01B、Stage 2はStage 1 PASS、Stage 3/4はStage 0 PASS、Stage 5はStage 2/3/4すべてPASSおよびDEC-04；それぞれの実施前証拠ID/SHA-256。
4. **依存**: 7エッジDAG（§3）。新Stageに移るたび独立Owner Decision Record（`1 Record = 1 Stage`）。
5. **残存不確実性**: cgroup候補`512 MiB / PID 128`、外側`60 s`、Nodeファイル並列度1の安全性・実効性、実ホスト非干渉、LP-R/S/A未実証。
6. **条件付き承認に必要**: 許可Stageの**単一識別子**、回数、資源上限、VM、前Stage PASS、STOP/取消の拘束、先行条件充足証拠の記録。
7. **判断後の別Gate**: 最新Owner記録真正性、Runtime Admission/Isolation、Stage別実施許可の実装Gate、該当Stage結果の独立評価。
8. **依然禁止**: 条件未充足、複数Stage入力/ワイルドカード、同時実行、STOP、Admission未調停、Slot二重予約、固定HEADドリフト、Owner判断なし。

### DEC-04 — Stage 5テスト範囲と品質Gate

1. **判断質問**: 固定HEADの39テストファイルをStage 5の評価範囲とし、欠落のない6条件同時成立を審査基準として認めるか。
2. **対象／禁止**: `EXPECTED_TEST_SCOPE_ACCOUNTED_FOR`, `NO_UNEXPLAINED_TEST_OMISSIONS`, `FAIL=0`, `CANCELLED=0`, `UNEXPECTED_SKIP=0`, `UNEXPECTED_TODO=0`の評価基準合意。実試験開始/品質Gate承認済みの扱い/455固定総数強制/恣意的除外を禁止。
3. **先行証拠**: HEAD固定39ファイルの検査台帳と内容、Group A/B/Cの対象対応、キャンセルの意味論、テスト集計とハッシュの方法。
4. **依存**: Stage 5の審査基準。Stage 2,3,4すべてPASSがStage 5の進入前提。DEC-03 Stage 5は別記録。
5. **残存不確実性**: 実試験未実行、全39ファイルの実際の完走率/実測値は未確定、実資源枯渇可能性。
6. **条件付き承認に必要**: 6条件の例外なく維持、期待総数455を未来の固定値にしない、証跡の完全性/追跡可能性。
7. **判断後の別Gate**: Stage 5結果に対する独立品質Gateと正式Gate。DEC-04だけではGateを開かない。
8. **依然禁止**: 未承認実行、Stage 2/3/4不合格/未実施、欠落39ファイル、FAIL/CANCELLED、未説明のskip/todo、STOP。

### DEC-05 — Group B診断実験（Gitモック注入）

1. **判断質問**: 独立Git下のStage 3 Primary再試験に失敗が残った場合に限り、フィクスチャへのGitモック注入を個別に承認するか。
2. **対象／禁止**: 診断用の隔離された限定モック、別ログのみ。無条件包括事前承認、本番コード変更、Primary PASS偽装、追加Stage権限を禁止。
3. **先行証拠**: Stage 0 PASS、DEC-02 Git整合、Stage 3 Primary失敗ログと対象TEST-11/12/13、失敗の原因未確定状態、実験内容/差分/戻し手順。
4. **依存**: **Stage 3 Primary失敗の後**、**診断実験開始の前**に単独のDEC-05判断。DEC-03およびRuntime Gate別途必要。
5. **残存不確実性**: Gitモックが実原因を隠す、環境因子の反証不足、フィクスチャ逸脱。
6. **条件付き承認に必要**: Primary失敗を証拠化し、変更範囲・診断目的・記録分離・再実行回数・STOP条件を限定。
7. **判断後の別Gate**: 診断結果の独立解釈、正規Stage 3再試験・Gateは別、Runtime Admission。
8. **依然禁止**: Primary結果なし/失敗未確定、Owner未署名、コード改変、正規PASSへの流用、STOP、条件未達。

### DEC-06 — Group C診断実験（TEST-14フィクスチャ改善）

1. **判断質問**: Stage 4 PrimaryでTEST-14がキャンセル/ハングした場合に、セキュリティ期待値を保った非同期後始末フィクスチャ実験を個別許可するか。
2. **対象／禁止**: TEST-14の非同期クリーンアップに限る。外側例外・ハング・`CANCELLED`をPASS扱い、本番変更、`egress_denied`期待値緩和を禁止。
3. **先行証拠**: Stage 0 PASS、Stage 4 Primaryのキャンセル/ハングトレース、対象TEST-14の期待契約、フィクスチャ最小差分とタイムアウト境界。
4. **依存**: **Stage 4 Primary失敗の後**、**実験開始の前**にDEC-06個別判断。DEC-03およびRuntime Gate別途必要。
5. **残存不確実性**: 非同期cleanup、外側60秒と内部10秒の干渉、プロセス生存、異常が隠れる危険。
6. **条件付き承認に必要**: 反証条件を維持、ハング時STOP、診断ログ独立、単一試行と復旧可能性を明文化。
7. **判断後の別Gate**: 診断結果の独立評価、正規Stage 4 PASSとは別、Runtime Admission。
8. **依然禁止**: Primary結果なし、Owner未署名、期待値変更、タイムアウトによる擬似PASS、STOP、条件未達。

TEST-14の期待契約（変更不可）：

```javascript
assert.equal(grant.allowed, false);
assert.equal(grant.reason, 'egress_denied');
```

### DEC-07 — STOP・個別再開契約

1. **判断質問**: 実際のSTOP識別子と対象単一Stageに関し、Phase A修復証跡を見た上で解除の**有効性判断（Phase B）**を行うか。実行権限は別のPhase Cで評価する。
2. **対象／禁止**: STOP原因調査・修復・Owner解除決定の責務分離、対象STOPと範囲の限定。将来STOP一括解除、広域STOPを狭い解除で消す、自動再開/自動リトライ、未充足再実行を禁止。
3. **先行証拠**: STOP ID/6階層適用範囲/親子結合、原因/ログ、Phase A 9条件、HEAD/隔離・修復整合、証跡ID/SHA-256、現在STOP台帳。
4. **依存**: `STOP Event → Phase A → Phase B → STOP_CLEARANCE_VALID → NO_ACTIVE_STOP → Phase C → LP-R/S/A`。再実行Stageには当該DEC-03の別記録が必要。
5. **残存不確実性**: STOP実検知/上位伝播、解除最新性、競合順序、他の未解除STOP、Runtime状態不明。
6. **条件付き承認に必要**: 対象STOP・VM・単一Stage・一回限り・条件証拠を拘束し、未充足は`CONDITION_PENDING / EXECUTION_BLOCKED`。
7. **判断後の別Gate**: STOP_CLEARANCE_VALIDの独立真正性→NO_ACTIVE_STOP→Phase Cの16条件再評価→Runtime LP-R/S/Aと隔離Gate。**解除は実行資格を意味しない**。
8. **依然禁止**: 有効な広域/下位STOP、解除記録不正、Phase C未確認、条件不一致、状態不明、Runtime未調停、自動再実行。

**8 DEC 共通**: `current_status=NOT_APPROVED`（R1.8 `01_DECISION_MATRIX_R1_2.csv`全8行）。Ownerの判断値・署名・判断日時・正式判断記録IDは**空欄**。元パッケージ `10:§4`も全8件未記入。

## 3. Stage DAG・先行証拠と独立判断（不変7エッジ）

```text
Stage 0 -> Stage 1
Stage 1 -> Stage 2
Stage 0 -> Stage 3
Stage 0 -> Stage 4
Stage 2 -> Stage 5
Stage 3 -> Stage 5
Stage 4 -> Stage 5
```

| Stage | 役割・進入証拠 | 必須個別判断 | 即時STOP／禁止条件 |
|---|---|---|---|
| **0** | VM受入：VM識別、固定HEAD、隔離/Socket非共有、受入記録 | `DEC-03` **Stage 0だけ**の独立Owner Record | VM条件・固定HEAD不一致、STOP、Host影響、Runtime Admission未実証 |
| **1** | オフライン依存補完：Stage 0 PASS、01A不足集合、01B限定転送・ハッシュ | `DEC-01A`, `DEC-01B`, `DEC-03` **Stage 1専用Record** | `npm ci`未承認、ネットワーク通信、転送ハッシュ不一致、Stage 0未PASS |
| **2** | Group A 10件の限定再試験：Stage 1 PASS | `DEC-03` **Stage 2専用Record** | Stage 1未PASS、対象逸脱、FAIL/CANCELLED、超過資源 |
| **3** | Group B 3件のPrimary：Stage 0 PASS、独立Git照合、原因未確定 | `DEC-02`, `DEC-03` **Stage 3専用Record**。診断時のみ別`DEC-05` | Git来歴未証明、Remote/Hook、Primary未実施で診断開始、STOP |
| **4** | Group C 6件のPrimary：Stage 0 PASS、TEST-14 `egress_denied`期待維持 | `DEC-03` **Stage 4専用Record**。診断時のみ別`DEC-06` | STOP、ハング/キャンセルのPASS扱い、外側タイムアウト干渉 |
| **5** | 全39ファイル回帰：**Stage 2/3/4全てPASS**、6条件Gate対象 | `DEC-04`基準合意 + `DEC-03` **Stage 5専用Record** | 先行Stageいずれか未PASS/未実行、テスト欠落、STOP、Gate混同 |

- DAGで経路が独立でも、**Stageは常に一つずつ逐次実施**し、実行の並行/重複を禁止。Nodeテストランナー`--test-concurrency=1`はテストファイル同時数の上限であり、PID/CPU/OS子プロセスの安全性を証明しない。
- 直前の先行証拠、Owner記録の真正性・残り回数、Runtimeの予約/開始/入場Gateを**毎Stage独立**で評価。あるStageのPASSも次Stageを自動承認しない。
- スロット不明、取消やSTOP競合、依存Stageの証拠不一致はfail-closed。二重予約・二重開始、スロット自動返却、自動再試行禁止。

## 4. STOP処置・再開の境界

1. STOPの発生時は6階層（Attempt / Slot / Record / Stage / VM / Environment）の識別子、履歴、証跡ID/SHA-256を保全。下位Attempt/Slot STOPは結合親Recordの新規Slot予約を遮断。上位STOPは関連する下位開始/Admissionを遮断。
2. 原因調査・修復/検証（Phase A）とHuman Owner個別解除判断（Phase B）を分離。STOP解除有効性 `STOP_CLEARANCE_VALID` はPhase Cを前提と**しない**。
3. STOP未発生履歴を権威ある状態台帳で確証できた場合は架空のDEC-07判断を要求しない。STOP履歴ありでは当該解除記録と新規未解除STOP不存在の照合が必要。`STOP_STATE_UNKNOWN`なら拒絶。
4. `STOP_CLEARANCE_VALID DOES NOT IMPLY EXECUTION_ELIGIBLE`。`NO_ACTIVE_STOP`の確認後、Phase Cで16条件を独立照合する。LP-R/S/Aは実装・実証未完のため本資料は許可証とならない。
5. 初期の実行権限: **なし**。DECのOwner署名、再開、再試験、Host変更、G1-D1正式Gate解除はすべて未実施。26コンテナ非干渉・Docker Socket非共有・Secrets隔離・外部通信遮断を維持。

## 5. 固定履歴（再試験結果ではない）

| Total | PASS | FAIL | CANCELLED | SKIPPED | TODO | 未解決 |
|---:|---:|---:|---:|---:|---:|---:|
| **455** | **436** | **13** | **6** | **0** | **0** | **19** |

- Group A=10、B=3、C=6。全19件について `Allowed Execution=NO`、`Owner Approval=REQUIRED`、`Retest Result=NOT_EXECUTED`。
- 455は**既存の一次実測**であり、新しいテスト結果や将来の固定期待総数を意味しない。

## 6. Human Owner外部Decision Record入力枠（未記入）

**正式な判断はR1.8原本の外部Recordスキーマに従って別途発行**する。本欄は未記入テンプレートであり、そのまま実行権限に変換できない。

| 対象DEC | Owner判断（4択） | Stage/操作範囲 | Record ID | 付帯条件確認 | 署名 | 判断日時 |
|---|---|---|---|---|---|---|
| DEC-01A |  |  |  |  |  |  |
| DEC-01B |  |  |  |  |  |  |
| DEC-02 |  |  |  |  |  |  |
| DEC-03 |  |  |  |  |  |  |
| DEC-04 |  |  |  |  |  |  |
| DEC-05 |  |  |  |  |  |  |
| DEC-06 |  |  |  |  |  |  |
| DEC-07 |  |  |  |  |  |  |

選択肢（選択なし）: `APPROVE` / `CONDITIONAL_APPROVE` / `HOLD` / `REJECT`。DEC-03の空欄は**単一Stageのみを手書き等で明示**し、Stageが変われば別レコードを作ること。条件付き承認だけでは未充足条件の実行を認めない。

**Ownerによる文書レビュー正式クローズ判断**:  
- クローズ選択: __________  
- Owner署名: __________  
- 判断日時: __________  
- R1.8独立最終レビューレポートの確認結果: __________

**現状態**: `OWNER_CONFIRMATION_PENDING / G1_D1_FORMAL_GATE_BLOCKED / NO_EXECUTION_GRANT`。
