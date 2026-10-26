# 10. Human Owner 意思決定記録欄（Owner Decision Record Template R1.8）

> **【重要・記入上の注意】**
> 本ドキュメントは、Human Owner ご自身が直接判断結果を記入・署名するための公式記録テンプレートです。
> AIエージェントがいかなる承認結果・署名・日時を代行記入することも厳格に禁止されています。
> 全項目は現在 `NOT_APPROVED` の状態です。

---

## 1. 外部意思決定記録アーキテクチャ（External Decision Record Architecture）

本判断記録テンプレートは、自己参照的なハッシュ循環を排除し、不変のパッケージ本体と独立した「外部判断記録（External Owner Decision Record）」として運用されます。

```text
[Owner Decision Package R1.8 (不変資料)]
    │
    │ 確定SHA-256 (独立算出)
    ▼
[Independent Review Result (独立レビュー結果)]
    │
    │ 審査合格・パッケージID確認
    ▼
[External Owner Decision Record (署名済み外部記録)]
    │
    │ 単一Decision Authority / 肯定的承認 / 有効状態 / 証跡結合
    ▼
[Atomic Eligibility + Slot Reservation (線形化予約境界)]
    │
    │ 最新状態照合 ＆ 実行スロット引当（二重予約排除・即時消費）
    ▼
[Reserved Execution Slot]
    │
    │ Execution Start Fence (開始直前の取消・STOP・VM整合性防御柵)
    ▼
[Execution Attempt (単一実行試行)]
    │
    ▼
[Result Recorded / STOP / UNKNOWN (自動返却永久禁止)]
```

### パッケージ自身の自己参照ハッシュ循環の排除
パッケージ本体の生成・パッケージング前に、そのパッケージ自身の確定 SHA-256 をパッケージ内部へ埋め込むことは禁止されています。
Human Owner は、独立レビューによって確定・公表された `Package SHA-256` を確認の上、外部の判断記録において参照・承認します。

---

## 2. 外部 Owner Decision Record 共通必須スキーマ（FND-ODP-007是正）

全 DEC 共通で、正式な外部判断記録は以下の 7 つの論理ブロック・全フィールドを網羅しなければなりません。

### A. Record Identity（記録識別情報）
- `decision_record_id`: 一意の判断記録識別子（発行規則に準拠）。
- `decision_record_revision`: 判断記録の版番号（初期値: `1.0`）。
- `decision_id`: 対象の意思決定項目識別子（`DEC-01A` 〜 `DEC-07` のいずれか1つ）。
- `record_sequence`: 当該 DEC に対する発行通番（`01`, `02`, ...）。
- `record_status`: 記録の状態（`DRAFT`, `ISSUED`, `EFFECTIVE`, `EXPIRED`, `REVOKED`, `SUPERSEDED`, `INVALID`）。
  - ※**重要**: 実行資格判定を通過できるのは **`record_status == EFFECTIVE`** のみです。
- `supersedes_record_id`: 改訂時に無効化・置換する過去の判断記録ID（初版時は `NONE`）。

### B. Package Binding（パッケージ結合情報）
- `package_name`: `OCR_APP_G1_D1_OWNER_DECISION_PACKAGE_R1_8_2026-10-26.tar.gz`
- `package_revision`: `R1.8`
- `package_sha256`: 独立レビューにより確定された実測 SHA-256（自己参照埋め込みを禁止）。
- `package_byte_size`: パッケージの実測バイト数。
- `fixed_repository`: `https://github.com/yohi/ocr-app`
- `fixed_head`: `6b08251170265c444ce8957377e6bfca23b21fd7`（40桁 Git Object ID）
- `independent_review_result_id`: パッケージを審査した独立レビュー結果識別子。

### C. Evidence Binding（証跡結合情報）
- `evidence_ids`: 審査した一次証跡識別子の一覧。
- `evidence_sha256`: 各証跡の SHA-256 チェックサム（証跡IDと1対1で対応付けること）。
- `reviewed_document_ids`: 審査対象とした本パッケージ内の文書ファイル名一覧。
- `precondition_evidence_ids`: 前提条件の成立を証明する証跡IDおよびハッシュ。
- `condition_satisfaction_evidence_ids`: 条件付き承認の付帯条件が充足されたことを証明する証跡IDおよびハッシュ。

### D. Environment Binding（環境結合情報）
- `vm_identifier`: 実行を許可するテスト専用 VM の一意なホスト名または UUID。
- `execution_environment`: 対象環境区分（テスト専用隔離 VM）。
- `host_vm_boundary`: ホスト環境との分離境界（ホストは完全 READ-ONLY）。
- `network_boundary`: ネットワーク隔離要件（ループバックのみ有効、外部通信完全遮断）。
- `secrets_isolation`: 機密情報隔離要件（ホスト Secrets、個人トークン非共有）。
- `docker_socket_isolation`: ホスト Docker Socket 非共有要件（マウント厳禁）。

### E. Authorization Scope（承認操作範囲）
- `approval_method`: 承認方式（`METHOD_A_STAGE_BY_STAGE` または `METHOD_B_CONDITIONAL_PROGRESSION`）。
- `decision_disposition`: 判断区分（`APPROVE`, `CONDITIONAL_APPROVE`, `HOLD`, `REJECT`）。
  - ※**重要 (FND-ODP-007-R13-A)**: `decision_disposition` は後述の `owner_decision` と完全に一致しなければなりません（`DECISION_DISPOSITION_CONSISTENT` 契約）。
- `authorized_stage`: **承認対象 Stage（Method A では必ず単一の Stage 0〜5 のいずれか1つ。複数指定・範囲指定・ワイルドカードは無効。Stage 概念のない DEC は `NOT_APPLICABLE` と明記）**。
- `authorized_operations`: 承認により許可される具体的な操作の一覧。
- `forbidden_operations`: 明示的に禁止される操作の一覧。
- `execution_count_limit`: 許容実行回数の上限（通常は `1` 回）。
- `resource_limits`: メモリ上限（512 MiB）、PID上限（128）、タイムアウト（60s）、並列度（concurrency=1）。
- `required_preconditions`: 実行前に充足すべき前提条件の一覧。
- `stop_conditions`: 直ちに実行を中断・安全停止すべき STOP 条件の一覧。

### F. Validity（有効性・失効契約）
- `effective_conditions`: 承認が効力を持つための必須条件。
- `effective_from`: 承認の発効日時。
- `expires_at`: 承認の失効有効期限。
- `revocation_conditions`: 承認が取消・失効となる条件。
- `revision_invalidation_rules`: 改訂時に旧承認が無効化される規則。

