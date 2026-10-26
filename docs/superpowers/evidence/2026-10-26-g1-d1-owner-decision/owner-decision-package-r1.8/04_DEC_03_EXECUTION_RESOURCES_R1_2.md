# 04. DEC-03 — 再試験実行権限・リソース上限判断資料（R1.2限定是正版）

## 1. Decision Summary

### 1.1 判断する内容
再試験計画 R1.3 に基づく各ステージ（Stage 0〜5）の実行権限、および実行時に課すリソース上限枠（cgroup メモリ制限、PID制限、外側タイムアウト、テストファイル並列度）を承認するかどうかの判断です。

### 1.2 Method A における単一 Stage 承認の厳格な契約（FND-ODP-001是正）
R1.1 では推奨値と判断値の分離が行われましたが、DEC-03 において複数 Stage が同時に承認される余地を完全に排除するため、**`METHOD_A_STAGE_BY_STAGE` では「1つの Owner Decision Record が承認対象とする Stage は必ず1つのみ（1 Record = 1 Stage）」** とする規範的契約を確立します。

#### 規範的 Method A 契約規則（10原則）
1. **単一 Stage 原則**: 1つの Owner Decision Record が承認対象とする Stage は必ず1つのみとする。
2. **単一値拘束**: `authorized_stage` は単一の Stage 識別子（`Stage 0` 〜 `Stage 5` のいずれか1つ）のみを受け付ける。
3. **複数選択の無効化**: 複数の Stage を同時に選択・記載した承認記録は**完全に無効**とする。
4. **範囲指定の無効化**: `Stage 0-3`, `Stage 1..2` 等の範囲指定は**完全に無効**とする。
5. **ワイルドカード指定の無効化**: `ALL`, `*`, `Stage *` 等の総括指定は**完全に無効**とする。
6. **未来 Stage の包括事前承認禁止**: 後続 Stage を事前に一括承認することは禁止する。
7. **次 Stage への新 ID 必須**: 次の Stage を承認するには、必ず新しい Decision Record ID を持つ独立した判断記録の発行を必要とする。
8. **先行証跡の審査必須**: 次の Stage の判断には、該当する前提 Stage の実行結果・一次証跡の審査を必須とする。
9. **自動実行権限生成の禁止**: 前提 Stage が完全 PASS した場合であっても、次 Stage への実行権限は自動生成されない（独立した Owner 承認が必要）。
10. **経路独立性と事前承認の分離**: DAG 上で Stage 3 や Stage 4 が独立経路であっても、それらの事前包括承認を意味しない。

#### 安全側の未指定時動作（Fail-closed 契約）
以下のいずれかに該当する場合、判断記録は無効となり、**`AUTHORIZATION_INCOMPLETE / NO_EXECUTION_GRANT`** として実行を遮断します：
- Stage 未指定
- Stage 複数指定・範囲指定・ワイルドカード指定
- 適用 Method 未指定
- Owner 判断未記入
- 次 Stage の個別判断記録が存在しない
- リソース制限・対象環境・実行回数が未指定

### 1.3 Method B との厳格な分離
- **`CONDITIONAL_APPROVE` は Method B を意味しません。**
- **`APPROVE` は Method A を意味しません。**
- Method A と Method B は Human Owner が独立して選択する承認方式です。
- 現時点において Method B による段階進行枠組みは未承認であり、**`NOT_AUTHORIZED_UNTIL_SEPARATELY_APPROVED`** と明記します。

### 1.4 初期推奨（技術的助言）
- **Recommended Approval Method**: `METHOD_A_STAGE_BY_STAGE`
- **Recommended Authorized Stage**: `Stage 0 only`（環境受入再確認のみ）
- **Recommended Disposition**: `APPROVE`（Stage 0 のみ）

---

## 2. 実行単位とテスト並列度の正確な定義

「単一プロセスで実行」という曖昧な表現を排除し、以下の制御領域を明確に区別して管理します。

