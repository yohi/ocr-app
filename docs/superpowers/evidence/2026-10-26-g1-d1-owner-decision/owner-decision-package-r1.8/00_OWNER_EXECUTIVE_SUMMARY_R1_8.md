# 00. Human Owner 向け全体概要（Executive Summary R1.8）

## 1. 役割・権限境界と本書の目的

本書は、`yohi/ocr-app` の **G1-D1 Human Owner Decision Package（意思決定判断資料）R1.8 最終限定是正版** です。
R1.7 独立限定再レビューで検出された **FND-ODP-R17-001**（STOP 解除条件と DEC-07 Phase C の循環依存）に対して最終限定是正を実施し、STOP 解除自体の有効性判定（`STOP_CLEARANCE_VALID`）と再実行適格性判定（`EXECUTION_ELIGIBLE`）を完全に分離し、`NO_ACTIVE_STOP` から Phase C 依存を除去した非循環 DAG を確立しました。

### 権限と職責の分離宣言
- **現在の実行権限**: `READ_ONLY_SOURCE / STATIC_ANALYSIS / DOCUMENT_CORRECTION_ONLY / NO_EXECUTION_GRANT / NO_OWNER_AUTHORITY / NO_GATE_AUTHORITY`
- **作成担当・独立レビュアー・実行担当・Human Owner・正式Gate担当の分離**:
  - 本資料是正担当 AI エージェントは、意思決定の準備と技術的助言のみを行い、いかなる承認も代行しません。
  - テスト実行、環境変更、依存転送、STOP 解除、正式 Gate 解除の権限を持ちません。
  - すべての意思決定項目（DEC-01A, 01B, 02, 03, 04, 05, 06, 07）の初期状態は **`NOT_APPROVED`** です。
- **ホスト環境保護**:
  - ホスト側の 26 コンテナの無停止保護を厳格に維持し、ホスト Docker デーモン・Socket へのアクセスは禁止されています。

---

## 2. R1.8 最終限定是正概要（FND-ODP-R17-001 是正完了）

| Finding サブID | 重要度 | 是正対象と内容 | R1.8 是正結果 |
| :--- | :--- | :--- | :--- |
| **FND-ODP-R17-001** | Major | STOP 解除条件と DEC-07 Phase C の循環依存の解消、および STOP 解除有効性と再実行適格性の分離 | `STOP_CLEARANCE_VALID`（Phase A 修復証拠・Phase B 真正 Owner 解除判断・範囲一致・条件充足）を Phase C の完了を要求しない独立概念として定義。`NO_ACTIVE_STOP` から Phase C 依存を除去し、STOP 未発生時は不要な解除記録を要求せず、STOP 発生時は真正な解除有効性によって評価される非循環 DAG を確立。`STOP_CLEARANCE_VALID DOES NOT IMPLY EXECUTION_ELIGIBLE` を徹底し、Phase C が適格性判定式（全16条件論理積）によって独立して実行可否を評価する契約を完成。FND-ODP-008 の非循環性を回復。 |

---

## 3. 固定基準と入力原本完全性

- **対象リポジトリ**: `https://github.com/yohi/ocr-app`
- **ブランチ**: `fix/shadow-graphql-post-scope-guards`
- **Fixed HEAD**: `6b08251170265c444ce8957377e6bfca23b21fd7`（検証済み・クリーン）
- **直接の是正対象 R1.7 アーカイブ**:
  - `OCR_APP_G1_D1_OWNER_DECISION_PACKAGE_R1_7_2026-10-26.tar.gz`
  - 期待/実測 SHA-256: `fb6229108fffca9388c4ac5dd523644b7d22cc7483b5ea044e7d59e3ee3f8dd1` (`MATCH`)
  - 期待/実測サイズ: `123,176 bytes` (`MATCH`)
  - 内部 `SHA256SUMS.txt` 27 項目全件一致確認 PASS。
- **上位再試験計画 R1.3**:
  - `OCR_APP_G1_D1_UNRESOLVED_19_RETEST_PLAN_R1_3_2026-10-26.tar.gz` (SHA-256: `e293...`, 33,389 bytes, PASS)
- **全体回帰テスト対象**: `.github/workflows/scripts/*.test.mjs` 配下の全 39 ファイルを固定HEADより照合済み。

---

## 4. 現在の確定状態（テスト実績値と未解決19件）

既存の一次テスト実測値：

| 項目 | 件数 | 状態・扱い |
| :--- | ---: | :--- |
| **Total** | **455** | 初回実測値（将来の固定期待総数としない） |
| **PASS** | **436** | 既合格確認済み（再試験時にも追跡対象） |
| **FAIL** | **13** | 未解決（Group A: 10件、Group B: 3件） |
| **CANCELLED** | **6** | 未解決（Group C: 6件） |
| **SKIPPED** | **0** | スキップなし |
| **TODO** | **0** | スタブなし |

**現在の全19件の公式ステータス**:
`Allowed Execution = NO` / `Owner Approval = REQUIRED` / `Retest Result = NOT_EXECUTED`

---