### G. Human Owner Decision & Signature（判断・署名情報: 単一Authority）
- `owner_decision`: Human Owner の判断選択（`APPROVE`, `CONDITIONAL_APPROVE`, `HOLD`, `REJECT`）。
  - ※**重要**: 判断値の単一の正本 Authority。`decision_disposition` との値の不一致は直ちに実行遮断（Fail-closed）。
- `owner_conditions`: Human Owner が課す付帯条件・指示事項。
- `owner_decision_timestamp`: 判断を行った日時（UTC/JST 明記）。
- `owner_signature`: Human Owner 本人による署名（電子署名または手書き署名）。
- `signature_verification_method`: 署名の真正性を検証する方式。

---

## 3. 一意判断記録 ID 発行規則

判断記録 ID の重複、衝突、過去 ID の再利用を完全に防止するため、以下の発行手続きおよび命名規則を強制します。

### 3.1 規範的 ID フォーマット
```text
ODR-G1-D1-<YYYYMMDD>-<PACKAGE_REV>-<DEC_ID>-<STAGE_OR_NA>-<SEQUENCE>
```
- **例1**: `ODR-G1-D1-20261026-R1.8-DEC03-STAGE0-01`
- **例2**: `ODR-G1-D1-20261026-R1.8-DEC01A-NA-01`
- **例3**: `ODR-G1-D1-20261026-R1.8-DEC07-STAGE3-01`

### 3.2 ID 発行および重複防止の 7 原則
1. **個別 ID の一意性**: 発行されるすべての判断記録は、システム全体で完全に一意な ID を持たなければならない。
2. **追加判断時の別 ID 付与**: 同一の DEC に対して再判断・追加指示を行う場合、連番（`SEQUENCE`）をインクリメントし、必ず異なる ID を発行する。
3. **Stage ごとの ID 完全分離**: 対象 Stage が異なる場合、同一の ID を共用することは禁止し、必ず Stage 名を含めた個別 ID を発行する。
4. **再発行・改訂時の新 ID 必須**: 承認の失効、取消、または条件変更により再発行する場合、過去の ID を再利用してはならず、必ず新しい ID を発行する。
5. **ID 再利用の永久禁止**: いかなる理由があっても、過去に使用された判断記録 ID を再利用（リサイクル）してはならない。
6. **監査台帳による一意性追跡**: 連番の割当主体（Human Owner または記録管理システム）は、発行済み ID、対象パッケージ、対象 Stage、発行日時を監査台帳で一元管理し、発行前に重複がないことを静的に検証する。
7. **重複検知時のフェイルクローズ**: 万一、同一 ID の重複や衝突が検知された場合、当該 ID に関連するすべての実行権限は無効（`AUTHORIZATION_INCOMPLETE / NO_EXECUTION_GRANT`）となる。

---

## 4. 各意思決定項目の単一入力判断テンプレート

### DEC-01A: オフライン依存キャッシュインベントリ検査
- **Decision Record ID**: `[未記入・発行規則に準拠]`
- **Record Revision**: `[未記入]` / **Sequence**: `[未記入]`
- **Record Status**: `[未記入]` (実行には `EFFECTIVE` 必須)
- **対象VM識別子**: `[未記入]`
- **Approval Method**: `[未記入]` (推奨: `METHOD_A_STAGE_BY_STAGE`)
- **Decision Disposition**: `[未記入]` (選択: `APPROVE` / `CONDITIONAL_APPROVE` / `HOLD` / `REJECT`)
- **Owner Decision (Authority)**: `[未記入]` (dispositionと完全一致必須)
- **Authorized Stage**: `NOT_APPLICABLE` (固定)
- **Authorized Operation**: `[未記入]` (走査・照合・マニフェスト案作成のみ)
- **Forbidden Operation**: パッケージ転送、インストール、テスト実行、ホスト変更、外部通信。
- **Owner 指示・付帯条件**:
  ```text
  
  ```
- **署名**: ___________________________________ **日付**: 2026-____-____

---

### DEC-01B: オフライン不足依存パッケージ限定転送
- **Decision Record ID**: `[未記入・発行規則に準拠]`
- **Record Revision**: `[未記入]` / **Sequence**: `[未記入]`
- **Record Status**: `[未記入]` (実行には `EFFECTIVE` 必須)
- **対象VM識別子**: `[未記入]`
- **審査証跡 ID**: `[未記入]` (01A マニフェストIDおよびハッシュ)
- **Approval Method**: `[未記入]` (推奨: `METHOD_A_STAGE_BY_STAGE`)
- **Decision Disposition**: `[未記入]` (選択: `APPROVE` / `CONDITIONAL_APPROVE` / `HOLD` / `REJECT`)
- **Owner Decision (Authority)**: `[未記入]` (dispositionと完全一致必須)
- **Authorized Stage**: `NOT_APPLICABLE` (固定)
- **Authorized Operation**: `[未記入]` (特定パッケージの抽出・転送・VM内ハッシュ再検証のみ)
- **Forbidden Operation**: `npm ci` / `npm install` 実行、テスト実行、未承認ファイル持ち込み、外部通信。
- **Owner 指示・付帯条件**:
  ```text
  
  ```
- **署名**: ___________________________________ **日付**: 2026-____-____

---

### DEC-02: 独立ローカルGit環境配備
- **Decision Record ID**: `[未記入・発行規則に準拠]`
- **Record Revision**: `[未記入]` / **Sequence**: `[未記入]`
- **Record Status**: `[未記入]` (実行には `EFFECTIVE` 必須)
- **対象VM識別子**: `[未記入]`
- **Approval Method**: `[未記入]` (推奨: `METHOD_A_STAGE_BY_STAGE`)
- **Decision Disposition**: `[未記入]` (選択: `APPROVE` / `CONDITIONAL_APPROVE` / `HOLD` / `REJECT`)
- **Owner Decision (Authority)**: `[未記入]` (dispositionと完全一致必須)
- **Authorized Stage**: `NOT_APPLICABLE` (固定)
- **Authorized Operation**: `[未記入]` (Gitメタデータ配備および照合検証のみ)
- **Forbidden Operation**: ホスト `.git` 共有、リモート接続、ソース改変、テスト実行。
- **Owner 指示・付帯条件**:
  ```text
  
  ```
- **署名**: ___________________________________ **日付**: 2026-____-____

---