| 制御領域 | 設定値（初期候補） | 正確な定義と制御対象 | 保証しないもの（責務外） |
| :--- | :--- | :--- | :--- |
| **テストファイル並列度** | `--test-concurrency=1` | **Node.js CLI テストランナーが同時に並行実行するテストファイル数の上限を1とする。** | テストファイル内部の非同期処理（Promise等）や子プロセスの並列度 |
| **cgroup PID上限** | `pids.max=128` | 対象cgroup内のプロセス・スレッド総数の上限。過剰フォークを防止。 | JavaScript Promise の個数、非同期イベントループの完了可能性 |
| **cgroup メモリ上限** | `memory.max=512MiB` | 対象cgroup内の物理メモリ使用量の上限。ホスト障害を防止。 | テスト合否、アサーションの正しさ |
| **外側タイムアウト** | `60秒` | プロセスの永久ハングを外側から強制終了する安全制限。 | テスト合否（超過終了は FAIL/STOP 扱い） |
| **非同期・子プロセス制御** | コード・フィクスチャ設計 | Promise、タイマー、AbortSignal のライフサイクル。 | OSレベルのリソース枯渇防止 |

### 未実証性注記
上記リソース候補値（512 MiB, 128, 60s）はすべて **`NOT_EXECUTION_VERIFIED / OWNER_APPROVAL_REQUIRED`** であり、実行前に Owner の承認を要します。

---

## 3. 各 Stage の個別承認要件と進入前提条件

Method A においては、各 Stage ごとに独立した 1 件の承認記録（1 Record = 1 Stage）が発行されます。

| Stage | 名称 | 必須 Owner 意思決定記録 | 進入前提条件 | 実行許可操作 |
| :--- | :--- | :--- | :--- | :--- |
| **Stage 0** | **環境受入再確認** | **DEC-03 (Stage 0 単一指定記録)** | VM起動、固定HEAD | 環境検証のみ（テスト未実行、パッケージ未導入） |
| **Stage 1** | **オフライン依存補完** | **DEC-01A, 01B, DEC-03 (Stage 1 単一指定記録)** | Stage 0 PASS | `npm ci --offline --ignore-scripts` 実行・整合性検証 |
| **Stage 2** | **Group A 限定再試験** | **DEC-03 (Stage 2 単一指定記録)** | Stage 1 PASS | Group A 対象テストファイルを並列度1で順次実行 |
| **Stage 3** | **Group B 限定再試験** | **DEC-02, DEC-03 (Stage 3 単一指定記録)** | Stage 0 PASS | `authorize-routing-start.test.mjs` を並列度1で実行 |
| **Stage 4** | **Group C 限定再試験** | **DEC-03 (Stage 4 単一指定記録)** | Stage 0 PASS | `authorize-decision-egress.test.mjs` を並列度1で実行 |
| **Stage 5** | **全体回帰確認** | **DEC-04, DEC-03 (Stage 5 単一指定記録)** | **Stage 2, 3, 4 すべて PASS** | 全39ファイルを並列度1で順次実行 |

---

## 4. Decision Options（判断選択肢）

### Approval Method 選択
- **`METHOD_A_STAGE_BY_STAGE`**: Stage別承認方式を採用する（1 Record = 1 Stage 原則、**推奨**）。
- **`METHOD_B_CONDITIONAL_PROGRESSION`**: 条件付き段階承認方式（現時点では `NOT_AUTHORIZED_UNTIL_SEPARATELY_APPROVED`）。

### Decision Disposition 選択
- **`APPROVE`**: 選択した方式・単一Stageで実行を承認する（初回は Stage 0 のみ推奨）。
- **`CONDITIONAL_APPROVE`**: 追加条件を付与して承認する（条件未充足時は実行不可）。
- **`HOLD`**: 保留。
- **`REJECT`**: 実行を拒否する。