## 5. 意思決定の基本原則（一括承認の禁止と個別判断）

7項目（01A/01B 分離により全8項目）を一括承認させる形式は厳格に禁止されています。

### 承認方式（Approval Method）と判断区分（Decision Disposition）の分離
- **Approval Method**:
  - `METHOD_A_STAGE_BY_STAGE` (推奨): 1つの承認記録が必ず単一の Stage のみを承認対象とし、先行証跡確認後に次 Stage を承認する（1 Record = 1 Stage 原則）。
  - `METHOD_B_CONDITIONAL_PROGRESSION`: 現時点では `NOT_AUTHORIZED_UNTIL_SEPARATELY_APPROVED`。
- **Decision Disposition**:
  - `APPROVE` / `CONDITIONAL_APPROVE` / `HOLD` / `REJECT`
- **安全側の未指定時動作（Fail-closed 契約）**:
  - いずれかの必須フィールドが未記入または不一致の場合、`AUTHORIZATION_INCOMPLETE / NO_EXECUTION_GRANT` となり、いかなる実行権限も付与されません。

---

## 6. 全8項目の意思決定概要サマリ

| 意思決定ID | 判断対象 | 許可される操作の範囲 | 厳格な禁止事項 | 技術的推奨区分 |
| :--- | :--- | :--- | :--- | :--- |
| **DEC-01A** | キャッシュインベントリ検査 | 承認対象パス限定走査、ロックファイル照合、不足集合・マニフェスト案作成 | パッケージ持ち込み・転送・展開、`npm ci/install`、ホスト変更、外部通信 | **APPROVE** 推奨 |
| **DEC-01B** | 不足依存限定転送 | 01Aで特定・承認された特定パッケージのみの内容アドレス抽出、SHA-512照合転送、VM内再検証 | `npm ci/install` 実行、`~/.npm` 全体コピー、未検証パッケージ転送、外部通信 | **HOLD** 推奨（01A完了まで） |
| **DEC-02** | 独立ローカルGit環境配備 | 固定HEAD・tree・blob整合性確認、追跡ファイル一致検証、リモート未設定Gitメタデータ配備 | ホスト `.git` 共有、リモート接続、ソース改変、Git hooks実行、Secrets共有 | **APPROVE** 推奨 |
| **DEC-03** | 実行権限・リソース上限 | Method A に基づく単一Stage（初回は Stage 0 のみ）の実行許可、cgroup上限枠 | 複数Stage事前承認、範囲指定、cgroup外実行、外部通信、ホストDocker操作 | **APPROVE**（Method A, Stage 0単一限定） |
| **DEC-04** | 全体回帰範囲・Gate審査基準 | 全39テストファイルの回帰範囲確定、多面的合格契約の合意 | 恣意的テスト除外、455件固定値強制、テスト結果承認の混同、正式Gate解除 | **APPROVE** 推奨 |
| **DEC-05** | Group B 診断実験（モック注入） | Stage 3 Primary 失敗後の実験前明示承認に基づくGitモック注入実験、診断ログ分離記録 | 無条件事前包括承認、プロダクションコード改変、正規回帰との混同、認可境界緩和 | **HOLD** 推奨（Stage 3結果待ち） |
| **DEC-06** | Group C 診断実験（フィクスチャ改善） | Stage 4 Primary 失敗後の実験前明示承認に基づくTEST-14非同期クリーンアップ実験、診断ログ分離記録 | 無条件事前包括承認、外側例外送出の合格扱い、ハング放置、正規PASS偽装 | **HOLD** 推奨（Stage 4結果待ち） |
| **DEC-07** | STOP後の個別再開 | Phase A/B/C 非循環Gate充足に基づく特定単一Stageの1回限り再実行承認 | 将来STOPの包括事前承認、自動リトライ、無断復旧、未充足条件での再実行、一括再開 | **HOLD** 推奨（STOP発生時個別） |

---

## 7. 重要注意事項

1. **Gate状態の不変性**: 本パッケージの受領および検討中であっても、G1-D1 Formal Gate は **未承認（`BLOCKED`）** を維持します。
2. **実行権限の非付与**: 本資料は Human Owner の判断材料であり、本資料の提示をもって AI エージェントに実行権限が付与されることは一切ありません。
3. **署名欄の未記入原則**: `10_OWNER_DECISION_RECORD_TEMPLATE_R1_8.md` は完全な白紙・未記入テンプレートとして提供されます。Human Owner ご自身が署名・判断を記入してください。
4. **Runtime 未実証の明記**: 本契約は文書上の規範的契約定義（`DOCUMENTARY_CONTRACT_ONLY`）であり、Runtime での実証（`RUNTIME_RESERVATION_LINEARIZABILITY_NOT_VERIFIED`, `RUNTIME_START_LINEARIZABILITY_NOT_VERIFIED`, `RUNTIME_ADMISSION_LINEARIZABILITY_NOT_VERIFIED`, `RUNTIME_PROCESS_ISOLATION_NOT_VERIFIED`, `RUNTIME_STOP_CLEARANCE_NOT_VERIFIED`）を主張するものではありません。