### DEC-03: 再試験実行権限およびリソース上限付与（FND-ODP-001是正: 単一Stage入力）
- **Decision Record ID**: `[未記入・発行規則に準拠]`
- **Record Revision**: `[未記入]` / **Sequence**: `[未記入]`
- **Record Status**: `[未記入]` (実行には `EFFECTIVE` 必須)
- **対象VM識別子**: `[未記入]`
- **Approval Method**: `[未記入]` (選択: `METHOD_A_STAGE_BY_STAGE` / `METHOD_B_CONDITIONAL_PROGRESSION`)
- **Decision Disposition**: `[未記入]` (選択: `APPROVE` / `CONDITIONAL_APPROVE` / `HOLD` / `REJECT`)
- **Owner Decision (Authority)**: `[未記入]` (dispositionと完全一致必須)
- **Authorized Stage**: `[単一Stage識別子のみ記入・未記入]` (例: `Stage 0`)
  - ※**重要**: 複数Stageの併記、範囲指定（例: `Stage 0-3`）、ワイルドカード（例: `ALL`）は**無効**です。1つの判断記録につき必ず単一の Stage のみを記入してください。
- **Authorized Operation**: `[未記入]` (指定単一Stageの実行のみ)
- **Execution Count Limit**: `[未記入]` (通常: 1回)
- **Required Previous-stage Evidence**: `[未記入]` (前提StageのPASSログIDおよびハッシュ)
- **Resource Limits**:
  - メモリ上限: `[未記入]` (初期候補: 512 MiB)
  - PID上限: `[未記入]` (初期候補: 128)
  - 外側タイムアウト: `[未記入]` (初期候補: 60秒)
  - テスト並列度: `--test-concurrency=1` 固定
- **Owner 指示・付帯条件**:
  ```text
  
  ```
- **署名**: ___________________________________ **日付**: 2026-____-____

---

### DEC-04: 全体回帰範囲（全39ファイル）およびGate審査基準合意
- **Decision Record ID**: `[未記入・発行規則に準拠]`
- **Record Revision**: `[未記入]` / **Sequence**: `[未記入]`
- **Record Status**: `[未記入]` (審査合意の有効化には `EFFECTIVE` 必須)
- **Approval Method**: `[未記入]` (推奨: `METHOD_A_STAGE_BY_STAGE`)
- **Decision Disposition**: `[未記入]` (選択: `APPROVE` / `CONDITIONAL_APPROVE` / `HOLD` / `REJECT`)
- **Owner Decision (Authority)**: `[未記入]` (dispositionと完全一致必須)
- **Authorized Stage**: `Stage 5` (Gate基準としての合意)
- **多面的合格契約の承認**:
  - `[  ] EXPECTED_TEST_SCOPE_ACCOUNTED_FOR (全39ファイル)`
  - `[  ] NO_UNEXPLAINED_TEST_OMISSIONS`
  - `[  ] FAIL = 0`
  - `[  ] CANCELLED = 0`
  - `[  ] UNEXPECTED_SKIP = 0`
  - `[  ] UNEXPECTED_TODO = 0`
- **Owner 指示・付帯条件**:
  ```text
  
  ```
- **署名**: ___________________________________ **日付**: 2026-____-____

---

### DEC-05: Group B 診断実験（Gitモック注入）承認
- **Decision Record ID**: `[未記入・発行規則に準拠]`
- **Record Revision**: `[未記入]` / **Sequence**: `[未記入]`
- **Record Status**: `[未記入]` (実行には `EFFECTIVE` 必須)
- **対象VM識別子**: `[未記入]`
- **審査証跡 ID**: `[未記入]` (Stage 3 Primary 失敗ログIDおよびハッシュ)
- **Decision Disposition**: `[未記入]` (選択: `APPROVE` / `CONDITIONAL_APPROVE` / `HOLD` / `REJECT`)
- **Owner Decision (Authority)**: `[未記入]` (dispositionと完全一致必須)
- **Authorized Stage**: `Stage 3` (診断実験スコープ)
- **適用要件**: Stage 3 Primary 失敗確認後、実験前明示承認としてのみ有効。
- **許可範囲**: テストフィクスチャへのGitモック注入実験、診断ログ分離記録。
- **禁止範囲**: 本番コード改変、無条件事前包括承認、正規PASS偽装。
- **Owner 指示・付帯条件**:
  ```text
  
  ```
- **署名**: ___________________________________ **日付**: 2026-____-____

---

### DEC-06: Group C 診断実験（フィクスチャ改善）承認
- **Decision Record ID**: `[未記入・発行規則に準拠]`
- **Record Revision**: `[未記入]` / **Sequence**: `[未記入]`
- **Record Status**: `[未記入]` (実行には `EFFECTIVE` 必須)
- **対象VM識別子**: `[未記入]`
- **審査証跡 ID**: `[未記入]` (Stage 4 Primary 失敗ログIDおよびハッシュ)
- **Decision Disposition**: `[未記入]` (選択: `APPROVE` / `CONDITIONAL_APPROVE` / `HOLD` / `REJECT`)
- **Owner Decision (Authority)**: `[未記入]` (dispositionと完全一致必須)
- **Authorized Stage**: `Stage 4` (診断実験スコープ)
- **適用要件**: Stage 4 Primary 失敗確認後、実験前明示承認としてのみ有効。
- **許可範囲**: TEST-14 非同期クリーンアップ明示フィクスチャ実験、診断ログ分離記録。
- **禁止範囲**: 本番コード改変、外側例外送出の合格扱い、無条件事前包括承認。
- **Owner 指示・付帯条件**:
  ```text
  
  ```
- **署名**: ___________________________________ **日付**: 2026-____-____

---

### DEC-07: STOP発生後の個別ステージ再開承認
- **Decision Record ID**: `[未記入・発行規則に準拠]`
- **Record Revision**: `[未記入]` / **Sequence**: `[未記入]`
- **Record Status**: `[未記入]` (実行には `EFFECTIVE` 必須)
- **対象STOP識別子**: `[未記入]`
- **対象VM識別子**: `[未記入]`
- **Phase A 前提条件確認**: `[  ] Phase A 全9条件充足を客観的証跡により確認済み`
- **Decision Disposition**: `[未記入]` (選択: `APPROVE` / `CONDITIONAL_APPROVE` / `HOLD` / `REJECT`)
- **Owner Decision (Authority)**: `[未記入]` (dispositionと完全一致必須)
- **Authorized Stage**: `[単一Stage識別子のみ記入・未記入]` （単一実行限定）
- **Execution Count Limit**: `1` 回のみ
- **Owner 指示・付帯条件**:
  ```text
  
  ```
- **署名**: ___________________________________ **日付**: 2026-____-____

---

## 5. 発効条件と実行資格判定契約（FND-ODP-R17-001是正: 非循環なNO_ACTIVE_STOPと16条件論理積）

### 5.1 規範的適格性判定の2段階分離（Two-Stage Eligibility Predicates）
従来の単一判定式による「予約前と予約後での実行残数判定の矛盾」を排除し、かつSTOP発生中の新規予約・開始権消費・保護された入場を安全側に完全遮断するため、適格性判定を **スロット予約適格性（`RESERVATION_ELIGIBLE`）** と **実行開始適格性（`START_ELIGIBLE`）** の 2 つの独立した論理述語に厳密に分離し、独立条件 `NO_ACTIVE_STOP` を包含する全16条件の論理積を維持します。

```text
1. スロット予約適格性判定式 (Evaluated at LP-R: RESERVATION_LINEARIZATION_POINT)
   RESERVATION_ELIGIBLE
     = OWNER_DECISION_IS_APPROVAL
       AND DECISION_DISPOSITION_CONSISTENT
       AND RECORD_STATUS_EFFECTIVE
       AND CONDITIONAL_APPROVAL_CONDITIONS_SATISFIED
       AND PACKAGE_IDENTITY_MATCH
       AND FIXED_HEAD_MATCH
       AND INDEPENDENT_REVIEW_BINDING_VALID
       AND OWNER_RECORD_AUTHENTIC
       AND DECISION_SCOPE_MATCH
       AND ENVIRONMENT_MATCH
       AND EVIDENCE_BINDING_VALID
       AND PRECONDITIONS_SATISFIED
       AND EXECUTION_LIMIT_NOT_EXCEEDED
       AND NOT_REVOKED
       AND NOT_EXPIRED
       AND NO_ACTIVE_STOP

2. 実行開始適格性判定式 (Evaluated at LP-S: EXECUTION_START_LINEARIZATION_POINT)
   START_ELIGIBLE(slot_id)
     = SLOT_STATUS_IS_RESERVED(slot_id)
       AND SLOT_NOT_PREVIOUSLY_CONSUMED(slot_id)
       AND BOUND_DECISION_RECORD_STILL_EFFECTIVE(slot_id)
       AND CONDITIONAL_APPROVAL_STILL_SATISFIED(slot_id)
       AND NO_PRIOR_REVOCATION(slot_id)
       AND NO_PRIOR_STOP(slot_id)
       AND ENVIRONMENT_STILL_MATCH(slot_id)
       AND EXECUTION_SCOPE_STILL_MATCH(slot_id)
```

> [!IMPORTANT]
> **予約後における実行残数判定の非依存性**:
> `START_ELIGIBLE` の評価においては、`EXECUTION_LIMIT_NOT_EXCEEDED`（未割当スロット残数 > 0）を再評価してはなりません。スロット予約確定時に残数が 0 に到達していたとしても、正当に予約された当該 `slot_id` 自体が `RESERVED` であり未消費であれば、開始適格性は損なわれません。

### 5.2 必須判定条件の個別定義（全16条件）

#### 1. `OWNER_DECISION_IS_APPROVAL` (肯定的承認判定)
- `owner_decision` が明示的に **`APPROVE`** または **`CONDITIONAL_APPROVE`** であること。
- `HOLD` または `REJECT` の場合、署名が真正であっても **`DECISION_NOT_APPROVING / NO_EXECUTION_GRANT`** となり実行資格を生成しない。

#### 2. `DECISION_DISPOSITION_CONSISTENT` (判断区分整合性 / FND-ODP-007-R13-A)
- `decision_disposition` と `owner_decision` の値が厳格に完全一致していること（`decision_disposition == owner_decision`）。
- **Fail-closed 規則**:
  - `decision_disposition = HOLD` かつ `owner_decision = APPROVE` のような値の不一致や矛盾が存在する場合、**`DECISION_INCONSISTENT / NO_EXECUTION_GRANT`** として即座に実行資格を拒絶する。

#### 3. `RECORD_STATUS_EFFECTIVE` (記録状態有効性)
- `record_status` が厳密に **`EFFECTIVE`** であること。
- `DRAFT`, `ISSUED`, `EXPIRED`, `REVOKED`, `SUPERSEDED`, `INVALID` 等は予約不可。

#### 4. `CONDITIONAL_APPROVAL_CONDITIONS_SATISFIED` (条件充足判定)
- `owner_decision == CONDITIONAL_APPROVE` の場合、付帯条件が具体的に記録され、対応する証跡ハッシュ突合により全条件が充足されていること。未充足時は `CONDITION_PENDING / NO_EXECUTION_GRANT`。
- 無条件承認の場合は追加条件が存在しないことを確認した上で充足扱いとする。

#### 5. `PACKAGE_IDENTITY_MATCH`
- パッケージ名、確定 SHA-256、バイトサイズが審査済み原本と完全一致すること。

#### 6. `FIXED_HEAD_MATCH`
- 固定HEAD `6b08251170265c444ce8957377e6bfca23b21fd7` に作業ツリーが完全一致すること。

#### 7. `INDEPENDENT_REVIEW_BINDING_VALID`
- パッケージに対する審査合格の独立レビュー結果IDが有効に存在すること。

#### 8. `OWNER_RECORD_AUTHENTIC`
- 真正な Owner 署名・タイムスタンプが確認可能であること。

#### 9. `DECISION_SCOPE_MATCH`
- 実行対象の操作および Stage（Method A では単一 Stage）が承認範囲と厳密一致すること。

#### 10. `ENVIRONMENT_MATCH`
- 実行対象 VM 識別子および境界設定（ネットワーク遮断、Socket非共有等）が完全一致すること。

#### 11. `EVIDENCE_BINDING_VALID`
- 審査証跡 ID および SHA-256 が1対1で対応し整合していること。

#### 12. `PRECONDITIONS_SATISFIED`
- 各 Stage の必須進入前提条件（Stage 0 PASS 等）がすべて客観的証跡により充足されていること。

#### 13. `EXECUTION_LIMIT_NOT_EXCEEDED`
- 許容実行回数の未割当残量が存在すること（未消費スロット残存: `remaining_slots > 0`）。※スロット予約時のみ評価。

#### 14. `NOT_REVOKED`
- 承認の取消・無効化が存在しないこと。

#### 15. `NOT_EXPIRED`
- 有効期限（`expires_at`）が切れていないこと。

#### 16. `NO_ACTIVE_STOP` (非STOP状態検証 / FND-ODP-R17-001是正: 非循環なSTOP状態評価)
- 対象 Decision Record、関連する既存 Slot / Attempt、承認対象 Stage、対象 VM、および実行環境全体のいずれにも、現在有効な STOP 禁止効果が存在しないこと。
- **`NO_ACTIVE_STOP = TRUE` の規範的判定基準（循環依存の排除）**:
  1. **権威ある記録の検証可能性**: STOP 状態および履歴が、権威ある監査ログおよび状態管理台帳から客観的に照合可能であること。
  2. **STOP 適用範囲および親子結合の検証**: 6階層（Attempt, Slot, Record, Stage, VM, Environment）の識別子および親子結合関係が検証可能であること。
  3. **現在有効な STOP 禁止効果の不存在**:
     - **ケース A（STOP 発生履歴なし）**: 正規の状態確認により、全 6 階層に有効な STOP 事象が一度も発生していないことが確認された場合、追加の解除判断（DEC-07）を要求することなく直ちに成立する。
     - **ケース B（過去に STOP 発生履歴あり）**: 過去に発生した該当 STOP に対し、`STOP_CLEARANCE_VALID`（DEC-07 Phase A の修復証拠および Phase B の真正な Owner 解除判断、範囲・条件の一致）が成立しており、かつ当該解除以降に新たな未解除 STOP が発生しておらず、上位広域 STOP も残存していないことが確認された場合に成立する。
  4. ※**循環依存の厳格排除 (FND-ODP-R17-001)**:
     - **`NO_ACTIVE_STOP` の成立条件に「DEC-07 Phase C の完了」を含めてはならない**。
     - `NO_ACTIVE_STOP` は Phase C において再実行適格性の一条件として評価される側の述語であり、評価する側とされる側の逆向き循環依存を完全に排除する。
- **Fail-closed 規則**:
  - `NO_ACTIVE_STOP = FALSE`（有効な STOP 禁止状態が残存）の場合: **`ACTIVE_STOP / RESERVATION_DENIED / NO_EXECUTION_GRANT`**。
  - STOP の有無、適用範囲、親子結合、解除記録、証跡整合性が特定不能または相互矛盾する場合: **`STOP_STATE_UNKNOWN / NO_EXECUTION_GRANT`**。
  - 「STOP が観測されなかった」ことと「正規の STOP 状態確認が完了した」ことを絶対に同一視してはならない。

---

## 6. 線形化境界と多層防護契約（LP-R / LP-S / LP-A / 境界調停）

適格性確認直後の取消・失効・STOPの割り込みを防止し、同一承認記録に対する二重予約・二重実行・プロセス起動前後の競合を排除するため、**3つの線形化点（LP-R, LP-S, LP-A）** および **保護されたプロセス入場境界（`PROTECTED_PROCESS_ADMISSION_BOUNDARY`）** を規範的契約として確立します。

### 6.1 規範的状態遷移と線形化点
```text
[ELIGIBILITY_EVALUATION] (最新の承認状態・全16条件の検証)
       │
       ▼ [LP-R: RESERVATION_LINEARIZATION_POINT] (第1線形化点: スロット確定境界)
       │  - RESERVATION_ELIGIBLE (全16条件、NO_ACTIVE_STOP含む) のアトミック検証
       │  - 関連 Attempt / Slot / Record / Stage / VM / 環境の STOP 有無アトミック確認
       │  - 未消費スロット残量の確定減算 (remaining_slots -= 1)
       │  - スロット状態遷移: NOT_ALLOCATED -> RESERVED
       │
       ▼
[RESERVED_SLOT_CONFIRMED] (スロット予約確定状態)
       │
       ▼ [LP-S: EXECUTION_START_LINEARIZATION_POINT] (第2線形化点: 開始権消費確定境界)
       │  - START_ELIGIBLE(slot_id) のアトミック検証 (NO_PRIOR_STOP含む)
       │  - 当該 Slot・関連 Attempt・親 Record・Stage・VM・環境の STOP 有無を確定排除
       │  - スロット状態遷移: RESERVED -> START_CONSUMED (開始権不可逆消費)
       │  - 試行状態遷移: NOT_STARTED -> START_AUTHORIZED_PENDING_ADMISSION
       │
       ▼ (LP-S 合格: 開始権消費済み・入場調停待機)
[PROTECTED_PROCESS_ADMISSION_BOUNDARY] (第3境界: 保護対象プロセス入場調停)
       │
       ▼ [LP-A: PROTECTED_ADMISSION_LINEARIZATION_POINT] (第3線形化点: 入場確定境界)
       │  - 予約済みスロット（START_CONSUMED）の正当性確認
       │  - 全 6 階層における STOP 不成立の確定
       │  - Owner 承認の最新状態および取消（Revocation）不成立の確定
       │  - 対象 VM・Stage・Operation・Attempt の一意性検証
       │  - 起動対象プロセスへの保護対象操作実行許可の不可逆適用
       │  - 入場結果の確定（ADMISSION PASS）
       │  - 試行状態遷移: START_AUTHORIZED_PENDING_ADMISSION -> STARTED
       │
       ▼ (LP-A 合格)
[PROTECTED_EXECUTION] (権限付きテスト実行中)
       │
       ▼
[RESULT_RECORDED / STOPPED / UNKNOWN] (試行終了: スロット自動返却永久禁止)
```

### 6.2 保護されたプロセス入場境界（PROTECTED_PROCESS_ADMISSION_BOUNDARY）規範契約
1. **未仲介実行可能区間の禁止**:
   - 取消・STOP の状態確認と、保護されたプロセス起動許可の適用との間に、未仲介の実行可能区間が存在してはならない。
   - OS プロセスが事前にフォーク／作成されたとしても、LP-A による入場確定（ADMISSION PASS）を受けるまでは、保護対象操作（Gitアクセス、ファイル読取、テストコード実行等）を一切実行できない隔離状態に維持されなければならない。
2. **権限付き実行開始の厳格定義**:
   - 「プロセスオブジェクトの作成」「OS プロセスの exec 起動」「保護対象操作の実行許可」「実際の保護対象操作の開始」を混同してはならない。
   - 本契約における **権限付き実行の開始（STARTED）** は、**LP-A が確定的に合格し、保護対象操作の実行許可が適用された瞬間** を意味する。
3. **必須競合判定契約**:
   - **Revocation が LP-A より前に確定**: `ADMISSION_DENIED / LAUNCH_ABORTED`。スロットは `START_CONSUMED` のまま維持され自動返却禁止。
   - **STOP が LP-A より前に確定**: `ADMISSION_DENIED / LAUNCH_ABORTED`。スロット自動返却禁止。
   - **Revocation と LP-A が競合し順序特定不能**: `UNKNOWN / BLOCKED (FAIL_CLOSED)`。試行状態は `UNKNOWN`。
   - **STOP と LP-A が競合し順序特定不能**: `UNKNOWN / BLOCKED (FAIL_CLOSED)`。試行状態は `UNKNOWN`。
   - **LP-A が先に確定し、その後に Revocation 発生**: 新規 Admission は禁止。すでに実行中のプロセスは停止契約（アボート／シグナル停止）へ移行。
   - **LP-A が先に確定し、その後に STOP 発生**: すでに実行中のプロセスは STOP 契約に従い直ちに停止（`Execution Attempt -> STOPPED`）。
   - **同一 Slot の二重 Admission**: 最大 1 回のみ Admission 成功、2 件目は `DENIED`。
   - **Slot が START_CONSUMED だが Admission 未確定**: 保護対象操作の起動禁止または `UNKNOWN`。
   - **実プロセスが先に作成され Admission 未確定**: 保護対象操作は禁止（`PROCESS_CREATED_BLOCKED`）。
   - **未仲介起動経路の検出**: システムを直ちに停止（`RUNTIME_GATE_BLOCKED / FAIL_CLOSED`）。
4. **Runtime 調停実証に関する規範的判定**:
   ```text
   PROTECTED_ADMISSION_MEDIATION_NOT_ESTABLISHED => NO_EXECUTION_GRANT
   ```
   本契約は文書上の規範的契約定義（`DOCUMENTARY_CONTRACT_ONLY`）であり、以下の免責事項を維持する：
   - `RUNTIME_RESERVATION_LINEARIZABILITY_NOT_VERIFIED`
   - `RUNTIME_START_LINEARIZABILITY_NOT_VERIFIED`
   - `RUNTIME_ADMISSION_LINEARIZABILITY_NOT_VERIFIED`
   - `RUNTIME_PROCESS_ISOLATION_NOT_VERIFIED`
   - `NO_EXECUTION_GRANT`

---

## 7. 3層状態モデルとSTOP解除・再開契約（FND-ODP-R17-001是正: 非循環DAGと状態分離）

「判断記録の有効性」「実行枠の予約消費」「実際のプロセス試行」を単一の `record_status` で混同せず、かつ STOP 解除の有効性判定と再実行適格性判定を非循環に分離した論理契約を確立します。

### 7.1 3層状態機械の定義

| 状態領域 | 状態区分一覧 | 責務と意味 |
| :--- | :--- | :--- |
| **1. Decision Record Status** | `DRAFT`, `ISSUED`, `EFFECTIVE`, `EXPIRED`, `REVOKED`, `SUPERSEDED`, `INVALID` | Human Owner による承認自体の規範的効力・時間的有効期間・明示的取消状態を保持。**実行回数の消費やスロット枯渇、下位の STOP 発生、STOP 解除によって自動的に変質しない。** |
| **2. Execution Slot Status** | `NOT_ALLOCATED`, `RESERVED`, `START_CONSUMED`, `CANCELLED`, `UNKNOWN` | 承認記録から引き当てられた個別の「実行開始枠」のライフサイクルを管理。1スロットは最大1回の開始権のみを持つ。LP-S 通過時に不可逆的に `START_CONSUMED` となる。 |
| **3. Execution Attempt Status**| `NOT_STARTED`, `START_AUTHORIZED_PENDING_ADMISSION`, `STARTED`, `COMPLETED`, `FAILED`, `STOPPED`, `LAUNCH_ABORTED`, `UNKNOWN` | 予約枠に基づいて実際に起動される保護対象プロセス／テスト実行の試行推移を管理。 |

### 7.2 状態分離に伴う安全契約
1. **開始権消費と実行開始の完全分離**:
   - **LP-R 成功時**: `Execution Slot = RESERVED`（承認実行回数の減算）。
   - **LP-S 成功時**: `Execution Slot = START_CONSUMED`（開始権の不可逆消費）。この時点では **`Execution Attempt = START_AUTHORIZED_PENDING_ADMISSION`** に遷移し、**絶対に `STARTED` と混同してはならない**。
   - **LP-A 成功時**: 保護対象操作の実行許可適用が確定し、初めて **`Execution Attempt = STARTED`** へ遷移する。
2. **LP-A 失敗時の確定遷移**:
   - LP-A において取消・STOP・不一致が検知され入場拒絶された場合、`Execution Attempt` は **`LAUNCH_ABORTED`** に遷移する。
   - スロットはすでに `START_CONSUMED` であり、`LAUNCH_ABORTED` からの自動再試行やスロット自動返却は永久に禁止される。
3. **結果不明時のフェイルクローズ**:
   - LP-A の成否判定が競合や監査不能で特定できない場合、`Execution Attempt` は **`UNKNOWN`** に遷移する。
   - `UNKNOWN` を「未実行」と推定して再開することは禁止され、システムの安全停止を維持する。
4. **消費済みスロットの自動返却永久禁止**:
   - 試行結果が `COMPLETED`, `FAILED`, `STOPPED`, `LAUNCH_ABORTED`, `CANCELLED`, `UNKNOWN` のいずれであっても、`Execution Slot` を `NOT_ALLOCATED` へ戻すこと（自動返却）は永久に禁止する。
5. **同一スロットの再利用禁止**:
   - 一度消費されたスロット（`START_CONSUMED`）を別の Attempt や新規開始に再割当することは禁止される。

### 7.3 STOP 適用範囲の 6 階層識別スキーマ
STOP の発生箇所、適用範囲、波及境界を一意に特定するため、すべての STOP 記録は以下の 6 階層で識別され、必須フィールドを保持しなければなりません：
1. `EXECUTION_ATTEMPT` (特定試行でのプロセス停止・異常検知)
2. `EXECUTION_SLOT` (特定実行枠での異常・境界違反)
3. `OWNER_DECISION_RECORD` (特定承認判断に対する執行停止)
4. `STAGE` (特定 Stage 全体に対する進入・実行停止)
5. `VM` (特定実行 VM 全体に対する安全停止)
6. `EXECUTION_ENVIRONMENT` (実行環境全体に対する全面停止)

#### STOP 記録の必須フィールド
- `stop_id`: STOP 事象の一意識別子
- `stop_scope_type`: 上記 6 階層のいずれか 1 つ
- `stop_scope_identifier`: 適用対象の具体的識別子
- `source_attempt_id`: 発生元 Attempt ID（非該当時は `NOT_APPLICABLE`）
- `source_slot_id`: 発生元 Slot ID（非該当時は `NOT_APPLICABLE`）
- `decision_record_id`: 結合親 Decision Record ID（非該当時は `NOT_APPLICABLE`）
- `stage_id`: 結合親 Stage ID（非該当時は `NOT_APPLICABLE`）
- `vm_identifier`: 結合親 VM 識別子（非該当時は `NOT_APPLICABLE`）
- `environment_identifier`: 結合親環境識別子（非該当時は `NOT_APPLICABLE`）
- `stop_reason`: 停止理由の客観的説明
- `stop_effective_state`: `ACTIVE` または `CLEARED`
- `stop_evidence_id`: 停止を記録した監査ログ証跡 ID
- `stop_evidence_sha256`: 停止証跡の SHA-256 チェックサム
- `stop_clearance_record_id`: 解除判断記録 ID（未解除時は `NOT_APPLICABLE`）
- `stop_clearance_status`: `UNCLEARED`, `PARTIALLY_CLEARED`, `FULLY_CLEARED`

### 7.4 論理的親子結合モデル
各実行要素は以下の論理的結合関係を持ち、結合先が解決できない場合、または不一致が存在する場合は即座にフェイルクローズ（`STOP_STATE_UNKNOWN / NO_EXECUTION_GRANT`）とします：
```text
Execution Environment (environment_identifier)
        │
        ▼
       VM (vm_identifier)
        │
        ▼
      Stage (stage_id)
        │
        ▼
Owner Decision Record (decision_record_id)
        │
        ▼
Execution Slot (source_slot_id)
        │
        ▼
Execution Attempt (source_attempt_id)
```

### 7.5 STOP 解除有効性と再実行適格性の非循環契約（FND-ODP-R17-001是正）

#### 1. STOP_CLEARANCE_VALID と EXECUTION_ELIGIBLE の厳格分離
STOP 解除自体の有効性判定と、再実行資格の判定は以下の通り完全に分離された別個の概念として定義されます：
- **`STOP_CLEARANCE_VALID` (STOP解除有効性判定)**:
  - 特定の過去の STOP 事象に対し、DEC-07 Phase A（原因特定・修復証拠収集）および Phase B（真正な Human Owner 解除判断）が完了し、解除対象範囲・付帯条件・証跡ハッシュが完全一致していること。
  - **重要**: `STOP_CLEARANCE_VALID` の評価は、**DEC-07 Phase C の完了を一切必要としない**。
- **`EXECUTION_ELIGIBLE` (再実行適格性判定)**:
  - スロット予約（`RESERVATION_ELIGIBLE` 全16条件）または実行開始（`START_ELIGIBLE`）の全条件が充足していること。
  - **非同一性の原則**:
    ```text
    STOP_CLEARANCE_VALID DOES NOT IMPLY EXECUTION_ELIGIBLE
    ```
    STOP 解除が有効であっても、別承認（DEC-03）、Stage 進入前提条件（Stage 0 PASS 等）、実行回数残量、環境条件が未充足であれば実行は一切許可されない。

#### 2. DEC-07 Phase A/B/C の規範的非循環 DAG
```text
[STOP EVENT 発生]
       │
       ▼
[Phase A: Pre-approval Evidence Collection & Verification]
  - 原因特定、証跡保全、修復文書化、HEAD/隔離境界再検証
       │
       ▼ (Phase A PASS)
[Phase B: Human Owner Decision]
  - 真正な Owner 判断 (APPROVE / CONDITIONAL_APPROVE / HOLD / REJECT)
       │
       ▼ (Owner 解除判断成立)
[STOP Clearance Validation: STOP_CLEARANCE_VALID 判定] (Phase C 完了を要求しない)
  - 解除記録の真正性、対象 STOP ID・範囲・証跡ハッシュの照合
       │
       ▼ (解除有効確認)
[Current STOP State Evaluation: NO_ACTIVE_STOP 判定] (全 6 階層の有効 STOP なし)
       │
       ▼ (NO_ACTIVE_STOP = TRUE)
[Phase C: Post-approval Execution Eligibility Check] (適格性判定式による独立再検証)
  - RESERVATION_ELIGIBLE / START_ELIGIBLE による全適格性条件の検証
       │
       ▼ (Phase C PASS)
[LP-R: Slot Reservation] -> [LP-S: Start Authorization] -> [LP-A: Protected Admission]
```
※上記 DAG において、下流の Phase C や LP-R/S/A の結果が上流の `STOP_CLEARANCE_VALID` や `NO_ACTIVE_STOP` の定義へ循環して逆流することは厳格に排除される。

#### 3. STOP 波及規則と状態分離の維持
- **子から親への波及**: Attempt または Slot に未解除の有効 STOP が存在する場合、結合親 Decision Record による新規スロット予約（LP-R）は即座に拒絶（`RESERVATION_DENIED`）される。
- **親から子への波及**: 上位（Record, Stage, VM, Environment）に有効 STOP が存在する場合、配下の全 Slot / Attempt の開始（LP-S）および保護入場（LP-A）は全面遮断される。
- **狭い解除での広域解除禁止**: Attempt や Slot 単位の個別解除判断によって、Stage, VM, 環境全体の広域 STOP が自動解除されることはない。
- **状態書換えの禁止**: STOP 解除が行われても、親 Decision Record の `record_status`、スロット割当残数、Stage 承認（DEC-03）が自動変更されることはない。

---

## 8. 静的反証ケース（Static Falsification Test Cases / T01〜T25）

本契約が論理的に完全であり、循環依存を排除して反証可能であることを証明するため、以下の 25 ケースに対する静的判定期待値を規定します。

| ケースID | シナリオ | 規範的期待判定 | 競合順序 / 必須要件 | 未実証のRuntime要件 |
| :--- | :--- | :--- | :--- | :--- |
| **T01** | STOP履歴なし、完全な状態確認成功 | `NO_ACTIVE_STOP = TRUE` | STOP未発生 -> DEC-07解除要求なしで成立 | 状態確認整合性検証器 |
| **T02** | STOP履歴なし、状態情報取得失敗 | `UNKNOWN / BLOCKED` | 状態不明 -> `STOP_STATE_UNKNOWN` | 監査Brokerフェイルセーフ |
| **T03** | STOP履歴なし、記録完全性未検証 | `UNKNOWN / BLOCKED` | 完全性未検証 -> Fail-closed | 監査ログ署名照合器 |
| **T04** | STOP有効、Phase A未完了 | `DENY (PHASE_A_PENDING)` | Phase A 未充足 -> 解除判断へ進めず | 修復証跡監査機構 |
| **T05** | Phase A完了、Phase B未承認 | `DENY (PHASE_B_PENDING)` | Owner 判断未取得 -> 解除不可 | Owner意思決定ゲート |
| **T06** | Phase BがHOLD | `DENY (DECISION_HOLD)` | 解除保留 -> STOP有効継続 | 判断区分強制機構 |
| **T07** | Phase BがREJECT | `DENY (DECISION_REJECT)` | 解除却下 -> STOP有効継続・再試験中止 | 停止状態維持機構 |
| **T08** | Phase B承認、解除範囲不一致 | `DENY (SCOPE_MISMATCH)` | 範囲不一致 -> 解除無効 | 範囲識別子照合器 |
| **T09** | Phase B承認、解除証跡不一致 | `DENY (HASH_MISMATCH)` | ハッシュ不一致 -> 解除無効 | SHA-256突合検証器 |
| **T10** | Phase A/B完了、真正な解除記録成立 | `STOP_CLEARANCE_VALID = TRUE` | Phase C 完了を要求せず解除有効性を判定 | 解除記録整合性検証器 |
| **T11** | STOP Clearance有効、Phase C未実施 | 実行禁止 (`NO_EXECUTION_GRANT`) | `STOP_CLEARANCE_VALID` だけでは実行不可 | 適格性ゲートウェイ |
| **T12** | STOP Clearance有効、Phase Cの別条件失敗 | 実行禁止 (`PRECONDITIONS_NOT_MET`) | 他条件未充足 -> 実行遮断 | 多面的適格性判定器 |
| **T13** | STOP Clearance有効、別のStage STOP残存 | `DENY (ACTIVE_STAGE_STOP)` | 広域STOP残存 -> 予約・開始遮断 | 階層的STOP照合器 |
| **T14** | STOP Clearance有効、別のVM STOP残存 | `DENY (ACTIVE_VM_STOP)` | 広域STOP残存 -> 予約・開始遮断 | 階層的STOP照合器 |
| **T15** | STOP Clearance成立後、新規STOP発生 | `DENY (NEW_STOP_ACTIVE)` | 新規STOP確定 -> 旧解除の流用不可 | イベント線形化監視 |
| **T16** | 狭いAttempt解除で環境STOP解除を要求 | `DENY (CANNOT_CLEAR_BROAD_STOP)` | 狭い解除での広域解除禁止 | 権能・範囲照合器 |
| **T17** | `NO_ACTIVE_STOP`がPhase C成功を要求 | `CIRCULAR_DEPENDENCY / FAIL` | 循環依存の存在をテストで検出・排除 | 静的DAG検証機構 |
| **T18** | Phase Cが`NO_ACTIVE_STOP`を評価 | 非循環に評価可能 (`PASS`) | 一方向DAG -> 正常に適格性評価 | 順序保証評価器 |
| **T19** | DEC-07解除有効、DEC-03未承認 | 実行 `DENY (DEC_03_NOT_APPROVED)` | 解除と枠承認の分離維持 | 独立承認整合器 |
| **T20** | STOPなし、DEC-07記録未発行 | 他の15条件へ進行可能 | 架空の解除記録要求なし | 条件分岐判定器 |
| **T21** | Attempt STOPが未解除 | 親Record新規予約 `RESERVATION_DENIED` | 子STOP -> 親新規予約遮断 | 親子波及監視機構 |
| **T22** | Slot STOP解除済み、Stage STOP残存 | `DENY (ACTIVE_STAGE_STOP)` | 親STOP有効 -> 実行遮断 | 階層的STOP照合器 |
| **T23** | LP-Rと新規STOPが競合（順序特定不能） | `UNKNOWN / BLOCKED` | 順序不明 -> Fail-closed停止 | アトミック調停器 |
| **T24** | LP-Sと新規STOPが競合（順序特定不能） | `UNKNOWN / BLOCKED` | 順序不明 -> Fail-closed停止 | アトミック調停器 |
| **T25** | LP-Aと新規STOPが競合（順序特定不能） | `UNKNOWN / BLOCKED` | 順序不明 -> Fail-closed停止 | アトミック調停器 |

---

## 9. 失効条件および終了規則（Revocation Conditions & Termination Rules）

承認記録の失効・無効化、および実行可能スロットの終了は以下の規則に従って明確に区別して取り扱われます：

### 9.1 判断記録の失効・無効化事由（Record Status -> REVOKED / EXPIRED / INVALID）
以下のいずれかの事象が発生した場合、当該判断記録は直ちに効力を失い、自動的に無効化されます：
1. 固定HEAD（`6b08251170265c444ce8957377e6bfca23b21fd7`）からのソースツリーの逸脱（`INVALID`）。
2. 対象パッケージの確定 SHA-256 不一致（`INVALID`）。
3. 実行範囲、テスト対象ファイル（39ファイル）、セキュリティ境界（ネットワーク・Socket隔離）の変更（`INVALID`）。
4. 対象 VM 環境の変更（`INVALID`）。
5. 有効期限（`expires_at`）の到来（`EXPIRED`: 時間的失効のみ）。
6. STOP 条件への抵触（STOP 発生時点で既存の承認は執行停止）。
7. Human Owner による明示的な取消（`REVOKED`）。

### 9.2 スロット枯渇時の取扱（Record Status は不変、新規スロット予約のみ禁止）
- 承認された許容実行回数のスロット割当が完了（`remaining_slots == 0`）した場合：
  - **`record_status` は `EFFECTIVE` のまま維持され、`EXPIRED` や `REVOKED` に変質してはならない。**
  - 単に新規スロット予約（LP-R）が `EXECUTION_LIMIT_NOT_EXCEEDED` 違反により拒絶（`DENY (NO_REMAINING_SLOTS)`）される。
  - すでに予約済みの有効スロットが存在する場合、当該スロットは `START_ELIGIBLE` を評価して正常に開始権消費および LP-A 調停へ進むことができる。
