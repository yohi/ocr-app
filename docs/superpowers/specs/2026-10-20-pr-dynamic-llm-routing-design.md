# OCR App — PR別動的LLMルーティング Superpowers Design Spec R4（限定設計是正）

- **作成日**：2026-10-20（JST）
- **対象**：[yohi/ocr-app](https://github.com/yohi/ocr-app)
- **厳密な参照ベースライン**：`68c5739c2570039fc62a4ed4814684ac65584791`（R2/R3と同一。新HEADへ自動追従しない）
- **入力正本**：`ocr-app-pr-dynamic-llm-routing-superpowers-design-r3-20261020.md`／R4限定是正指示
- **成果物（R4初版当時）**：本R4 Design Specと別冊R4 G0 Review Handoff。**Implementation Planは未作成（当時）**。
- **種別**：Architectural design / Document-only limited correction
- **状態（R4初版当時）**：`R4_CORRECTIONS_PROPOSED / G0_PENDING_OWNER / NOT_IMPLEMENTED / NOT_RUNTIME_VERIFIED`
- **強制制約**：DO NOT MODIFY SOURCE CODE / DO NOT IMPLEMENT / DO NOT WRITE GITHUB / DO NOT CALL DECISION API / DO NOT ACTIVATE SHADOW OR ENFORCE。
- **凍結する判定**：R2 A〜D、R2-FND-001/003/005は`RESOLVED_IN_PROPOSAL`を維持。R3-FND-001/002、R2-FND-004残余、R2-FND-002残余のみ本改訂対象。
- **Owner Decision（R4初版当時）**：G0-D01〜D07は全件`PENDING_OWNER`。技術的な提案是正はOwner承認・モデル認定・API許可・実行認可を意味しない。

> **RG-R1設計・計画整合性の限定追補（2026-10-20、原R4を履歴として保存）**：本書のR4初版に記された`G0-D01..D07=PENDING_OWNER`／`IMPLEMENTATION_PLAN=NOT_CREATED`／`DESIGN_PLAN_CONSISTENCY=NOT_REVIEWED`は**R4初版作成時点のスナップショット**である。現在の実効状態は§15.2の追補を**優先**して読む。Human Ownerはチャット上で7件の**基本方針のみ承認**、Implementation Planは既に作成済み。ただし個別repo egress grant、モデル認定、Secret設定、監査削除・事故保全等の運用認可、実装／起動、G1〜G4、および独立Design↔Plan PASSは**いずれも未成立**。RG-R1**文書作成の時点**ではGitHubへの反映を実施しなかったが、その後2文書は`4df169ffa5fa5da33bb4b0d21d2580afb1d1c8e7`としてpushされた。現在のRG-R2限定改訂はローカルのみでGitHubへは反映しない（§15.2）。

## 変更管理とスコープ固定

今回の更新は**文書上の設計契約と未来の受入テスト要求**を明確化することのみ。R3で確定した方針を不要に再審査せず、R4で確定する監査→公開ゲート、カタログのJSON Schema、strict projection、attempt callbackに変更を限定する。Cloudflare Worker、OCR review engine、reviewable選別、off/shadow/enforce、OpenRouter Decisions API、Mercury Decide優先、Antigravity Host、既存review schemaを変更しない。実行モードは既定`off`のまま。Modelの能力は認定済カタログで強制し、Decision回答は常にadvisory。**raw diff、file paths、PR title、Secretsを外部に渡さない。**

## R2 A〜D 是正状態（引継ぎ）
| ID | 指摘 | R2での是正 | 残存する検証 |
|---|---|---|---|
| A | Mercury DecideはChat CompletionsでなくDecisions API | §3と§6の専用Adapter、`model/state/questions`、`answers`契約 | G1 mock / G2実API |
| B | 高リスクPRでもfallbackで低能力モデルに降格し得る | §7.1の`fallbackModels`明示配列。off/shadowはlegacy維持 | G1 tri-stateとrunnerテスト |
| C | OCR reviewable=0でcontext差分が空、PR全変更を見られない | §4でrisk input=ALL_CHANGED_FILES、review scope=OCR分離 | G1 rename/delete/binary/0件fixture |
| D | shadowでは選択モデルの品質を測定できない | §14でG2観測指標とG3比較実験を分離 | G3の実行・独立裁定 |

**評価判定**：設計上の是正案は作成したが、**G0は未通過**。Ownerの承認権限、実行・デプロイ権限、API利用許諾をこの文書は付与しない。

## 1. 目的と成功条件

GitHub Pull Request（PR）ごとに変更の種類・危険度・規模・テスト状況などから、レビューに使うLLMを選択する。Jev系System One / Decision Modelは**選択の補助**として使用し、許可モデル・最低レビュー深度・失敗時挙動は決定的なアプリケーションコードが強制する。

**v1の成功条件**
1. 既存のWebhook→`repository_dispatch`→GitHub Actions→Antigravity→レビュー投稿を維持する。
2. 有効なDecision応答がある場合、PR特性に応じて`fast` / `deep`のレビュー戦略を選択できる。
3. 重大領域の**パス・Gitメタデータ上の兆候**はOCR対象外を含む全変更集合から検出して`deep`下限とする。ただし**任意コードの本文内にある認証・権限・Secrets等の変更をメタデータだけで発見できるとは主張しない**。未認定・分類不能のコード変更も`deep`とする。
4. Decision API停止・429・不正応答・低確信時は**安全な決定的フォールバック**を適用する。レビューを無断スキップしない。`off`では既存の固定モデル選択・フォールバック挙動を変更しない。
5. モデル選択の根拠・モデルID・許可特徴量・PRのHEAD SHA・実行試行と検証済み成功モデルを追跡可能にする。Secrets・差分全文はログに残さない。
6. 現行のレビュー対象選別、サンドボックス、レビュー結果検証、既知誤検知のフィルター、PR HEAD再検証、レビューコメント重複排除を壊さない。
## 2. 実装現状と挿入位置

以下はリポジトリの実ファイルで確認できた事項。

| コンポーネント | 現行挙動・制約 | v1の方針 |
|---|---|---|
| `cloudflare-worker/src/index.ts` | Webhook署名を検証し、対象PRをdispatchする | 原則変更しない |
| `.github/workflows/ocr-engine.yml` | 対象PRをcheckoutしOCR Previewとレビューコンテキストを生成 | `Prepare trusted review context`の直後に選択ステップを追加 |
| `.github/workflows/scripts/prepare-ocr-review-context.mjs` | OCR対象・対象外一覧、適用ルール、レビュー可能ファイルが0件なら空の`diff`を返す | **既存のOCR選別・context生成は変更しない**。PRリスクは別スクリプトでローカルGitの**全変更集合**から抽出 |
| `.github/workflows/scripts/antigravity-host.mjs` | `runHost({model})`があり、`agy --model`で選択可能。既存fallbackは`fallbackModel || env.ANTIGRAVITY_FALLBACK_MODEL` | `off/shadow`の旧挙動を保持し、`enforce`のみ明示的な許可済みfallback配列を適用 |
| `.github/workflows/scripts/resolve-threads.mjs` | `RESOLVE_LLM_MODEL`または`OCR_LLM_MODEL`を使用 | v1では変更しない |
| `.github/workflows/scripts/antigravity-policy.test.mjs` | settings.jsonのサンドボックス・モデル設定の契約を検査 | セキュリティ契約とテストを維持し、必要なら限定改訂する |

**R3で確定しR4でも維持する信頼境界**：GitHub APIのリポジトリ属性取得とOwner管理のtrusted allowlist照合を、Decision Providerの送信前に実施する。Antigravity Host内部の試行イベントはレビュー結果JSONとは別の監査チャネルに記録する。

**現行の実行モデル設定**：`OCR_LLM_MODEL` / `ANTIGRAVITY_MODEL`、既定値`gemini-3.8-flash-medium`。既存の障害時フォールバックは`ANTIGRAVITY_FALLBACK_MODEL`、既定値`claude-opus-4-6-thinking`。これらは現行Antigravity CLI経由の名称であり、外部LLMプロバイダーのAPIモデルIDと混同しない。

```text
GitHub PR ─> Cloudflare Worker ─> repository_dispatch
                                  │
                        .github/workflows/ocr-engine.yml
                                  │
                        Checkout + OCR Preview
                                  │
                        Prepare trusted review context
                                  │
                       [NEW] Extract PR features (all local Git changes)
                                  │
                       [NEW] Strict classification + deterministic risk floor
                                  │
                       [NEW] Trusted egress authorization -> Decision Adapter (optional)
                                  │
                       [NEW] Policy-enforced model resolver
                                  │
                       Existing restrictive Antigravity policy
                                  │
                       Existing runHost({model: selectedModel}) + separate attempt audit
                                  │
                       既存filter/validation → HEAD再検証 → final audit → Artifact → publish gate → publish（enforceのみ）
```
## 3. 採用候補と技術選定（A対応：専用Decisions API）

OpenRouter公開ページを2026-10-20に再確認した。無料モデルの提供・レート制限・`alpha` API契約は将来変更され得る。**実API呼び出しは未実施**。

| 決定モデル | OpenRouterモデルID | 役割と採否 |
|---|---|---|
| Inception Mercury Decide (free) | `inception/mercury-decide:free` | `choice`で`fast/deep`を助言するv1第一候補。実APIとPRサンプルでの精度検証が必要 |
| Respan Span-01 Lite (free) | `respan/span-01-lite:free` | 条件判定や監視の比較対象。主ルーターとしての互換性・品質は未検証 |
| TypeSafe Jev 1.14 | `typesafe/jev-1.14` | 比較用。予算承認なしで自動呼び出ししない |

- **エンドポイント**：`POST https://openrouter.ai/api/alpha/decisions`。通常の`/api/v1/chat/completions`やAntigravityの`agy --model`とは**独立したプロトコル**。
- **入力**：`{model, state, questions}`、`questions.review_strategy.type = "choice"`。
- **出力契約**：`answers.review_strategy`に`type`, `choice`, `probabilities`, `confidence`等が含まれる想定。実際のレスポンス契約は公式サンプルに基づきG1でmock検証し、G2で実APIを使って確認する。
- **無料枠**：OpenRouterは無料モデルを原則20 RPM / 50 RPD、累計10 USD以上のクレジット購入歴があるアカウントは1,000 RPDと案内。**無料モデルごとに別々の50 RPD枠があるとは解釈しない**。決定プロバイダーは1 PRにつき最大1回、再試行なし。有料モデルへのサイレント切替は禁止。
- **将来の可搬性**：プロバイダー固有HTTP・検証・エラー正規化を`decision-provider.mjs`へ隔離。ルーティング・ポリシー層はHTTPレスポンス構造に依存させない。

**参考**：[Mercury Decide](https://openrouter.ai/inception/mercury-decide:free)、[Decisions API実例](https://openrouter.ai/blog/insights/what-is-jev/)、[無料枠](https://openrouter.ai/pricing)。
## 4. PR特徴量とレビュー対象の二集合（R2-C維持 / R2-FND-001、004）

### 4.1 変更集合・パース責任・不完全時挙動

- **`ALL_CHANGED_FILES`（risk入力）**：trusted runnerのGit repositoryから、検証済みbase/headに対する全変更集合（追加・変更・削除・rename/copy・バイナリ・submodule・モード変更を含む）を採取。`ocr delegate preview`の選別に依存しない。
- **`OCR_REVIEWABLE_FILES`（review出力範囲）**：従来のOCR Previewで決めた対象のみ。対象外ファイルへの指摘禁止は維持する。
- **抽出境界**：`git diff --name-status -z` / `--numstat -z` / mode metadataを、シェル展開なしの固定引数でtrustedスクリプトが読み取り、rename旧名/新名・NUL形式・未知status・`-`（binary）・巨大出力を正しく扱う。PR由来のscriptは実行しない。
- **不完全**：Git取得不良、無効base/head、parse不明、出力上限、モデル分類辞書不整合は`features_incomplete=true`、`classification_status=incomplete`、`risk_floor=deep`。必要に応じモデル判定通信は省略する。実装者は欠損値を`0`や`false`で安全と見せかけてはならない。
- **レビュー対象0件**：Git全変更集合に対する特徴量抽出は実施し、scope gapがあれば監査警告を生成するが、Decision APIは呼ばず、OCRレビューの既存skip契約は変更しない。G0-D04のblocking未決裁時に自動的な新規blockingを実装しない。
- **判定能力の限界**：メタデータはコード内容を読まない。任意の`src/utility.ts`内に隠れた権限変更・Secret処理はパス検出からは導けない。`metadata_not_observed`は「脅威不存在」を意味しない。

### 4.2 正規の内部FeatureSchema v3（ローカル専用）

内部正規形式を **`InternalPRFeatures/v3`** とする。生成責任者は`extract-pr-review-features.mjs`（将来実装するtrusted extractor）で、入力はGit全変更集合＋OCR Preview＋既に検証済みHEADである。仕様上の必須フィールドと型：

| フィールド | 型・必須値 | 語義・取扱い |
|---|---|---|
| `schema_version` | literal `"3"` | 内部形式のversion。DecisionStateのversionと混同しない |
| `head_sha` | 40文字hex | ローカル監査・run拘束のみ |
| `all_changed_files` | ローカル限定の正規化レコード配列 | path / status / mode / numstat等。**外部送信不可** |
| `ocr_reviewable_paths` | ローカル限定集合 | OCR Previewと照合。**外部送信不可** |
| `all_changed_file_count`, `reviewable_file_count`, `excluded_file_count`, `additions`, `deletions` | 非負整数または計算不能時は`null` | `null`があれば不完全扱い |
| `change_size` | ``small` / `medium` / `large` / `unknown`` | trusted境界表で決定 |
| `language_families` / `change_areas` | 正規化列挙配列 | パス等からの**観測可能な兆候のみ** |
| `test_files_changed` | boolean | テストファイル**名**の変更有無。テスト品質・実行証明ではない |
| `security_signal`, `migration_signal` | ``metadata_positive` / `metadata_not_observed` / `unassessable`` | `metadata_not_observed`を安全証明に使わない |
| `classification_status` | ``allowlisted_docs_only` / `high_risk_metadata` / `unclassified_code` / `unclassified_other` / `incomplete`` | 排他的なPR全体クラス。§5の優先順を適用 |
| `features_incomplete`, `review_scope_gap` | boolean | 不明/対象範囲不足を隠さない |
| `risk_floor` | ``fast` / `deep`` | 内部ポリシー計算結果。外部回答では降格不可 |

Gitのoriginal filenameや全ファイルパスは**ローカルでのみ**保持し、特徴量投影後はDecision通信・送信ログに一切持ち込まない。リポジトリID、公開属性、allowlist決裁状態などの**認可情報はFeatureSchemaとは別のtrusted権限コンテキスト**として保持する。

### 4.3 外部DecisionState v1（唯一の送信スキーマ）

外部用正規形式は **`DecisionState/v1`**、`schema_version: "1"`。`buildDecisionState(features: InternalPRFeatures/v3): DecisionState/v1`（将来のtrusted converter）のみが厳密な許可リストから**新規JSON object**を生成する。`InternalPRFeatures/v3`と`DecisionState/v1`は**別スキーマ**であり、同じキー集合・同じversionにはならない。内部を外部にspread/copy、浅いclone、JSON化してからのブラックリスト削除によって投影することは禁止する。入力内部v3のversion・必須フィールド・型・列挙を検証し、**固定の15キーをフィールドごとに再構成**してから外部v1の正規スキーマで再検証し、適格性とegress grantを確認してはじめて送信できる。

**唯一の外部許可キー集合（全て必須。extra key不可）**：

| キー | 型と厳密な許容値 |
|---|---|
| `schema_version` | literal `"1"` |
| `all_changed_file_count_bucket`, `reviewable_file_count_bucket`, `excluded_file_count_bucket` | `0`, `1-5`, `6-20`, `21-100`, `101+` |
| `additions_bucket`, `deletions_bucket` | `0`, `1-100`, `101-500`, `501-2000`, `2001+` |
| `change_size` | `small`, `medium`, `large`, `unknown` |
| `language_families` | 重複なし昇順配列、最大12件。各要素∈`markdown,python,typescript,javascript,json,yaml,sql,shell,terraform,other,unknown`（計11種） |
| `change_areas` | 重複なし昇順配列、最大12件。各要素∈`docs,ci,auth,iam,secret,crypto,migration,deploy,payment,other,unknown`（計11種） |
| `test_files_changed`, `review_scope_gap`, `features_incomplete` | boolean |
| `security_signal`, `migration_signal` | `metadata_positive`, `metadata_not_observed`, `unassessable` |
| `classification_status` | `allowlisted_docs_only`, `high_risk_metadata`, `unclassified_code`, `unclassified_other`, `incomplete` |

count bucketの境界は0 / 1〜5 / 6〜20 / 21〜100 / 101以上。add/deleteは0 / 1〜100 / 101〜500 / 501〜2000 / 2001以上。加減算不能な場合は内部`features_incomplete=true`とし、数量は外部への送信を**行わず**ローカル決定的fallbackを使用する（不明数値を`0`へ変換しない）。列挙値を作れないときは`unknown`を入れ、`features_incomplete=true`と`risk_floor=deep`にする。配列サイズが許容値を超えた際の黙示切捨て禁止。

- API bodyは`{model, state: DecisionState/v1, questions: trusted_constant}`。`questions`はtrusted定数でPR文字列による変更を受けない。
- **決して送らないもの**：raw diff、ファイルパス、PRタイトル・本文、リポジトリ名/ID、コミットメッセージ、Secret、GitHub token、自由入力文字列、権限grantの内部情報、監査識別子。
- Privacy上の許可と形式上の許可は独立条件であり、**両方PASSするまで外部リクエストゼロ**（§6.1、§10）。
- ここに記したenum、バケット、version、必須キーが正規仕様。§6の例はこれに完全一致しなければならない。フィールド追加はversion管理とG0再評価対象とする。
- **strict projectionの責任**：trusted converterはpath、raw diff、PRタイトル/本文、repo識別子、Secretをexternal stateへ参照転写しない。入力側に禁止された新規プロパティが紛れた場合は内部v3 schema違反で拒否する。許可fieldの内部値に任意テキストが混入した場合はenum/整数/型検証で拒否する。外部v1に予期しないキー・プロトタイプ由来属性・`null`不許可値があれば**POST 0**。
- **T-005の正規期待結果**：内部v3と外部v1が同一であるというassertionは誤り。`strict_project(valid_internal_v3)`が`exact_15_keys(valid_external_v1)`を満たし、内部ローカル専用キーが外部へ**0件**であることを検証する。§4.3と§6.2のstate例のJSON deep-equalityはT-006として維持する。

```json
{
  "schema_version": "1",
  "all_changed_file_count_bucket": "6-20",
  "reviewable_file_count_bucket": "1-5",
  "excluded_file_count_bucket": "6-20",
  "additions_bucket": "101-500",
  "deletions_bucket": "1-100",
  "change_size": "medium",
  "language_families": ["typescript", "yaml"],
  "change_areas": ["auth", "ci"],
  "test_files_changed": true,
  "security_signal": "metadata_positive",
  "migration_signal": "metadata_not_observed",
  "review_scope_gap": true,
  "features_incomplete": false,
  "classification_status": "high_risk_metadata"
}
```

この例は**外部送信可能な構造例**に過ぎず、実PRの安全評価・外部API実行を示さない。
## 5. 決定的分類 / Risk Floor（R2-FND-001）

### 5.1 fast適用可能クラスの明示的な限定

`fast`下限は**次の条件をすべて満たすPRのみ**：

1. 全変更集合の解析が完全で、ファイル数が1以上、各エントリのpath・Git status・file mode・拡張子が検証済み。
2. 変更後およびrename前の全パスが、trusted catalogの**非実行Markdown-only allowlist**（初期提案：ルート`README.md`または`docs/**/*.md`）に一致する。
3. `AGENTS.md`、policy/security/identity/auth/credential/permission/secretを含む高影響文書のdenylist、`.github/`や設定・実装・テスト実行に関わる任意のpathには一致しない。`docs/`内でもdenylistを優先し、曖昧なら`deep`。
4. 全Git statusが既知の通常テキスト変更（`A`/`M`）に限定。rename/copy/delete、binary、symlink、submodule、mode変更、Git metadata不明は`deep`。
5. `security_signal=metadata_not_observed`かつ`migration_signal=metadata_not_observed`、`features_incomplete=false`、`review_scope_gap=false`。
6. 信頼済み規則以外から`fast_eligible`を推定しない。**内容検査なしのファイルは「安全と証明された」のではなく「許可済み非実行文書クラスに属する」だけ**。

`fast`が許されるのは**LLMを選ぶ際の能力下限**という意味であり、コード/PRにセキュリティ上の欠陥が無いとの保証ではない。`fast`に属する文書本文のレビューはOCR既存契約のままで、任意の指示や危険な命令を信頼しない。

### 5.2 分類優先順位（PR全体のクラス）

| 優先 | 条件 | `classification_status` | `risk_floor` |
|---|---|---|---|
| 1 | 解析不能、欠損、上限超過 | `incomplete` | `deep` |
| 2 | path/メタデータ上のauth/IAM/secret/crypto/migration/payment/deploy等の高リスク兆候 | `high_risk_metadata` | `deep` |
| 3 | 認定された非実行文書クラス以外のコード変更（普通の`.ts` / `.py` / `.sql`等も含む） | `unclassified_code` | `deep` |
| 4 | 不明ファイル種・未知status・実行可能設定・テスト/CI変更などその他 | `unclassified_other` | `deep` |
| 5 | **すべて**§5.1を満たす場合だけ | `allowlisted_docs_only` | `fast` |

**重要な例**：`src/util.ts`の10行変更は、path上auth/secretが不明でも`unclassified_code`→`deep`。`README.md`だけの既知normal changeは`allowlisted_docs_only`→`fast`下限。`README.md + src/util.ts`は`deep`。`README.md -> src/util.ts`へのrenameも`deep`。`docs/security-policy.md`は`deep`。パス上auth検知と本文の認証変更は異なる概念で、後者をパスだけで検知したとは記録しない。

Decision応答は**advisory**であり、`deep`下限を`fast`に下げられない。分類規則・denylist・allowlistの変更はtrusted catalogのversion更新と回帰テストを要する。

### 5.3 review_scope_gapとG0-D04

`review_scope_gap=true`は、全変更集合のうち高リスクまたは分類不能な変更がOCR reviewableに含まれない場合を含む。v1でレビュー対象は拡張しない。`off/shadow`は従来レビュー継続＋独立監査警告（`off`では新規ルーティング動作・通信は行わないため警告は既存経路に追加しない）。G3以降の`enforce`でblockingするかどうかは**G0-D04のOwner決裁が必要**。未決裁のまま新しいblockingを実施しないし、逆に未充足を「深いレビュー済み」と表示しない。
## 6. Decision API と送信認可（R2-A維持 / R2-FND-003、004）

### 6.1 authoritative egress boundary

Decision Providerは、PR由来データの`private=false`、README記載、ラベル、branch名、payloadの`visibility`、文字列に現れた許可宣言を**権威として利用しない**。

- **属性取得者**：`ocr-engine.yml`内のtrusted authorization step（内部fork確認後、checkout・token作成済みのtrusted runner）。対象repoの**GitHub REST `GET /repos/{owner}/{repo}`**から、GitHub App installation tokenで`id`、`full_name`、`private`、`visibility`を取得し、HTTP結果・JSON型を検証する。入力の`owner/repo`は**対象の特定子**にすぎず、権限の根拠ではない。
- **照合者**：`authorizeDecisionEgress`（trusted policy engine）。GitHubから取得した`id`＋正規化`full_name`と、検証済みdispatch対象・実際のcheckoutリポジトリを整合照合する。`private=false && visibility=public`の両立時のみ`public`と認定。`private=true`または`visibility=private/internal`はrestricted。不一致・欠損・未知visibilityは`visibility_unknown`。
- **allowlistのOwner**：**Human Owner**が送信先（OpenRouter Decisions API）、対象repoのGitHub数値IDとfull_name、対象範囲、使用目的・許可versionを決裁する。trusted中央`ocr-app` checkout内の`.github/workflows/config/decision-egress-policy.json`を許可設定の唯一のソースとし、PR/head checkoutからの上書きを禁止する。Ownerの承認証跡IDは内部監査に記載し、許可されていないwildcardやパターン一致を使わない。
- **default-deny**：private/internalは**完全一致allowlistがある場合のみ**送信可。publicもG0-D02で許可されたtrusted public egress policyと全schema検証に合格した場合に限り送信可。属性取得が403/404/5xx/timeout、認証失敗、値矛盾、allowlist読み込み不良、Owner record不明なら**送信0回**。
- **Providerに渡す認可結果（ローカルのみ）**：`EgressAuthorization/v1` = `{schema_version:"1", allowed:boolean, reason:enum, visibility:enum, repo_id:number, full_name:string, head_sha:hex40, workflow_run_id:canonical_decimal_string, run_attempt:positive_safe_integer, destination:"openrouter-decisions", policy_version:string, approval_ref:string|null, checked_at:ISO8601}`。このオブジェクトはtrusted stepで生成・全項目検証し、PRヘッドと実行runに拘束する。**HTTP bodyにもログにも含めない**。Providerは`allowed===true`、宛先・`workflow_run_id`/`run_attempt`/`head_sha`・versionの厳密一致とDecisionState厳密検証が揃った場合のみPOST可能。変換と一致判定は§6.1.1に従う。
- **Providerへの最小受渡し**：`decision-provider.mjs`は`DecisionState/v1`、trusted`questions`、この**非送信grant**のみを受け取る。生のPR情報やGitHub eventを受け取らない。`allowed=false`なら`egress_denied`（理由enum）を返し通信しない。Decision失敗とは区別して内部監査。
- `shadow/enforce`に限り必要な属性取得を行い、`off`では**新規属性取得・allowlist判定・Decision通信は一切行わない**。API不達なら`enforce`はローカルのrisk floorを使う（`deep`実行不可ならレビュー失敗）、`shadow`は従来レビューを継続。

責任境界：GitHubはvisibility/idの権威、Human Ownerは送信許可の権威、trusted runnerは照合の実行者、Decision Providerは**認可後の推論担当であって認可者ではない**。公開範囲の認定と外部送信許可を同一概念にしない。

### 6.1.1 RG-R2-001 — RunBinding/v1の単一正規契約（§8.4 / §11.2 / §11.5 / Plan Tasks 4/5/8/9に優先）

**権威と型**：trusted GitHub Actions runner環境の`GITHUB_RUN_ID`、`GITHUB_RUN_ATTEMPT`、検証済み`COMMIT_SHA`、trusted設定`DECISION_ROUTING_MODE`のみから、一回のentrypoint初期化で`RunBinding/v1`を生成する。PR由来payload、`GITHUB_OUTPUT`、routeファイル、Artifact、Provider応答、外部から渡された`runId`で上書きしない。`off`では新routingのbindingやHost route照合を行わない。

| 正規項目（JSON/wire表記） | trusted入力→変換（Node ESM） | 型・厳密validation |
|---|---|---|
| `workflow_run_id` | `GITHUB_RUN_ID`を**数値化せず**そのまま受領。JS名`workflowRunId`、DeliveryのJS名`runId`は同じ文字列の別名 | 非空のASCII 10進文字列 `^[1-9][0-9]*$`、先頭0・空白・小数点・符号・指数表記不可、最大32桁。`Number()`/`parseInt()`/JSON numberへの変換禁止（精度落ち回避） |
| `run_attempt` | `GITHUB_RUN_ATTEMPT`が上記と同じ正規10進形式であることを先に検証し、`Number`へ一回変換。JS名`runAttempt` | `Number.isSafeInteger(n) && n >= 1`。ゼロ、負数、先頭0、非整数、unsafe integer、文字列のまま保存は拒否 |
| `head_sha` | trusted checkoutと照合済み`COMMIT_SHA`をASCII lowercaseへ正規化。JS名`headSha` | `^[0-9a-f]{40}$`。route/decision/auditのすべてでバイト一致 |
| `effective_mode` | trusted mode validation後の`DECISION_ROUTING_MODE`、JS名`mode` | `shadow`または`enforce`のみ。`off`は新routing/監査なし、未知modeは失敗 |

**共通binding**：ローカルの`RunBinding/v1`は `{workflowRunId:string,runAttempt:number,headSha:string,mode:'shadow'|'enforce'}`（これ以外のキー不可）とする。JS→保存JSONではそれぞれ`workflow_run_id`、`run_attempt`、`head_sha`、`effective_mode`へ**フィールドごとに転写**する。`createRunBindingFromEnv(env)`が生成、`assertRunBindingEquals(expected,actual)`がローカル4値の厳密一致を、`assertSerializedRunBindingMatches(expected,record)`が任意の保存JSON/grantの該当snake_case値（存在しないmode等は比較要求対象外）を厳密検証（`'123' !== 123`、`1 !== '1'`）。不正値・曖昧な形式・同じ実行を指すように見える非正規表現も`RUN_BINDING_INVALID`または`RUN_BINDING_MISMATCH`としてfail closedにする。`GITHUB_RUN_ID`がJS安全整数を超えても、有効な10進文字列として正確に保存する。

**契約間の追跡**：`EgressAuthorization/v1`（§6.1）と`RoutingDecisionRecord/v1`（§11.5）には`workflow_run_id:string`・`run_attempt:number`・`head_sha`を保存し、後者と`RoutingAudit/v2`（§11.2）は`effective_mode`も保存する。`RoutingPreparationResult`と専用`SelectedReviewRoute/v1`（§8.4）は4値すべてを保持する。`AuditDeliveryOutcome/v1`は既存契約の`runId:string`・`runAttempt:number`（同値のエイリアス）とArtifact outcome/idを用い、HEAD/modeは`final.json`/expected bindingと突き合わせる（Deliveryに未定義のフィールドを追加しない）。最終Gateでは**trusted expected binding**とgrant→decision→selected route→final audit→deliveryの該当4値/3値/2値をそれぞれ厳密比較し、欠落・矛盾・型差・別run_attempt・別HEAD・別modeなら公開禁止。`ReviewAttemptEvent/v1.run_attempt_id`はHost試行系列に共通の不透明IDであり、GitHubの`run_attempt`ではない。イベント系列を`RunBinding/v1`と関連付けるのはtrusted recorderの責任で、イベント値からGitHub実行IDを推定しない。

**POST前の境界**：`requestReviewDecision`はexpected bindingとgrantの3値をHTTP実行**前**に照合し、不一致なら`fetchImpl`を呼ばない。Egress grantが実在し`allowed===true`かつrepo ID/name/宛先/Owner認可も整合していることは従来どおり別の必要条件。`reviewable_files=0`、schema不正、認可不成立でもPOST 0。binding/secretの値を送信bodyや監査自由文字列へ転記しない。

### 6.2 実送信の唯一のRequest契約（設計例）

- エンドポイント：`POST https://openrouter.ai/api/alpha/decisions`、modelは`inception/mercury-decide:free`（無料範囲のみ）。chat completionsではない。
- `questions`は固定`review_strategy`型`choice`、候補は`fast`/`deep`。`state`のキー**全件**は§4.3の`DecisionState/v1`と一致。
- body外の`Authorization: Bearer …`はSecretからのみ指定。HTTPの宛先固定、レスポンスサイズ上限、5秒timeout、1 PR判断最大1回、リトライ無し。無料枠枯渇をきっかけに有料モデルを呼ばない。

```json
{
  "model": "inception/mercury-decide:free",
  "state": {
    "schema_version": "1",
    "all_changed_file_count_bucket": "6-20",
    "reviewable_file_count_bucket": "1-5",
    "excluded_file_count_bucket": "6-20",
    "additions_bucket": "101-500",
    "deletions_bucket": "1-100",
    "change_size": "medium",
    "language_families": ["typescript", "yaml"],
    "change_areas": ["auth", "ci"],
    "test_files_changed": true,
    "security_signal": "metadata_positive",
    "migration_signal": "metadata_not_observed",
    "review_scope_gap": true,
    "features_incomplete": false,
    "classification_status": "high_risk_metadata"
  },
  "questions": {
    "review_strategy": {
      "type": "choice",
      "instructions": "Choose code review depth from PR metadata only. Deep is preferred for high impact or uncertainty. This is advisory; application policy may override.",
      "criteria": {
        "fast": "Low-impact allowlisted documentation changes only",
        "deep": "Code, security-sensitive, unknown, complex or high-impact changes"
      }
    }
  }
}
```

この例のstateは§4.3の**同一version・同一キー集合・同一値**。実装時に`InternalPRFeatures/v3 -> DecisionState/v1 -> API body`の3段階をtestで完全照合する。

### 6.3 Response / Error契約

- HTTP 2xxのJSONから`answers.review_strategy`を読み、`type=choice`、`choice∈{fast,deep}`、`probabilities.fast/deep`の有限数0〜1、合計≒1を検証する。`confidence`は存在時だけ0〜1を検証（モデル出力に必須と仮定しない）。`alpha` API変更なら送信契約が変わる前にG1/G2で再審査。
- 未校正の暫定閾値：`P(chosen)<0.65`または1位と2位の差`<0.15`なら`deep`。閾値の有効性はG3で評価し、モデル出力をそのまま権限判断に使用しない。
- 認可NG / secret未設定 / 401 / 402 / 429 / 5xx / timeout / TLS / 破損JSON / unknown choice / incomplete featuresはすべて`decision_unavailable`の種別を明示し**ローカル安全選択**。`risk_floor`より浅い戦略に落とさない。
## 7. Trusted Model CatalogとAntigravity fallback（R3-FND-002 / R2-B維持 / R2-FND-002残余）

### 7.0 `TrustedReviewModelCatalog/v1` — 正規JSON Schema

- **trusted正本**：`.github/workflows/config/review-model-catalog.json`（中央trusted checkoutのみ）。以下のDraft 2020-12正規JSON Schemaに対応する将来の定義ファイルは`.github/workflows/config/review-model-catalog.schema.json`。**ファイルはまだ作成しない**。
- root: `schema_version`（literal `"1"`）、`catalog_version`（三整数dot区切り、変更時にversion更新）、`models`、`strategies.fast/deep.preferred_model_id`、`unknown_risk_strategy="deep"`を全て必須とし、root/model/strategyの未定義キーを拒否。
- **modelごとの必須6キー**：`model_id`、`capability_tier`、`certification_status`、`certification_reference`、`allowed_fallbacks`、`catalog_version`。`models[*].catalog_version`はrootの`catalog_version`と等しくなければならない。
- schemaによる構造検証**に加え**trusted semantic validatorが`model_id`の重複なし、preferred/fallback ID全件存在、自分自身へのfallback禁止、fallback重複なし、循環なし、モデル階級の非降格、モデルIDが実CLIのallowlistで利用可能、`certification_reference`がモデルID/階級/versionを含むtrusted検証記録に実際に束縛されることを検証する。schema上の`uniqueItems`は**model_id一意性の代わりにならない**。
- `certification_status=certified`に限り`certification_reference="sha256:<64 hex>"`を要求し、`pending/suspended/revoked`では`null`。Digest欄が埋まっただけでは実証済としない。証拠ファイルの真正性、参照一致、失効、Owner承認（G0-D05）を**別Gate**で確認する。
- **enforce eligibility**：`certified`かつG0-D05で承認済、証拠検証PASS、利用可能性を確認し、要求tier以上のモデルのみ。未認定/失効/停止は**primaryもfallbackも使用禁止**。候補が無い場合`review_model_unavailable`でfail、fastへの降格・無許可のlegacy fallback禁止。

以下が**正規JSON Schema全文**（本書中のJSONであって実装ファイルではない）：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ocr-app.example.invalid/schemas/review-model-catalog-v1.schema.json",
  "title": "TrustedReviewModelCatalog/v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "catalog_version",
    "models",
    "strategies",
    "unknown_risk_strategy"
  ],
  "properties": {
    "schema_version": {
      "const": "1"
    },
    "catalog_version": {
      "type": "string",
      "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$"
    },
    "models": {
      "type": "array",
      "minItems": 1,
      "maxItems": 64,
      "items": {
        "$ref": "#/$defs/model"
      }
    },
    "strategies": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "fast",
        "deep"
      ],
      "properties": {
        "fast": {
          "$ref": "#/$defs/strategy"
        },
        "deep": {
          "$ref": "#/$defs/strategy"
        }
      }
    },
    "unknown_risk_strategy": {
      "const": "deep"
    }
  },
  "$defs": {
    "model_id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/+-]*$"
    },
    "strategy": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "preferred_model_id"
      ],
      "properties": {
        "preferred_model_id": {
          "$ref": "#/$defs/model_id"
        }
      }
    },
    "model": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "model_id",
        "capability_tier",
        "certification_status",
        "certification_reference",
        "allowed_fallbacks",
        "catalog_version"
      ],
      "properties": {
        "model_id": {
          "$ref": "#/$defs/model_id"
        },
        "capability_tier": {
          "enum": [
            "fast",
            "deep"
          ]
        },
        "certification_status": {
          "enum": [
            "pending",
            "certified",
            "suspended",
            "revoked"
          ]
        },
        "certification_reference": {
          "oneOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^sha256:[0-9a-f]{64}$"
            }
          ]
        },
        "allowed_fallbacks": {
          "type": "array",
          "maxItems": 16,
          "uniqueItems": true,
          "items": {
            "$ref": "#/$defs/model_id"
          }
        },
        "catalog_version": {
          "type": "string",
          "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$"
        }
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "certification_status": {
                "const": "certified"
              }
            },
            "required": [
              "certification_status"
            ]
          },
          "then": {
            "properties": {
              "certification_reference": {
                "type": "string",
                "pattern": "^sha256:[0-9a-f]{64}$"
              }
            }
          },
          "else": {
            "properties": {
              "certification_reference": {
                "type": "null"
              }
            }
          }
        }
      ]
    }
  }
}
```

#### 未認定のcatalog構造例（認定済モデルを示さない）

```json
{
  "schema_version": "1",
  "catalog_version": "1.0.0",
  "models": [
    {
      "model_id": "gemini-3.8-flash-medium",
      "capability_tier": "fast",
      "certification_status": "pending",
      "certification_reference": null,
      "allowed_fallbacks": [
        "claude-opus-4-6-thinking"
      ],
      "catalog_version": "1.0.0"
    },
    {
      "model_id": "claude-opus-4-6-thinking",
      "capability_tier": "deep",
      "certification_status": "pending",
      "certification_reference": null,
      "allowed_fallbacks": [],
      "catalog_version": "1.0.0"
    }
  ],
  "strategies": {
    "fast": {
      "preferred_model_id": "gemini-3.8-flash-medium"
    },
    "deep": {
      "preferred_model_id": "claude-opus-4-6-thinking"
    }
  },
  "unknown_risk_strategy": "deep"
}
```

この例では**全モデルが`pending`**であり、`enforce`で実行可能なモデルは**0**。モデルIDは既存workflowの候補文字列であり、能力実測・利用契約・Owner認定は未証明。モデル認定GateとG0-D05のOwner決裁は独立した必要条件で、両者が揃うまで`enforce`の利用許可を出さない。

### 7.1 `fallbackModels` 4状態の正規validation policy

`runHost()`の新しい引数`fallbackModels`は**own property の有無**でlegacyを区別する。`undefined`を明示的に指定した状態を「キー不在」と同一視しない。Hostに渡る値とモードを次の表で固定する。

| 入力状態 | `off`/`shadow`（legacy） | `enforce` |
|---|---|---|
| `fallbackModels` **キー不在** | 従来どおり`fallbackModel || env.ANTIGRAVITY_FALLBACK_MODEL`、旧retry仕様 | **Host単体ではlegacy意味**。ただしenforceのtrusted resolverは必ず明示配列を供給する契約なので、**routing段階でvalidation failure**。黙示的なlegacyで起動しない |
| `fallbackModels: []` | off/shadowはこの新キーを渡さず旧仕様を使用 | fallbackを**完全禁止**（env/旧引数で補充不可） |
| `fallbackModels: [certified IDs...]` | off/shadowはこの新キーを渡さず旧仕様を使用 | 順序どおり**許可済かつ同等以上tier**の候補のみ。Hostはカタログ外IDを拒否 |
| own propertyで`null`/`undefined`/string/object/非配列、空要素、重複、未認定ID、無効ID | off/shadowは新キーを供給しないため既存経路への影響なし | `invalid_fallback_models`、**spawn 0回**で明示失敗 |

**enforceでは`fallbackModels`を必須の非null配列**とし、R3の`fallbackModel`後方互換はoff/shadowのみに適用する。`fallbackModels`配列が存在する場合は`fallbackModel` / `ANTIGRAVITY_FALLBACK_MODEL`による補完を一切認めない。`deep`→`fast`は禁止。Hostでの試行順・エラー分類は既存実装を保持し、許可集合による制約のみ加える。`off/shadow`は`runHost({cwd,prompt,onProgress})`相当を維持し、model選択、fallback、retry、sandbox、レビュー結果への影響を0にする。

### 7.2 試行監査の**唯一の公開インターフェース**

**確定signature**：`onAttemptEvent(event: ReviewAttemptEvent/v1): void`。`runHost({ ..., onAttemptEvent })`の引数で渡す**trusted observer callback**とし、旧R3の「または同等のstream」という代替仕様を撤回する。既存`/tmp/ocr-result.json`／レビュー結果JSON `schema_version:"1.0"`, `mode:"review"`, `status/coverage/findings/message`は**一切変更しない**。callbackが受けるのは下記strict objectだけであり、PR本文、prompt、stdout/stderr、Secret、自由入力error全文、providerレスポンスは受け取らない。

| Field | 型・必須性 | Eventごとの条件 |
|---|---|---|
| `schema_version` | literal `"1"` / 必須 | 常に固定 |
| `run_attempt_id` | trusted生成の不透明な固定長ID / 必須 | 全イベントで同一（PR文字列由来でない） |
| `attempt_index` | 正整数または`null` / 必須 | `attempt_*`は1始まり単調増加。`host_completed`のみnull |
| `event` | `attempt_started` / `attempt_completed` / `host_completed` | 全イベントで必須 |
| `model` | trusted catalogの許可ID文字列または`null` / 必須 | attemptイベントは実際のCLI `--model`引数値、host_completedはnull |
| `result` | 固定enumまたは`null` / 必須 | completedのみ`spawn_failed`, `timeout`, `transport_error`, `invalid_output`, `model_reported_failure`, `host_validated_success`, `host_skipped`, `other_failure`。その他はnull |
| `timestamp` | UTC ISO8601 / 必須 | trusted時計のみ |
| `duration_ms` | 非負整数またはnull / 必須 | startedはnull、completed/host_completedは計測値かnull |
| `host_status` | `success` / `skipped` / `failed` / `null` / 必須 | host_completedのみ非null |

実行直前に`attempt_started`を発行し、子プロセス終結とHost JSON validationの直後に`attempt_completed`を発行し、Host最終終了時に`host_completed`を**一度だけ**発行。各startedにcompletedを対応させる。spawn自体が失敗した場合は`spawn_failed`。異常終了でcompleteを発行できなければ`audit_incomplete`とし成功モデルを確定しない。attempt `model`はCLI引数の事実のみを示し、provider内部での実モデルを証明しない。

**observer故障時**：`off`はobserver自体を新規登録しない。`shadow`はobserverの例外・欠落を別auditのunavailableとして吸収し、旧Hostのmodel/retry/fallbackとレビュー動作を変えない。`enforce`はコールバック記録不能・スキーマ不正・イベント順序不整合を`audit_incomplete`として公開禁止にする。observerを使ってHostモデル選択を変更してはならない。ログエミッタの任意テキスト記録は禁止。

### 7.3 実行・成功モデルの別名義（R3維持）

1. `selected_review_model`はPolicy Engineが決定した**選定値**、`attempted_review_models[]`は**イベントで観測したCLI試行値**。`host_success_model`は対応する`attempt_completed.result=host_validated_success`でのみ暫定記録する。
2. `executed_review_model`は**Host完了＋Event系列整合＋既存OCR結果検証PASS＋PR HEAD一致**後にのみ最終auditへ格納する。`status=skipped/failed`、例外、モデル許可違反、validation失敗、HEAD不一致、監査不完全時は常に`null`。primary失敗→fallback成功ならfallbackのみを記録する。
3. 監査ファイルをfreezeした後に`executed_review_model`を上書きしない。**final audit確定→Artifact→公開判断**の順序は§8.1が唯一の規範。成功モデルが記録されてもArtifact upload失敗なら公開してはいけない。
4. `off/shadow`のlegacy primary/fallbackを変更しない。`off`ではrouting監査・Decision通信を増やさず、`shadow`では提案モデルを実行しないため提案値を実成功値と取り違えない。`executed_review_model`はprovider実モデルIDの証明ではなくCLI引数の証跡を意味する。

### 7.4 RG-R1-005 — Host進捗・失敗通知の独立情報境界

- **Routing Artifact境界**：`decision.json`/`attempts.ndjson`/`final.json`には、厳密な型・固定enum・許可された数量だけを保存する。stderr、prompt、raw result/message、例外文字列、PR本文、Secretを保存しない。
- **Actions progress境界**：既存`agy stderr → sanitizeProgress → onProgress → process.stderr.write`経路は既知パターンを浄化するだけで、任意のPR文・diff抜粋・機密表現が必ず除去されるとの保証はない。**enforceではHost呼出しに旧`process.stderr.write` sinkを渡さず、progress callbackを未指定（または完全no-op）に固定する。** Host/runnerの`console.*`、例外catch、CLI exit診断が同じ内容を迂回出力しないかも後続G1で負例検証する。代替診断はtrusted runnerが生成した固定enumと件数のみ。
- **Check Run境界**：enforceの`update-check-run.mjs`は`routingFailureReason`（固定enum）と`enforce=true`を明示して呼び、`failureDetails(result.message)`を**いかなるenforce結果でも参照・添付しない**。失敗・timeout・spawn error・invalid outputはサニタイズ済みenumとActions run URLのみで知らせる。`result.message`を任意文字列のままfailure通知へ転写しない。`/tmp/ocr-result.json`の既存`schema_version:1.0`、`status/coverage/findings/message`を変更せず、enforceで失敗結果を書き出す際の`message`はtrusted固定文だけに限定する。
- **モード分離**：`off/shadow`の既存Host progress、retry/fallback、Check Run表示は変更しない。ただし従来経路のログを「任意機密が完全に除去済み」と保証するものではない。**enforceの保護をshadowへ適用して観測挙動を変えない**。
- **fail closed**：固定enum化ができない例外は`REVIEW_EXECUTION_FAILED`等の一般理由へ写像し、raw `Error.message`・stderr・provider response本文を出力しない。`enforce`の監査不能・Check更新不能は公開成功としない。

## 8. ワークフロー統合点と実行経路（設計のみ）

- **挿入位置**：`Prepare trusted review context`後に全変更特徴量抽出、trusted egress判定、Decision Adapter、policy resolver、routing decision auditを置く。旧OCR Preview/Context Builder/既存review JSON/schema・Antigravity sandboxは不変。
- **off（default）**：新規routing step・GitHub visibility取得・Decision通信・routing Artifactを実行しない。既存Host呼出し、retry/fallback、filter、validate、HEAD check、thread resolver、投稿・Check Run挙動は変更しない。
- **shadow**：新規判定は観測専用。Hostに新モデル・fallback配列を適用せず既存retry/fallback/投稿順序を維持する。監査失敗は旧PR投稿とCheck Run成功判定をブロックしない。品質測定はしない。
- **enforce**：新たな監査・公開ゲートを満たした場合のみレビュー投稿。OwnerがG0-D04/D05/D07を決裁してGatesを通過するまでは**起動不可**。Decision unavailableはrisk floorをローカル適用、Deep候補なしは明示失敗。
- **未知モード**：trusted設定エラー。黙示`off`にしない。
- **新しいtrustedステップの出力**：`GITHUB_OUTPUT`は許可済enum/モデルIDだけ、監査JSONは`RUNNER_TEMP/ocr-routing`の厳密な固定パスのみ。`/tmp/ocr-result.json`は現状のまま。

### 8.1 R3-FND-001 — enforceの確定順序・公開可否Gate

**この1→7の因果順序をenforce専用の規範**とする。現在のworkflowにある`if: always()`は失敗時の調査用ファイル収集を許すだけで、投稿権限を与える条件とはみなさない。手順を新規YAMLへ実装したという主張はしない。

| 順 | 信頼された責任主体 | 実施内容と証拠 | 失敗時の扱い |
|---|---|---|---|
| **1** | Antigravity Host + `onAttemptEvent` observer | Host実行時は`host_completed`までの厳密なattempt系列をfreeze。**enforceのOCR reviewable=0**ではtrusted skip結果を作り、Hostをspawnせず0行の`attempts.ndjson`を正規としてfreeze | Host実行経路の不完全は`audit_incomplete`、success model不確定。skipで実行証拠を捏造しない |
| **2** | 既存filter + `validate-ocr-result.mjs`（trusted workflow） | OCR既存review JSON、対象範囲、coverage、適法なfindingを検証し`review_validation_status`確定 | `failed`、公開禁止。結果schema不変更 |
| **3** | 既存`check-pr-head.mjs`（trusted workflow） | 投稿直前HEAD SHA照合を実施し`head_validation_status`確定 | mismatch/unknownで公開禁止 |
| **4** | Routing audit finalizer + strict validator | §11の`final.json`を成功モデル条件で**一度だけseal**、`decision.json`・`attempts.ndjson`と相互整合検証 | `audit_finalization_failed`、公開禁止。再修正/後付け成功は禁止 |
| **5** | 独立`Upload routing audit` step | 固定3ファイルを`upload-artifact@v4`、Owner承認済`retention-days`で保存し**step `outcome=success`**を確認 | `audit_artifact_upload_failed`、公開禁止。job/Check failure |
| **6** | 独立`Evaluate publish eligibility`（trusted gate） | 1〜5のrun/HEAD/model tier/artifact outcome/Owner D04決裁を突き合わせ、`publish_authorized`を一回決定 | `false`（default）、投稿不可 |
| **7** | 既存`post-ocr-comments.mjs` + Check Run completion | **公開許可のときだけ**PRレビュー投稿。`enforce`では`Resolve fixed review threads`を実行せず返信・resolveを延期する。Check Runの最終結論はGate結果と投稿結果に従う | 投稿失敗は`failure`。Check Run更新は失敗の透明な通知用に実行 |

**workflowの既存実行順との境界（RG-R1-003・優先契約）**：現行`Resolve fixed review threads`はPRへreply/resolveし得る。**enforceではこの既存stepを実行しない（延期、mutation=0件）**。HEAD拘束済みの新規スレッド更新方式を別途認可するまでは復活させない。これによりenforceで最初に許されるレビュー由来のPR mutationは、ステップ6の許可とその後のHEAD再確認を経た`post-ocr-comments.mjs`によるレビュー投稿だけとなる。`off/shadow`のresolver・既存step順序は変更しない。既存の`Mark Check Run in progress`は非レビューの進捗状態更新なので開始時のまま許可されるが、**success/conclusionまたはレビュー成果の公開を行うのはステップ7以後**。

**Check Run IDの前提**：`enforce`はCheck Runの最終結果通知を必須とし、`check_run_id`が無いrunはstep6のGateを`false`にする。新規Check Runの作成方式・権限・対応可能性は後続PlanとG1で検証する（本R4では作成しない）。`off/shadow`の既存`check_run_id`任意挙動は維持する。

**HeadのTOCTOU対策**：step3のHEAD再検証の後、step7の**最初のPR mutation直前**に軽量なHEAD一致確認を**再度実施**し、変化があればGateを破棄して公開しない。enforceではthread mutationは存在しない。再チェックはstep3のHEAD validationの代替にはしない。GitHub側の同時更新を原子的に禁止するとは主張しない。投稿APIがcommit SHA拘束を受け付ける場合は照合済SHAを指定する。Check Run failure報告はこのpublish gateによる禁止に含めない。

**Artifact upload結果は監査JSONの外側で確定**：`final.json`の`audit_status="sealed"`は**ローカル封印/スキーマ検証PASS**のみを表し、upload成功を先取りしない。step5の`outcome`とartifact ID/URL（GitHub提供時）はtrusted workflow outcomeとして評価し、`final.json`へ後から追記・再sealしない。`upload-artifact`は`continue-on-error`等でstep6・failure Check Run更新へ進められるよう制御しても、**生の`outcome`がfailureならGateはfalse**とし、job最終状態をfailureにする。`conclusion=success`をpublishの代わりに流用しない。

### 8.2 監査障害とReview/Check Run結論の完全な規範

| enforceの実際の状態 | PRレビューコメント・thread mutation | Check Run最終結論と表示 | GitHub Actions job |
|---|---|---|---|
| Host成功、OCR検証PASS、HEAD一致、audit sealed、Artifact upload成功、publish gate=true、投稿成功 | **許可**（既存重複排除維持） | `success`（実際のreviewがsuccessの場合のみ） | `success` |
| 正常なOCR `skipped`で**D04 blocking対象のscope gapが存在せず**、1〜6成功 | 既存skip方針のみ。実レビュー完了と表示しない。enforceのthread mutationは0 | `neutral`＋`review_skipped`表示 | Gate policyで明示された状態のみ。`executed_review_model=null`。**D04の非対象高リスクgapがあればGate=false/失敗** |
| Host/attempt不完全、OCR検証fail、HEAD不一致、final schema不正 | **禁止** | `failure`＋固定理由enum（可能ならActionsリンク） | `failure` |
| **Artifact upload fail / missing** | **禁止**。`always()`による既存post stepの素通し不可 | **`failure`＋`ROUTING_AUDIT_MISSING`**（投稿なし、監査欠損、Actions run URLを明示。Secret等は非表示） | **`failure`** |
| upload成功だがgate条件不成立／Owner未決裁／能力下限違反 | **禁止** | `failure`＋固定理由enum | `failure` |
| Gate=trueでもPR投稿API失敗・HEAD最終再確認失敗 | **禁止／未完了として扱う**（投稿済み件数は監査へ別途記録可能な範囲のみ） | `failure`＋`PUBLISH_FAILED`または`HEAD_CHANGED` | `failure` |
| Check Run API更新失敗 | 既に許可された投稿の成否を捏造しない。固定enumで失敗を報告 | Check Run更新は未達。Actions logに`CHECK_UPDATE_FAILED` | `failure` |
| **enforceで`check_run_id`が無い** | **公開前Gateで拒否し投稿しない**（公開後の最終結論が通知できないため） | Check Runは更新不能。Actions logに`CHECK_RUN_MISSING` | `failure`（off/shadowの既存運用は変更しない） |

**公開許可は「レビュー成功の保証」ではない**：step6で投稿許可を付与しても、step7のGitHub投稿結果を確認して最終successを確定する。既存Check Runが無い場合も監査欠損・失敗の情報をActionsログとjob failureに残す。失敗経路では`if: always()`で**証拠の保存とfailure通知のみ**を継続し、`Post review comments`/thread mutationを許可しない。並行実行・run retryでも`run_id + run_attempt + head_sha`の拘束が一致しなければ他runのartifact成功を流用しない。

### 8.3 G0-D04とOCR非対象高リスク変更

`review_scope_gap=true`でOCR対象外の高リスク変更を検知しても、選択モデルを深くするだけで欠落箇所をレビュー済みにできない。`off/shadow`は従来のレビュー・skip・Check Runを維持。**R4初版当時は**G0-D04の警告/阻止の選択が未決裁だったが、**§15.2の現在の基本方針ではOwnerはenforce時のblockingを承認済み**。step6は非対象高リスク・分類不能変更（`review_scope_gap=true`かつD04対象）を公開禁止とし、`failure`と固定理由`REVIEW_SCOPE_GAP_BLOCKED`で通知する。その他の正常skipだけ`neutral`可。G1検証・enforce実運用許可は未了であり、shadow/offへblockingを波及させない。

### 8.4 RG-R1-002 — trusted実行エントリポイントとステップ境界

**正規方式を単一のtrusted Node ESM orchestrationに固定**する：`self-repo/.github/workflows/scripts/prepare-review-routing.mjs`が公開する`prepareReviewRouting({env,preview,runGit,fetchImpl,writeJson,writeOutput}): Promise<RoutingPreparationResult>`を、`Prepare trusted review context`の直後に一つのActions step **`Prepare dynamic routing`** から実行する。PR checkoutからJavaScriptをimportせず、`self-repo`のtrustedスクリプトと設定だけを読む。Task 2〜6のpure/library APIをこのentrypointで順番に呼び出し、同じ判断を複数inline stepに再実装しない。

| 因果順 | 実行者・Producer | Consumer・検証・境界 | 主な入力／出力 |
|---|---|---|---|
| 0 | Workflowのtrusted mode検証 | `off`なら新規機能を全部skip。`shadow/enforce`だけentrypoint起動。未知値はHost実行前に失敗 | `DECISION_ROUTING_MODE` → `effective_mode` |
| 1 | Task 2 `extractPRFeatures` | Task 3 `classifyPRRisk`（trusted local、全Git変更） | 検証済みbase/head、OCR Preview → `InternalPRFeatures/v3` |
| 2 | Task 3 `classifyPRRisk` | `buildDecisionState`（内部v3をstrict projection） | 分類済みv3 → `DecisionState/v1`。不完全時はAPIなし |
| 3 | Task 4 `authorizeDecisionEgress` | Task 5 `requestReviewDecision`の**必須grant** | GitHub REST ID/visibility・trusted policy・HEAD/run拘束 → `EgressAuthorization/v1`。失敗/未許可はPOST 0 |
| 4 | Task 5 `requestReviewDecision` | Task 6 `selectReviewRoute`（advisoryのみ） | fixed model/state/questions、approved grant → normalized enum Decision。`reviewable_files=0`なら呼び出し0、`not_requested` |
| 5 | Task 6 `selectReviewRoute` → Task 9 `prepareReviewRouting` | Task 8 `writeRoutingDecision`、workflow Host step | Task 6のpure resolved route + trusted `RunBinding/v1`・policy/catalog versions → Task 9の`RoutingPreparationResult`、fixed `decision.json` |
| 6 | Workflow Host step + Task 7 callback | Task 8 `createAttemptRecorder` | enforceは認定済み`model`/明示`fallbackModels`＋observer。shadowはlegacyモデル/fallback＋観測専用observer。offはlegacyでobserverなし |
| 7 | Task 8 finalizer／Artifact step／Gate | enforceは§8.1のseal→upload→gate→post、shadowは§11.5のbest-effort診断保存 | 固定3ファイル、別の`AuditDeliveryOutcome/v1` |

**入力・出力契約（Task 9への拘束）**：trusted環境変数は`BASE_REF`, `COMMIT_SHA`, `TARGET_REPO`, `PR_NUMBER`, `OCR_PREVIEW_PATH`, `RUNNER_TEMP`, `GITHUB_OUTPUT`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_TOKEN`（GitHub App installation token）、`DECISION_ROUTING_MODE`。**唯一のActions Secret名は`DECISION_OPENROUTER_API_KEY`**、当該routing stepにのみNode環境変数`OPENROUTER_API_KEY: ${{ secrets.DECISION_OPENROUTER_API_KEY }}`としてマップする。他stepへ転送・出力しない。認可前にこの鍵を使ったPOSTを起動する呼出し経路は存在させない。`DecisionState/v1`/内部grantはNode内の引数のみで受け渡し、`GITHUB_OUTPUT`やartifactに格納しない。

`RoutingPreparationResult`はtrustedローカルの `{status:'prepared'|'no_reviewable_files'|'degraded'|'blocked',mode:'shadow'|'enforce',proposedStrategy:'fast'|'deep'|null,selectedStrategy:'fast'|'deep'|null,selectedModelId:string|null,fallbackModels:string[],routeSource:enum,decisionStatus:enum,reviewableCount:number,headSha:hex40,runBinding:RunBinding/v1,policyVersion:trusted_version_string,modelCatalogVersion:trusted_version_string}`。`headSha === runBinding.headSha`、`mode === runBinding.mode`は必須。`GITHUB_OUTPUT`にはenum・検証済みmodel ID・`fallbackModels`の小さいJSON配列だけを出すが、**Hostの権威データとしては使用しない**。Host入力は`RUNNER_TEMP/ocr-selected-route.json`（routing監査3ファイルの**外側**、0600、公開しない）に保存した`SelectedReviewRoute/v1`のみから取得する。`decision.json`の生成・初回freezeはTask 8の`writeRoutingDecision`が行う。**routingディレクトリ内のArtifact対象は従来どおり3ファイルだけ**。

**`SelectedReviewRoute/v1` の唯一の保存形式**：Task 9の`serializeSelectedReviewRoute(result:RoutingPreparationResult):SelectedReviewRoute/v1`が以下の**全15キー**をフィールドごとに新規構築する。`schema_version:'1'`、`workflow_run_id:canonical_decimal_string`、`run_attempt:positive_safe_integer`、`head_sha:lowercase_hex40`、`effective_mode:'shadow'|'enforce'`、`status:'prepared'|'no_reviewable_files'|'degraded'|'blocked'`、`reviewable_file_count:nonnegative_safe_integer`、`proposed_strategy:'fast'|'deep'|null`、`selected_strategy:'fast'|'deep'|null`、`selected_model_id:validated_catalog_id|null`、`fallback_models:validated_catalog_id[]`、`route_source:'model_decision'|'deterministic_fallback'|'not_requested'`、`decision_status:'succeeded'|'unavailable'|'not_requested'|'invalid_response'`、`policy_version:trusted_version_string`、`model_catalog_version:trusted_version_string`。未定義・extra property・`undefined`・プロトタイプ由来キーを拒否する。`selected_review_model`等のaudit専用値は混ぜない。shadowでは実行モデル/fallbackをこのrouteからHostへ反映してはならず、`selected_model_id=null`、`fallback_models=[]`、`selected_strategy=null`とする。書込者はTask 9 `writeSelectedReviewRoute({runTemp,result})`、検証者はTask 9 `readSelectedReviewRoute({runTemp,env,expectedMode})`。前者は厳格schemaを通した後に固定パスへ一度だけ`0600`で原子的に書込みfreeze、後者はロード直後にschemaと§6.1.1の4値をrunner環境から再生成したexpected bindingに照合する。自己申告されたroute内のbindingをexpectedに使わない。`policy_version`と`model_catalog_version`は戻り値のtrusted `policyVersion`/`modelCatalogVersion`からのみ転写し、serializerが任意の未指定値を補完しない。`RoutingPreparationResult`はローカルの戻り値、`SelectedReviewRoute/v1`はその**厳密な永続化投影**であり、API送信用`DecisionState/v1`とも監査`RoutingDecisionRecord/v1`とも別スキーマ。

**Host実行直前の強制比較（Task 9）**：enforce/shadowで有効なrouteファイルが存在し、そこからrouting関連のHost経路へ入る場合、Host stepはtrusted env `GITHUB_RUN_ID/GITHUB_RUN_ATTEMPT/COMMIT_SHA/DECISION_ROUTING_MODE`を**独立に読み直し**、期待bindingとroute、さらに`decision.json`のrun/head/modeとを検証する。**既存routeの型不一致、HEAD/run/attempt/mode差替え・欠落があればHostの`runHost`呼出し前に`RUN_BINDING_MISMATCH`（形式不正は`RUN_BINDING_INVALID`）で停止し、Host spawnは0回、モデル切替も投稿も実施しない。** Shadowでも存在するrouteのbinding不一致は単なるobserver故障でなくtrusted境界違反なので同様にspawn 0。**shadowでroute/監査生成そのものがbest-effortとして失敗してrouteファイルが存在しない場合は、新routeを消費せずobserver無しでlegacy Hostを実行する**（§11.5の可用性優先を維持）。`off`はrouteファイルを読み込まずlegacy実行のまま。`enforce`ではroute欠損もspawn 0。OCR reviewable 0件ならbinding検証後にenforce Hostをspawnせずtrusted skipを生成。

`reviewable_files=0`でも抽出・risk分類・`decision.json`（`decision_status=not_requested`）は行い、**Decision API POST 0**。**shadow**は従来のHostによる`skipped`契約を維持する（route生成失敗時は§8.4のlegacy-without-observer例外）。**enforce**では認定モデルの選択・Host spawnを行わず、trusted workflowが既存形式`schema_version="1.0",mode="review",status="skipped",coverage=0,findings=[],message=<trusted fixed skipped reason>`の結果を生成する（既存schema不変更）。`attempts.ndjson`は0行が正規で、最終成功モデルはnull、Host未実行の`host_completed`イベントは要求しない。最終監査・Artifact／Gateは省略せず、D04対象の非レビュー高リスクscope gapがあれば`REVIEW_SCOPE_GAP_BLOCKED`で公開を禁止する。scope gap非該当の正常skipのみneutral可。`shadow`のrouting/observer失敗は旧Host/投稿/Checkを停止しない。`enforce`でroutingが`blocked`または未認定モデルならHost spawn前に失敗し、公開許可を出さない。

## 9. 障害・unknown時の規定結果

| Condition | 外部送信 | レビューモデル・実行 | 監査 |
|---|---|---|---|
| `off` | 0 | 既存primary/fallbackをそのまま実行 | 新規routing監査不要 |
| `shadow` + Provider不達 | 0または認可済み一試行 | 既存reviewを継続 | `decision_unavailable`、モデル品質は未測定 |
| `enforce` + 429/timeout/401/402/5xx/Secret欠如 | 不可時は0、API失敗時は高々1試行 | ローカル最低`deep`/`fast`規則で選択 | エラーenum＋`route_source=deterministic_fallback` |
| GitHub repo visibility API失敗/不一致 | 0 | `shadow`:旧モデル、`enforce`:ローカル選択 | `egress_denied`。例外なくdeny |
| restricted repo + trusted allowlist欠如 | 0 | 同上 | `egress_denied` |
| `InternalPRFeatures`不完全 | 0 | `deep`下限 | `classification_status=incomplete` |
| unclassified source code | 認可済みかつ完全stateなら任意（ただし送らなくてもよい） | `deep`下限 | `unclassified_code`、non-observation≠safe |
| `deep`候補全て不可 | Decision結果によらない | fail。`fast`降格禁止 | `review_model_unavailable`、successモデルnull |
| Host fallback成功 | 変更なし | 許可済みfallbackのみ（enforce） | 各試行を記録、成功fallbackだけ確定 |
| Host失敗 / downstream validate失敗 / HEAD不一致 | 変更なし | enforceは投稿を禁止しjob/Check failure | `executed_review_model=null` |
| OCR対象0 | 0 | 現行skip維持、gap警告の設計 | `no_reviewable_files`。ブロックはG0-D04待ち |
| Audit artifact保存失敗 | 変更なし | `enforce`では投稿禁止・Check Run `failure`。`shadow`ではレビュー継続 | `ROUTING_AUDIT_MISSING`とActions URLをCheck Runへ表示し、job `failure`。監査成功の推測はしない |

通信回数は**同一対象HEADの単一決定実行で高々1回**、自動retryなし、コスト上限なし有料フォールバックは禁止。再度PRが更新され別runが発生した場合は別判断。内部エラーはPR内容・tokenを埋め込まずenumで記録する。
## 10. Security / Ownership / Trust boundary

1. **trusted owner**：policy・模型catalog・Decision questions・決裁参照・許可された外部キー集合は中央workflow checkoutにのみ存在。PR headからの設定ロードは禁止。
2. **visibility authority**：GitHub APIの取得結果のみ。PR由来文字列は宛先特定以外の認可根拠にしない。GitHub認証失敗、private/internal/unknownでallowlist不可なら送信0。
3. **egress grant**：Owner決裁済みallowlistとrepo ID/full_name/HEADをrunnerが照合し、Providerにtrusted `EgressAuthorization/v1`を渡す。grantの内部フィールドをAPIへ転送しない。
4. **payload**：§4.3の`DecisionState/v1`の**必須全キーかつ追加キーなし**、モデルIDと質問定義は定数。文字列注入やpath名・raw diff混入はmockで拒否。
5. **secrets**：`DECISION_OPENROUTER_API_KEY`はGitHub Actions Secret、必要なstepにのみ限定。標準出力、CLI argv、Artifact、外部DecisionStateに含めない。
6. **endpoint**：HTTPS固定、宛先allowlist、レスポンスボディ上限、timeout、rate-limitと課金防止。任意URL転送不可。
7. **runtime boundary**：既存Antigravity sandbox `deny command/read/write/url/mcp`、レビューJSON検証、HEAD revalidate、重複抑止を維持。`resolve-threads`は今回非対象。
8. **scope honesty**：OCRレビュー外の高リスク変更は強力なモデルを使ってもレビュー済みにできない。G0-D04の保留を尊重。
9. **audit privacy**：内部auditにrepoとPR識別子が存在し得る。Artifactのアクセス・保持期間をOwner G0-D07が決裁しない限りshadow/enforceは開始不可。URLやPR内容を外部送信しない。
## 11. Routing監査契約・Artifact（R3-FND-001/002、R2-FND-002/005）

### 11.1 保存場所とuploadの発生順

| ファイル | trusted runner上の固定パス | 内容と完了時点 |
|---|---|---|
| Routing decision | `${RUNNER_TEMP}/ocr-routing/decision.json` | ローカルclassification/egress/selected strategy。選定前段でfreeze |
| Host attempt events | `${RUNNER_TEMP}/ocr-routing/attempts.ndjson` | §7.2 `ReviewAttemptEvent/v1`の正規イベントのみ。Host終了でfreeze |
| Final routing audit | `${RUNNER_TEMP}/ocr-routing/final.json` | §11.2 `RoutingAudit/v2`。既存OCR結果validation + HEAD checkの後で**最終seal** |

- 中央trusted runner上でdir `0700`・file `0600`、固定の3ファイルのみをschema検証。未認可path、`target-repo/`、diff、Secret、任意エラー文字列のupload禁止。ファイル欠損は成功判定不能。`decision.json`/`attempts.ndjson`に失敗原因の列挙を保持する設計であり、機密のstdout/stderrは保存しない。
- `github.run_id`/`github.run_attempt`でArtifactを一意化：`ocr-routing-audit-${run_id}-${run_attempt}`。既存`ocr-debug-logs`と**別の**`upload-artifact@v4` stepを用い、`retention-days`は§15.2で承認された基本保持期間**30日**を唯一の値とする。ただし削除・Incident保全・閲覧実態等の運用詳細およびshadow/enforce個別有効化が未承認の間は起動禁止。
- **enforce**では§8.1の順に**最終audit seal→upload完了確認→publish gate→PR投稿**。`always()`を使うのは失敗時の収集/通知だけ。Artifact無いときにPRコメント投稿は不可。
- **shadow**では現在の固定モデル/投稿順を変更せず、追加routing監査はbest-effort。upload失敗時も旧レビュー結果とCheck Runを改変せず、診断enumだけをActions logへ記録。**off**では新監査ファイル生成・upload自体を行わない。

### 11.2 `RoutingAudit/v2` 最終ファイル正規契約

`schema_version`はliteral `"2"`。下表の全項目を**必須**とし、追加プロパティ・未許可型/任意のPR文字列を拒否する。optionalの意味は`null`で表し、任意のキー省略を許さない。

| Field | 型 / 定義 / enforcement |
|---|---|
| `schema_version` | `"2"` |
| `repo_id`, `repo`, `pr_number`, `head_sha`, `workflow_run_id`, `run_attempt` | trusted GitHub確認済repo ID・GitHub repository fullname（内部だけ）・`pr_number`正整数・`head_sha` lowercase hex40・`workflow_run_id`正規10進文字列・`run_attempt`正の安全整数（§6.1.1）。`effective_mode`を含め、正確な型・値・run拘束を必須とする。**Decision API送信不可** |
| `effective_mode` | `shadow` / `enforce`。offにはこのaudit無し |
| `decision_status` | `succeeded` / `unavailable` / `not_requested` / `invalid_response` |
| `egress_status` | `allowed` / `denied` / `not_checked` |
| `classification_status` | §4.2の列挙のみ |
| `risk_floor` | `fast` / `deep` |
| `selected_strategy` | `fast` / `deep`（enforce時は必須）、`null`（shadowは提案を実行しないため必須） |
| `proposed_strategy` | `fast` / `deep` / null |
| `policy_version`, `feature_schema_version`, `decision_state_version`, `model_catalog_version` | trusted contract version文字列、`feature_schema_version="3"`、`decision_state_version="1"`。未検証・異なるversionを黙認しない |
| `owner_approval_ref` | trusted確認済み参照／無しはnull。`PENDING`を承認済み文字列に偽装しない |
| `proposed_review_model`, `selected_review_model`, `host_success_model`, `executed_review_model` | 有効なcatalog model_id またはnull。値の意味は§7.3。`executed_review_model`は厳密な成功条件成立時のみ非null |
| `attempted_review_models` | §7.2のcompleted系列から厳密に生成したmodel ID配列。順序維持 |
| `review_validation_status`, `head_validation_status` | `passed` / `failed` / `not_run`。unknownをpassedにしない |
| `audit_status` | **`sealed`**のみfinal.jsonへの正規書込み許可。**この値はArtifact upload成功を意味しない** |
| `review_scope_gap`, `features_incomplete`, `review_quality_measured` | boolean。G2/shadowではquality必ずfalse |
| `decision_api_cost`, `latency_ms` | finite nonnegative number / null。無料と推測して0を入れない |

`RoutingAudit/v2`はローカルで内容を整合照合（e.g. `executed_review_model`は試行系列にあり、それに対応する唯一のHost successがあり、既存review JSON `status=success` + downstream validation PASS + HEAD一致）。`skipped/failed`/未検証時は`null`。`final.json`は**seal後immutable**。Artifact配送事実は`AuditDeliveryOutcome/v1`（workflow内部のstep `outcome=success|failure|skipped`、artifact参照、`runId:string`/`runAttempt:number`を§6.1.1の`workflow_run_id`/`run_attempt`と照合し、**final.jsonには含めない**）で別管理。schema・type・error処理と§8.1のGateを混同しない。

### 11.3 監査保存・閲覧・保持（Owner G0-D07）

**R4初版の`G0-D07=PENDING_OWNER`は履歴**。現在は§15.2により無料Decision限定、routing Artifact**30日保持**、中央リポジトリreadアクセス境界の**基本方針のみ承認済み**。個別のSecret管理・IDの保存詳細、GitHub実アクセス評価、事故保全例外、削除手順、監査担当者等の**運用承認・検証は未了**のため、**shadow/enforceを有効化しない**。`retention-days`は起動可能になったときのみOwner-approved値`30`を明示し、暗黙既定値へフォールバックしない。既存`ocr-debug-logs`の保持契約は変更しない。

### 11.4 監査失敗の通知保証と限界

- Artifact step fail：`publish_authorized=false`、PR review comment/未完了threadの変更は不可、Check Runがある場合`conclusion=failure`で`ROUTING_AUDIT_MISSING`およびActions実行URLを表示する。Check Run不在またはAPI不達なら**job failureとサニタイズ済みActions log**に固定enumを残す。外部のCheck Run更新自体が失敗した場合は通知の成功を主張しない。
- `always()`は**証拠収集・failure Check Run**に限定して許可し、条件付きpost/resolveを`always()`のみで実行しない。失敗のサニタイズ済ログすら書けない場合は失敗として明示する。
- `executed_review_model`が非nullでも、artifact fail/公開禁止の状態を`review published`と表示しない。Host/validation通過はpublication成功と独立。

### 11.5 RG-R1-004 — Shadow G2観測証拠と配送の最小契約

- **生成責任**：`prepare-review-routing.mjs`がTask 8 `writeRoutingDecision`を呼び、`decision.json`を作成・freezeする。**shadowでbinding検証済みrouteが存在する場合に**既存Hostの呼出し点で`onAttemptEvent`をobserverとして登録し、Task 8の`createAttemptRecorder`を通じて`attempts.ndjson`に保存する。**選定されたproposedモデル/許可fallbackをHostへ渡さない。** 現行のlegacy model/retry/fallbackは完全に同一。
- **shadowの正規ファイル**：①`decision.json`は、Host前に採取できる分類・risk floor・`proposed_strategy`・`route_source`・decision/egress status・latency/cost（取得不能なら`null`）・policy/schema/catalog版・HEAD/run拘束を含む。②`attempts.ndjson`は既存HostのCLI引数試行を記録し、未観測なら0行のファイルと明示的`observer_status=unavailable`を診断に記す。③`final.json`はHost終了と既存OCR検証・HEAD判定の**観測可能な範囲**で`RoutingAudit/v2`をbest-effort封印する。未成立の`host_success_model`/`executed_review_model`は`null`、`review_quality_measured=false`。shadowの`selected_strategy`は**実適用されていない候補を表すために使わず`null`**とし、提案は`proposed_strategy`にのみ入れる。`RoutingAudit/v2`の`selected_strategy`の型は`fast|deep|null`と読み替える（`null`はshadowのみ許可、enforceは非null必須）。
- **`RoutingDecisionRecord/v1`（`decision.json`）**：全キー必須、追加キー禁止。`schema_version:'1'`、`effective_mode:'shadow'|'enforce'`、`head_sha:hex40`、`workflow_run_id:canonical_decimal_string`、`run_attempt:positive_safe_integer`、`classification_status`（§4.2のenum）、`risk_floor:'fast'|'deep'`、`reviewable_file_count:nonnegative integer`、`proposed_strategy:'fast'|'deep'|null`、`selected_strategy:'fast'|'deep'|null`、`route_source:'model_decision'|'deterministic_fallback'|'not_requested'`、`decision_status:'succeeded'|'unavailable'|'not_requested'|'invalid_response'`、`egress_status:'allowed'|'denied'|'not_checked'`、`observer_status:'available'|'unavailable'|'not_started'`、`decision_latency_ms:finite nonnegative number|null`、`decision_api_cost:finite nonnegative number|null`、`policy_version:string`、`feature_schema_version:'3'`、`decision_state_version:'1'`、`model_catalog_version:string`。値はtrusted enum/数値/版のstrict projectionだけ。`observer_status`はHost前に`not_started`としてfreezeする。Host後の観測成否は、`final.json`では許容済みの試行／成功モデルの`null`や空配列で表し、詳細な失敗enumはサニタイズ済みActions診断にのみ記録する（freeze後上書き禁止、`RoutingAudit/v2`へ追加キーを挿入しない）。`route_source=not_requested`は`reviewable_file_count=0`の場合のみ。`RoutingDecisionRecord/v1`のbindingは`RunBinding/v1`をtrusted writerがフィールドごとに投影し、`SelectedReviewRoute/v1`と`RoutingAudit/v2`の同値を下流validatorが検証する。
- **未登録のlegacy model**：shadow observerがCLIモデルIDをtrusted catalogに照合できない場合、モデル名の推測・偽装やlegacy Host停止をせず、`observer_status=unavailable`を**Actionsの別診断**として記録し、`RoutingAudit/v2`の`audit_status`に許容外の`unavailable`を代入しない（正規の`final.json`が成立するときの`audit_status`は`sealed`のみ）。attempt streamは0行でもよく、最終成功モデルは`null`。これを「実行モデルを認定・測定した」と表示しない。`enforce`で同じ欠落が生じた場合は公開禁止。
- **配送**：`shadow`も固定3ファイルだけを独立`Upload routing audit`（Owner承認済み`retention-days=30`、リポジトリread閲覧境界、追加の削除/Incident決裁は未了ならshadow起動禁止）でbest-effort uploadする。部分ファイル・不正schemaならアップロードせず`SHADOW_AUDIT_UNAVAILABLE`をActionsの固定診断に記す。upload失敗／audit不整合は**既存review投稿とCheck Runを妨げない**。`off`では3ファイル・新uploadとも0。G2はroutingメタデータ・失敗率・latency/cost等の観測であり、レビュー品質比較はG3まで実施しない。

## 12. 将来Implementation Planの分割単位（**R4初版当時はPlan未作成：履歴**）

| Plan work item | 予定する責任・成果物（設計のみ） | Red/Green / contract test観点 |
|---|---|---|
| P1 Trusted catalog / policy | §7.0正規JSON Schema・G0-D05認定record、allowlist、strict外部schema | JSON Schema + semantic cross-ref / 未認定primary/fallback拒否 |
| P2 All-change feature extraction | `InternalPRFeatures/v3`、安全なGit metadata読み取り | rename/delete/binary/mode/submodule/0件/unknown/fail-safe |
| P3 Deterministic classification | §5の限定fast allowlistとDeep floor | `src/util.ts`一般コード、docs-only、mixed、未知path |
| P4 Egress authorization | GitHub repo identity取得、restricted allowlist、EgressAuthorization | API失敗、不一致、PR文字列偽装、private no grantでPOST0 |
| P5 Decision Provider | 内部v3→外部v1 strict projection、専用API、応答検証 | T-005/006、leak/extra keys POST0、timeout/429安全fallback |
| P6 Host fallback / attempts | four-state fallback validation + `onAttemptEvent(event: ReviewAttemptEvent/v1)` | absent/[]/array/null/undefined、各attempt、off/shadow完全回帰 |
| P7 Workflow / audit | §8.1 enforce順序と公開Gate、`AuditDeliveryOutcome/v1`、固定Artifact、retention | final seal→upload→gate→post、upload fail/Check failure/HEAD race |
| P8 Gates | G1 mock、G2 shadow観測、G3比較、G4判断 | 実行証拠分離、旧テスト回帰PASSは将来の要求（未実施） |

この表は**R4初版当時の履歴スナップショット**であり、当時Implementation Planが未作成だったことを表す。**現在はImplementation Planが作成済み**（§15.2参照）だが、独立Design↔Plan整合性レビューはR1でBLOCKEDであり、R1指摘の文書限定修正を実施中。独立PASSや実装・G1着手を意味しない。
## 13. 必須受入テスト設計（未実施）

| Test ID | 期待結果 |
|---|---|
| T-001 | `src/util.ts`の小変更、パス上security未検出でも**unclassified_code→deep**。`metadata_not_observed`をリスク不存在の証拠にしない |
| T-002 | allowlisted `README.md`単独A/M（禁止領域なし・OCR gapなし）のみ`fast`下限可。`docs/security-policy.md`は`deep` |
| T-003 | `README.md + src/util.ts`、rename、binary、symlink、submodule、mode変更、未知拡張子、NULパース不完全は`deep` |
| T-004 | OCR reviewable=0かつ高リスクを含むPRはAPI呼出0、scope gap記録、既存skip維持（G0-D04のblocking未決裁） |
| T-005 | **内部v3≠外部v1**を明示assert。`buildDecisionState(valid InternalPRFeatures/v3)`が外部v1の**正確な15キー**だけを生成。内部-only keys (`all_changed_files`, `head_sha`, raw path/diff/title/Secret)を送信0。追加キー・型/enum逸脱・`null`誤用はPOST0 |
| T-006 | §4.3のstateと§6.2のstateはJSON構造・値が一致、unknown schema/versionはPOST0 |
| T-007 | publicはAPI `private/visibility`整合＋trusted policy許可時だけPOST。private/internalはrepo `id+full_name`の完全一致allowlistがないとPOST0 |
| T-008 | GitHub API 403/404/5xx/timeout/invalid JSON/inconsistent repo ID / forged PR `visibility=public` / 認可文字列を含むpathでもPOST0 |
| T-009 | restricted許可済なら内部grantが指定HEAD/destination/schema versionへ拘束され、別SHA・別repoへの使い回しを拒否。grantはAPI bodyに無い |
| T-010 | Decision 429/401/402/TLS timeout、不正`choice/probabilities`でもrisk floor下で決定的fallback。自動有料切替なし |
| T-011 | `fallbackModels` **キー不在**/`[]`/明示配列/own `null`/own `undefined`/型不正を全組合せで検証。enforceではキー不在はrouting gateで拒否、[]は補完0、invalidはspawn0。off/shadow従来CLI/model/fallback/再試行完全回帰 |
| T-012 | `onAttemptEvent(event: ReviewAttemptEvent/v1)`でprimary失敗→fallback成功のstart/complete/host_completed系列を厳密に収集。`executed_review_model=fallback`はdownstream validation + HEAD後のみ、primaryは成功扱いしない |
| T-013 | timeout、spawn_failed、invalid JSON、Host failed/skipped、event欠落・順序不正、downstream validation failure、HEAD mismatchは`executed_review_model=null`、enforce公開禁止 |
| T-014 | `ocr-result.json`のschema/内容は現行のまま。独立`attempts.ndjson`と`final.json`のみ新型で保持 |
| T-015 | enforceではHost+attempt確定→既存OCR検証→HEAD検証→final schema/seal→固定3-file Artifact upload→Gate→投稿。upload結果を事前にfinalへ記載しない。`off`は生成/upload0。D07未決裁でactivation不可 |
| T-016 | audit write/final schema/upload失敗時enforceはpost/thread mutation禁止、Check `failure`+`ROUTING_AUDIT_MISSING`、job failure。`always()`のartifact証拠収集とpost許可を区別。shadowは旧review/Check挙動を維持 |
| T-017 | 既存Node/Workerテスト、actionlint、`git diff --check`、HEAD再検証、レビュー投稿・重複排除契約が維持 |
| T-018 | G2の`review_quality_measured=false`、G3で同一SHA・同一rules/context比較と独立裁定がある場合のみ品質指標を公開 |

| T-019 | Trusted catalog root/modelの必須項目、`additionalProperties=false`、ref/certification_status整合、`catalog_version`一致、重複model_id・循環/自己fallback・存在しないpreferredを拒否 |
| T-020 | `pending/suspended/revoked` modelはいずれもenforce primary/fallback禁止。G0-D05 Owner証跡のみ/shaのみでは認定にしない。certification evidence未確認→`review_model_unavailable` |
| T-021 | enforce review success + valid sealed final + Artifact upload成功 +最終HEAD一致→publish gate true。post成功後のみCheck success。順序逆転のfixtureはreject |
| T-022 | Artifact upload失敗、missing file、wrong run_attempt、schema不正、HEAD変更→`publish_authorized=false`、post0、Check failure、job failure、監査欠損の明示 |
| T-023 | enforceで`Resolve fixed review threads`をGate前に実行しない。`off/shadow`のthread resolver、review comment・Check順序・fallback/再試行を回帰テストで保持 |
| T-024 | sealed finalの`audit_status=sealed`がupload successを意味しない。upload outcomeは分離。再seal・公開後の証拠差し替えを拒否 |

**T-004 clarification (2026-10-23):** The unchanged T-004 row preserves the original R4
acceptance condition when G0-D04 blocking was undecided. For current acceptance, §15.2
takes precedence: the Owner has approved the basic policy to block out-of-scope
high-risk or unclassified changes in `enforce`. Apply §8.2/§8.3 and T-026 together:
when reviewable=0, Decision API calls and Host spawns remain zero, and the internal
review result is schema-compatible `skipped` with an empty attempts stream. If a
D04 scope gap exists, the publish Gate must nevertheless deny publication and
report Check Run `failure` with `REVIEW_SCOPE_GAP_BLOCKED`; only a normal skip
without a blocking gap may be `neutral`. Preserve legacy `off/shadow` behavior.
This clarification neither establishes G1 acceptance nor grants operational
authorization or activation of `shadow/enforce`.

テストは**設計上の予定**であり、現在PASSや実行済みを意味しない。高リスク・非対象コードの未レビューを`coverage=1`に変換する改変は禁止。
### RG-R1限定追加受入テスト（T-001〜T-024を変更・削除しない）

| Test ID | 将来G1 mock / 監査での期待結果 | 対応Plan |
|---|---|---|
| T-025 | effective D01〜D07の基本方針と個別運用認可を混同しない。未決裁repo・モデル・Secret/削除/Incidentに承認済み値を挿入しない | Preflight・Tasks 1/4/8/9 |
| T-026 | 単一`prepare-review-routing.mjs`によるTask2→3→4→5→6→8の因果順、strictローカル変換、許可前POST0。reviewable=0はPOST0、enforceはHost spawn0＋schema互換skipped結果と0行attemptsを生成し、D04対象ならblocking。Secret変数mapping、3固定auditファイルをmockで検証 | Tasks 2〜6、8〜9 |
| T-027 | enforceで`Resolve fixed review threads`の返信・resolve呼出0。最初のPR mutation（post）直前のHEAD再検証がfailならpost0。off/shadowはresolver動作不変 | Task 9 |
| T-028 | shadowが`decision.json`・`attempts.ndjson`・`final.json`を作成/固定スキーマでbest-effort配布し、失敗しても旧投稿/Checkが継続する。品質測定false・catalog外legacy観測null | Tasks 7〜9 |
| T-029 | enforceのprogress/stderr/例外/result.messageにPR風文字列・認証様文字列を注入してもActions/Checkへraw転載なし。off/shadowの既存振る舞いを維持 | Tasks 7、9 |
| T-030 | Task 1の依存追加**前**にNode既存テスト・Worker回帰・actionlint・git diff --checkを採取、未実行`NOT_RUN`。Ajv `npm ci`はTask 1導入後だけ実施 | Preflight・Tasks 1、10 |


### RG-R2限定追加受入テスト（T-001〜T-030の契約を維持）

| Test ID | 期待結果・責任Task |
|---|---|
| **T-031** | Task 4 `createRunBindingFromEnv`：`GITHUB_RUN_ID`の正規10進**文字列**を一切数値化しない。`9007199254740993`も正確に保存。run attemptは正規10進→正のsafe integerに一度だけ変換。空白/先頭0/指数/ゼロ/負数/overflow/`undefined`を拒否。`'123'`と`123`の混同なし |
| **T-032** | Tasks 6/8/9：`RoutingPreparationResult.runBinding`から`SelectedReviewRoute/v1`の全15キーだけをstrict projectionし、`decision.json`とHEAD/run/mode/attemptが一致。未知version、extra key、型差、差替え、再sealを拒否。外部State/grant/Secret/pathをrouteへ転写しない |
| **T-033** | Task 9：Host直前にenv由来trusted expected bindingとroute/decisionを比較。別HEAD、run ID、run attempt、mode、桁表現の差で`RUN_BINDING_MISMATCH`/`RUN_BINDING_INVALID`・**spawn 0**（enforce・存在するshadow route）。enforce欠損routeもspawn 0。shadowの純粋なbest-effort生成失敗はroute未消費で従来Hostを継続。offは新routeを参照しない |
| **T-034** | Tasks 4/5/8/9：同じ期待bindingが`EgressAuthorization/v1`→`RoutingDecisionRecord/v1`→`RoutingAudit/v2`→`AuditDeliveryOutcome/v1`へ保持される。grant/run/head mismatchで**Decision POST 0**、異なるdelivery `runId`/`runAttempt`やfinalのhead/mode不整合で**publish false**。`ReviewAttemptEvent.run_attempt_id`をGitHubの`run_attempt`と混同しない |

## 14. Gates / 評価範囲（R2-D維持）

- **G0 — Design / Owner**：今回R4の指定4 Finding／残余とG0-D01〜07の決裁事項を審査。**現状 PENDING**。技術是正案はOwner認可ではない。
- **G1 — Contract/Static**：FeatureSchema、DecisionState、egress grant、fallback、独立attemptイベントとaudit pathのmock/単体/既存回帰。実API・本番監査の証明ではない。
- **G2 — Shadow only**：G0/G1通過後、Owner指定scopeに限定し、Decision routingの応答・失敗/許可状況、risk floor override、class分布・速度を観測。**選択モデルを実行しないので、提案モデルのレビュー品質を測定・主張しない**。
- **G3 — Controlled execution comparison**：Owner承認後、同一SHA/同一OCR preview/context/rules、固定モデルと候補モデルの限定実行比較。PRコメント重複を避け、独立した人間による品質裁定（偽陽性/漏れ/重大度/coverage/失敗率/コスト）が揃って初めて品質差を評価。
- **G4 — Owner rollout decision**：G2/G3証拠とD04/D07決裁を確認して限定enforceの本格展開判断。自動進行なし。

**今回の出力はR4 Design Specと別冊Handoffのみ**。G0承認・G1テスト・G2開始・G3検証・G4承認を一切行っていない。
## 15. 残存課題とOwner Decision Register（R4初版の未決裁状態：履歴）

**この表はR4初版作成時点の履歴**であり、現在の決裁状態ではない。現在の有効な決裁状態は**§15.2**。R4初版時点ではG0-D01〜D07は全て`PENDING_OWNER`だった。R2/R3のOwner課題をR4文書改訂だけで承認状態にしたものではない。

| Decision ID | Owner決裁対象 | R3での提案/論点 | Status |
|---|---|---|---|
| **G0-D01** | 初期モードと段階展開 | 初期`off`。以後shadow/enforceは別の明示的な有効化指示 | `PENDING_OWNER` |
| **G0-D02** | 外部特徴量送信認可 | publicもtrusted policy要、private/internalはGitHub repo id/full_nameと明示allowlist照合。どのrepoを許すかOwner決裁 | `PENDING_OWNER` |
| **G0-D03** | risk対象とOCR review scopeの分離 | `ALL_CHANGED_FILES`は分類のみ、OCRの指摘対象は`OCR_REVIEWABLE_FILES`に限定 | `PENDING_OWNER` |
| **G0-D04** | OCR対象外高リスク変更のwarning/blocking | `off/shadow`は現行動作＋shadow監査警告、`G3+ enforce`でblockingにするかOwnerが明示決定。未決ならblockingを追加しない・未充足を表示 | `PENDING_OWNER` |
| **G0-D05** | 最低モデル能力とfallback | 未認定のコード変更はDeep、Deep→Fast不可。§7.0の正規カタログ＋証拠真正性/能力認定Gateを満たしたモデルのみOwnerがDeep認定・fallback決裁。R4例は全件pending | `PENDING_OWNER` |
| **G0-D06** | G2の成功基準 | 分布/安定性/許可/コスト等のrouting観測に限定、品質比較はG3のみ | `PENDING_OWNER` |
| **G0-D07** | 費用・Secret・audit保存 | 無料モデル/自動有料移行禁止、**保持期間（日数・削除手順）と閲覧権限・ID取扱いは要Owner決裁**。未決ならshadow/enforceの監査公開は不可 | `PENDING_OWNER` |

### 15.1 追加の実証待ち（Owner承認とは別）

- OpenRouter `alpha` Decision APIのレスポンスフィールド・日次制限・実際の認証/許可。外部APIへの試行はG1/G2まで行わない。
- `agy`モデルIDの有効性とモデル能力の認定、provider側の実機model ID証明の可否。
- GitHub App tokenによる実際のrepo visibility取得可否と許可境界のmock/E2E。
- Archive/Artifactのdownload監査、retention-daysのGitHub制限、閲覧権限の運用実態。
- `fast` allowlistの対象文書パターン・denylistの正規表現誤判定をG0 Ownerで確認。
- 未作成Implementation Planとの仕様・用語・型/インターフェース・エラー処理・テスト方針・非機能要件の**一致確認**は後続Plan reviewの必須Gateとする。**Plan未作成のため整合性検証は未実施**。
### 15.2 RG-R1-001 — Plan作成後のeffective Owner Decision State（R4初版の履歴より優先）

**根拠と優先順位**：R4初版§15およびAppendix Hの`PENDING_OWNER`/`NOT_CREATED`は**当時の履歴**。2026-10-20にHuman Ownerが会話で7基本方針を「OK」と承認し、その後Implementation Planが作成された。**これだけでは運用レベルの個別grant/能力認定/Secret/監査削除・Incident承認やG0 full gateの通過は成立しない**。同日Superpowers Review Gate R1の判定は`BLOCKED`（Major 5、Minor 1）。今回の改訂後の正本間整合性は`AUTHOR_CORRECTED_PENDING_INDEPENDENT_RECHECK`、独立PASSではない。

| ID | 基本ポリシー（Human Owner会話承認） | 有効な運用認可・残余状態 |
|---|---|---|
| G0-D01 | `off`既定、shadowとenforceは各段階で明示承認 | `BASIC_POLICY_APPROVED`、shadow/enforce起動は`PENDING_ACTIVATION` |
| G0-D02 | 全repo外部送信default deny。publicも個別trusted policyが必要、restrictedは厳密id/full_name照合 | `BASIC_POLICY_APPROVED`、個別repository allowlist/grant=`PENDING_OWNER`、現在POST許可0件 |
| G0-D03 | Risk＝ALL_CHANGED_FILES、レビュー対象＝OCR_REVIEWABLE_FILESを分離 | `BASIC_POLICY_APPROVED`、コード・G1証明`NOT_STARTED` |
| G0-D04 | enforceではOCR対象外高リスク／分類不能変更をblocking | `BASIC_POLICY_APPROVED`、検証・有効化`PENDING`。shadow/offの従来動作は変更しない |
| G0-D05 | owner-certifiedモデルだけ実行、Deep→Fast禁止 | `BASIC_POLICY_APPROVED`、**個別モデルcertification/Gate証拠/承認0件**、現行catalog例は全pending。enforce不可 |
| G0-D06 | G2はrouting観測のみ、レビュー品質評価はG3 | `BASIC_POLICY_APPROVED`、具体的G2運用とG2実施は`NOT_STARTED` |
| G0-D07 | 無料Decisionのみ・自動課金禁止、routing監査Artifact保持30日、中央repository read権限を閲覧境界とする | `BASIC_POLICY_APPROVED`、Secret配布/実費評価・ID取扱い詳細・削除/Incident・実アクセス棚卸・実装確認は`PENDING_OWNER/VALIDATION`。shadow/enforce起動禁止 |

**2026-10-20時点の状態スナップショット（履歴。監査日現在の宣言ではない）**：`G0_BASIC_POLICY=APPROVED`、`G0_FULL_OPERATIONAL_AUTHORIZATION=NOT_GRANTED`、`IMPLEMENTATION_PLAN=CREATED`、`DESIGN_PLAN_CONSISTENCY=REVISION_READY_FOR_INDEPENDENT_RECHECK`（独立再審査前）、`RG_R2_INPUT_REVIEW=REVISION_REQUIRED(RG-R1-002_MAJOR,RG-R1-001_RESIDUAL_MINOR)`、`RG_R2_CORRECTION=REVISION_READY_FOR_INDEPENDENT_RECHECK`、`G1/G2/G3/G4=NOT_STARTED`、`IMPLEMENTATION=NOT_STARTED`、`GITHUB_WRITES_BY_RG_R1_CORRECTION_AUTHORING=NONE`、`DECISION_API_CALLS=NONE`、`SHADOW_ENFORCE_ACTIVATION=NONE`。

**後続の証跡記録（2026-10-23）**：実装とオフラインテストの記録は[Routing Notification Follow-up](../evidence/2026-10-23-routing-notification-follow-up.md)および[Routing Notification Remediation](../evidence/2026-10-23-routing-notification-remediation.md)を参照。Full G1 acceptanceは`NOT_ESTABLISHED`、独立G1評価は`NOT_RUN`。G2/G3/G4の運用認可・実施は未成立であり、この履歴スナップショットの`IMPLEMENTATION=NOT_STARTED`を後続実装の状態と混同しないこと。

この2026-10-20時点のスナップショットに記録された状態の切替は、新しいOwner証跡と独立再レビュー結果が得られた場合に限る。未決裁を`APPROVED`と書き換えてはならない。enforceゲートはD04で承認された**非対象高リスクのblocking**を適用する。§8.3の「将来のOwner決裁が必要」はR4初版時点の記述であり、この基本方針が承認された後の運用値の追加決裁・実装検証と区別する。


**RG-R2現行のGitHub履歴と本改訂の境界**：RG-R1の修正文書は2026-10-20に`feature/pr-dynamic-llm-routing-docs`へコミットされ、**reviewed commit `4df169ffa5fa5da33bb4b0d21d2580afb1d1c8e7`は既にGitHubに存在する**。R4初版およびRG-R1**作成時**の`GITHUB_WRITES=NONE`は各作成セッションの過去の非実施記録であり、リポジトリに対して今まで一度も書込みがなかった意味ではない。本RG-R2限定是正は**ローカル文書生成のみ**で、`GITHUB_WRITES_BY_RG_R2=NONE`、`SOURCE_CODE_CHANGED_BY_RG_R2=NO`、`DECISION_API_CALLS_BY_RG_R2=NONE`、`SHADOW_ENFORCE_ACTIVATION_BY_RG_R2=NONE`とする。Owner基本方針は承認済みだが運用grant/モデル認定/Secret/削除・Incident手順/段階有効化は未承認。`G1/G2/G3/G4=NOT_STARTED`は継続。RG-R2修正文書への独立レビューPASSは未取得である。

## 16. 参照資料（R2から継承、2026-10-20参照）

- [ocr-app / 確認対象HEAD](https://github.com/yohi/ocr-app/tree/68c5739c2570039fc62a4ed4814684ac65584791)（ドキュメント上の基準を固定）
- [ocr-engine.yml](https://github.com/yohi/ocr-app/blob/master/.github/workflows/ocr-engine.yml)
- [antigravity-host.mjs](https://github.com/yohi/ocr-app/blob/master/.github/workflows/scripts/antigravity-host.mjs)
- [prepare-ocr-review-context.mjs](https://github.com/yohi/ocr-app/blob/master/.github/workflows/scripts/prepare-ocr-review-context.mjs)
- [resolve-threads.mjs](https://github.com/yohi/ocr-app/blob/master/.github/workflows/scripts/resolve-threads.mjs)
- [OpenRouter Mercury Decide free](https://openrouter.ai/inception/mercury-decide:free)
- [OpenRouter Span-01 Lite free](https://openrouter.ai/respan/span-01-lite:free)
- [OpenRouter Jev overview](https://openrouter.ai/blog/insights/what-is-jev/)
- [OpenRouter pricing and free rate limits](https://openrouter.ai/pricing)
---

## Appendix A. R2-FND-001〜005 是正対応表（R3からの継承記録；残余はAppendix F参照）

| Finding | Severity | R2の問題 | R3での是正位置 / 契約 | Proposal判定 | 残る証拠 |
|---|---|---|---|---|---|
| **R2-FND-001** | Major | パスのみでコード本文のsecurity変更を検出不能 | §4.1/§5：fastは明示allowlisted docsのみ。通常コード・未分類・不完全はdeep。`metadata_not_observed`≠safe。T-001〜004 | `RESOLVED_IN_PROPOSAL` | G1 classification fixtures |
| **R2-FND-002** | Major | Host内部fallbackの実行モデル不明 | §7.2/§7.3/§11：review JSON不変、独立attempt event、Host+下流validator通過後だけ実成功モデルを設定。T-011〜014 | `RESOLVED_IN_PROPOSAL` | G1 callback/CLI mock、E2E |
| **R2-FND-003** | Major | private repo許可の情報源と責任が不明確 | §6.1/§10：GitHub API authoritative visibility、Human Owner approved trusted allowlist、repo id/name/head照合、Providerへローカルgrant。T-007〜009 | `RESOLVED_IN_PROPOSAL` | Owner D02、G1 mock、実API認可検証 |
| **R2-FND-004** | Major | 内部/外部state schema version・キーが異なる | §4.2/§4.3/§6.2：内部v3→正規外部v1、厳密な許可キー・変換責任・例一致。T-005〜006 | `RESOLVED_IN_PROPOSAL` | G1 schema/serialization tests |
| **R2-FND-005** | Minor | Routing auditのArtifact保存経路・retention結び付け不足 | §11/§15：固定3ファイル・別Artifact・Owner D07 retention/access gate。T-015〜016 | `RESOLVED_IN_PROPOSAL` | Owner D07、G1 workflow and artifact tests |

## Appendix B. R2→R3 変更履歴（履歴として保持）

| Change ID | R2からの変更 | 対象節 | Non-change |
|---|---|---|---|
| R3-01 | `通常コード/テストあり/局所`のfast許可を廃止し、認定済非実行docsのみfast候補とした | §4/§5 | OCR対象範囲は拡張しない |
| R3-02 | 内部FeatureSchema `v3`と外部DecisionState `v1`の厳密な変換・必須フィールド・enum・送信境界を定義 | §4.2/§4.3/§6.2 | Decisions APIとMercury第一候補を維持 |
| R3-03 | GitHub API属性・trusted repo ID+name allowlist・Human Owner・Provider grantを責任分離 | §6.1/§10 | Decisionはadvisory |
| R3-04 | 試行モデル、結果、Host success、最終実レビュー成功モデルを区別する独立監査インターフェースを確定 | §7.2/§7.3/§11 | OCR result schema不変、off/shadow legacy |
| R3-05 | 監査ファイル3件の固定Artifact path、別upload、retention/access Owner D07への依存を規定 | §11/§15 | 新規upload/activationなし |
| R3-06 | G1テスト項目18件とG0 Owner再審査項目を追加 | §13/Appendix C | G0・Plan・実装は未実施 |

**R2のA〜D継続状態**：

| R2項目 | 状態 | R3における維持根拠 |
|---|---|---|
| A — 専用Decisions API | `RESOLVED_IN_PROPOSAL` | §3/§6.2、Chat Completionsとは分離 |
| B — enforceだけ能力下限fallback、off/shadow legacy | `RESOLVED_IN_PROPOSAL` | §7.1/§7.2、tri-state契約維持 |
| C — 全変更リスクとOCR review scopeの分離 | `RESOLVED_IN_PROPOSAL` | §4.1/§5.3 |
| D — shadowではレビュー品質を測らない | `RESOLVED_IN_PROPOSAL` | §14/G2/G3 |

## Appendix C. 旧R3 G0再審査Checklist（履歴として保持。R4正本はAppendix G）

- [ ] **C-01**：R2-FND-001〜005の修正が§4〜§11とT-001〜T-018で追跡可能か。
- [ ] **C-02**：全変更集合が risk 判定に使われ、OCR対象外をレビュー完了と誤表示しないか。
- [ ] **C-03**：`src/util.ts`等のunknown codeがfastにならず、pathのみの「no risk」断定が消えているか。
- [ ] **C-04**：内部schemaと外部stateのキー/version/型が一意で、API bodyの例が完全一致しているか。
- [ ] **C-05**：Private/public/internalの属性authority、Owner allowlist、照合の責任、Provider grantが分離され、API失敗時にPOST0となるか。
- [ ] **C-06**：`off/shadow`の旧host挙動維持、`enforce`のfallback tri-state、下限維持が両立するか。
- [ ] **C-07**：attempt events・Host success・最終`executed_review_model`の語義が統一され、failed/skipped/unvalidatedで成功モデルを記録しないか。
- [ ] **C-08**：Audit Artifact名/path/`always()`/retention/accessの責任がG0-D07未決裁と矛盾しないか。
- [ ] **C-09**：G0-D01〜D07を全件`PENDING_OWNER`として扱い、特にD04 blocking、D07保有期間をOwner判断と明記したか。
- [ ] **C-10**：R2 A〜Dが`RESOLVED_IN_PROPOSAL`のまま、仕様回帰がないか。
- [ ] **C-11**：現時点ではPlan未作成。Plan作成後の設計↔Planの **仕様・用語・型/インターフェース・エラー処理・テスト方針・非機能要件** の逐条照合を独立Gateにするか。
- [ ] **C-12**：コード変更・API実行・GitHub書き込み・shadow/enforceの有効化が一切無いことを確認したか。

## Appendix D. R3時点の状態宣言（履歴。R4正本はAppendix H）

- `R2-FND-001..005 = RESOLVED_IN_PROPOSAL`：文書上の修正案が存在するだけで、実証・実装の証明ではない。
- `R2 A..D = RESOLVED_IN_PROPOSAL`：R2の設計補強を維持。
- `G0 = PENDING_OWNER`; `G1 = NOT_STARTED`; `G2 = NOT_STARTED`; `G3 = NOT_STARTED`; `G4 = NOT_STARTED`。
- `IMPLEMENTATION_PLAN = NOT_CREATED`。**Design ↔ Plan整合性は未検証**。
- `SOURCE_CODE_CHANGED = NO`; `GITHUB_WRITES = NONE`; `DECISION_API_CALLS = NONE`; `SHADOW_ENFORCE_ACTIVATION = NONE`。

**R3当時のG0再審査提出判定（履歴）**：`R3_DESIGN_CORRECTIONS_READY_FOR_FRESH_G0_REVIEW`。Owner承認・技術実証・セキュリティ運用許可・実装許可を意味しない。

## Appendix E. 後続Design ↔ Implementation Plan整合性契約（R3からの継承。R4追補はAppendix F.2）

後続Superpowers Implementation Planのレビューでは、次の対応表を逐条照合し、少なくとも不一致0件でなければPlanレビューを`PASS`としてはならない。この表は**Planの作成・検証済みを意味しない**。

| 照合軸 | Design側の正規規定 | Planレビューで求める証拠 |
|---|---|---|
| 仕様・スコープ | §§1,4,5,8、OCR既存review scope不変 | 予定変更の全タスクが非対象を侵さない差分計画 |
| 用語/状態 | `allowlisted_docs_only`, `unclassified_code`, `risk_floor`, `review_scope_gap`、off/shadow/enforce | enum/状態遷移表の語義が一致し、API unavailableとegress deniedを混同しない |
| 型/インターフェース | `InternalPRFeatures/v3`, `DecisionState/v1`, `EgressAuthorization/v1`, `ReviewAttemptEvent/v1`, `RoutingAudit/v2` | 必須キー・schema_version・strict projection・callback/event・契約テストを1対1対応 |
| エラー処理 | §9、false/unknown/失敗は安全側、deep降格禁止 | timeout/429/403/partial parse/Host fallback/validate失敗の各経路を明示 |
| テスト方針 | T-001〜T-018とG1/G2/G3の証拠分離 | Red→Greenのfixture名・期待値・既存回帰テスト・E2E境界を具体化 |
| 非機能要件 | API1試行/PR判定、5秒timeout、送信最小化、監査秘匿/サイズ上限、Owner保持決裁 | 性能/可用性/データ保護/権限/Artifact retentionの検証方法と未決裁依存の対応 |
| Owner認可 | G0-D01〜D07は`PENDING_OWNER` | Owner正式承認まで影響するactivation依存を未完了と明示 |

**Planレビュー必須結果形式**：`DESIGN_PLAN_CONSISTENCY = NOT_REVIEWED`（Plan不存在）→ Plan作成後 `PASS | REVISION_REQUIRED`。未作成Planに対して`PASS`を記録することは禁止。


## Appendix F. R3→R4 限定是正台帳（本書の規範節と対応）

| Finding | Severity | 是正内容と正規参照 | 文書上の状態 | 将来の実証 |
|---|---|---|---|---|
| `R3-FND-001` | Major | §8.1/§8.2/§11：Host→OCR検証→HEAD→final seal→upload→gate→publish。upload失敗でpost禁止/Check failure。`always()`とは分離 | `RESOLVED_IN_PROPOSAL` | T-015/016/021〜024; workflow/E2E |
| `R3-FND-002` | Major | §7.0：正規JSON Schema、6必須model項目、cross-reference、certification gate。G0-D05との一致 | `RESOLVED_IN_PROPOSAL` | T-019/020; Owner D05 |
| `R2-FND-004` 残余 | Major | §4.2/§4.3/§6.2、T-005/006：内部v3→外部v1 strict projection。等価schemaではない | `RESOLVED_IN_PROPOSAL` | G1 strict schema fixtures |
| `R2-FND-002` 残余 | Minor | §7.1/§7.2：`onAttemptEvent(event: ReviewAttemptEvent/v1)`、4状態fallback明確化 | `RESOLVED_IN_PROPOSAL` | G1 observer/CLI mock、legacy回帰 |

**非再審査のR3確定事項**：R2 A〜D＝`RESOLVED_IN_PROPOSAL`維持。R2-FND-001/003/005＝`RESOLVED_IN_PROPOSAL`維持。R2-FND-002/004は上記残余のみ是正し、R3の他の契約を維持。Design上解消されても実装・Owner認可・runtime証明ではない。

### F.1 R3→R4 変更履歴

| Change | 対象 | 差分 | 非変更 |
|---|---|---|---|
| R4-01 | §§8.1〜8.3/11 | enforceでfinal audit seal→Artifact upload outcome→publish gate→postの順序・失敗時結論とthread mutationを明示 | off/shadow旧Review/Check挙動 |
| R4-02 | §7.0 | TrustedReviewModelCatalog/v1の正規Draft 2020-12 schema、status/evidence semanticsとG0-D05を定義 | 既存モデル能力を認定済と扱わない |
| R4-03 | §4.3・T-005 | 内部v3と外部v1は別schema、strict projectionとextra key拒否に変更 | §4.3と§6.2のstate例は同一 |
| R4-04 | §§7.1/7.2 | onAttemptEvent唯一の契約とfallback own-property 4状態、invalid拒否を確定 | OCR Review JSON不変／legacy retry維持 |
| R4-05 | §§11/13、Appendix F/G | audit deliveryとfinal stateを分離、future contract tests T-019〜024、G0 checklist拡充 | Implementation Plan未作成、G0全件Pending |

### F.2 設計改訂に依存するPlan reviewの6軸契約

後続Superpowers Implementation Planが作られた場合に限り、**仕様・スコープ、用語/状態、型/インターフェース、エラー処理、テスト方針、非機能要件**の6軸およびOwner依存を逐条照合し**乖離0件**でなければPlan reviewをPASSとしない。特に正規JSON Schema、`ReviewAttemptEvent/v1`、`AuditDeliveryOutcome/v1`、Step1→7、G0-D05/D07依存、off/shadow回帰、T-005のstrict projectionをチェックする。Planは未作成なので`DESIGN_PLAN_CONSISTENCY = NOT_REVIEWED`を維持し、設計とPlanを照合済と主張しない。

## Appendix G. R4 G0再審査 Checklist（すべて未実施）

- [ ] `G0-R4-01` R3-FND-001の1→7順序が一意であり、Check Run `failure`/監査欠損表示と`always()`の意味が矛盾しない。
- [ ] `G0-R4-02` uploadに失敗したenforceで投稿0・thread mutation0・Check failure・job failureを保証できる設計か。
- [ ] `G0-R4-03` `final.json.audit_status=sealed`とArtifact配送結果を混同せず、upload before publish、immutable finalが保たれるか。
- [ ] `G0-R4-04` catalogueの正規JSON Schemaに6必須model fieldがあり、uncertified modelをenforceから除外するか。
- [ ] `G0-R4-05` G0-D05とmodel certification証拠GateがOwner未決裁のままで、認定済み実証と表記していないか。
- [ ] `G0-R4-06` T-005はInternalPRFeatures/v3≠DecisionState/v1としstrict projection・extra key拒否であるか。§4.3と§6.2の外部State例は完全一致か。
- [ ] `G0-R4-07` onAttemptEventのsignature・enum・時系列、fallback不在/[]/配列/null/undefinedの期待結果がテストと一致するか。
- [ ] `G0-R4-08` `off/shadow`でHost/retry/fallback/Review JSON/OCR選別/Check/投稿の旧挙動を変えていないか。
- [ ] `G0-R4-09` R2 A〜DおよびR2-FND-001/003/005に回帰が無いか。R2-FND-002/004残余の是正が証跡に対応するか。
- [ ] `G0-R4-10` G0-D01〜D07が全てPENDINGか。D04 warning/blocking、D05認定、D07保持/アクセスをOwner決裁とするか。
- [ ] `G0-R4-11` G1/G2/G3/G4がNOT_STARTED、実行/API/GitHub書込なし、Implementation Plan未作成を維持しているか。
- [ ] `G0-R4-12` 将来Design↔Plan 6軸の乖離0件レビューをGate条件とし、未作成PlanのPASSを主張していないか。

## Appendix H. R4初版の厳密な状態宣言（履歴；現在は§15.2）

- `R3-FND-001/002 = RESOLVED_IN_PROPOSAL`（今回の文書是正のみ）。
- `R2-FND-002/004 RESIDUAL = RESOLVED_IN_PROPOSAL`（今回の文書是正のみ）。
- `R2 A..D = RESOLVED_IN_PROPOSAL`、`R2-FND-001/003/005 = RESOLVED_IN_PROPOSAL`を維持。
- `G0-D01..D07 = PENDING_OWNER`、`G0 = PENDING_OWNER`。
- `G1 = NOT_STARTED`、`G2 = NOT_STARTED`、`G3 = NOT_STARTED`、`G4 = NOT_STARTED`。
- `IMPLEMENTATION_PLAN = NOT_CREATED`、`DESIGN_PLAN_CONSISTENCY = NOT_REVIEWED`。
- `SOURCE_CODE_CHANGED = NO`、`GITHUB_WRITES = NONE`、`DECISION_API_CALLS = NONE`、`SHADOW_ENFORCE_ACTIVATION = NONE`。

**提出状態**：`R4_DESIGN_CORRECTIONS_READY_FOR_FRESH_G0_REVIEW`（G0承認・Security承認・能力実証・実装許可・実運用開始を意味しない）。


## Appendix I. RG-R1限定是正履歴（現在の文書正本に適用）

| Finding | 修正位置 | 文書上の状態 | 独立実証 |
|---|---|---|---|
| RG-R1-001 | 冒頭の優先関係・§12・§15.2 | RESOLVED_IN_PROPOSAL | 再審査待ち |
| RG-R1-002 | §8.4・§11.5・T-026 | RESOLVED_IN_PROPOSAL | 後続Plan/G1 |
| RG-R1-003 | §8.1・T-027 | RESOLVED_IN_PROPOSAL | 後続Plan/G1 |
| RG-R1-004 | §11.5・T-028 | RESOLVED_IN_PROPOSAL | 後続Plan/G1/G2 |
| RG-R1-005 | §7.4・T-029 | RESOLVED_IN_PROPOSAL | 後続Plan/G1 |
| RG-R1-006 | T-030・Plan Preflight | RESOLVED（文書の順序修正） | 未実行 |

**レビュー状態**：`REVISION_READY_FOR_INDEPENDENT_RECHECK`。自己検証を独立`PASS`として扱わず、原R2/R3/R4の既存Findingを自動再OPENしない。


## Appendix J. RG-R2限定是正台帳（reviewed commit `4df169ffa5fa5da33bb4b0d21d2580afb1d1c8e7`を基準）

| Finding | R2の原因 | 今回の規範是正 | 著者自己判定・未実証 |
|---|---|---|---|
| **RG-R1-002**（Major） | `workflow_run_id`の整数/文字列不一致、保存route未定義、Host前の照合欠落 | §6.1.1、§8.4、§11.2/11.5、T-031〜034：canonical string/safe integer、binding伝播、厳格route投影、Host spawn 0、POST 0、publish false | `RESOLVED_IN_PROPOSAL`（G1未実行、独立R2再審査待ち） |
| **RG-R1-001残余**（Minor） | 未push宣言が既存のGitHub commitと矛盾 | §15.2現行追補：`4df169f`はpush済み、当時の未書込は履歴、RG-R2はGitHub書込なし | `RESOLVED_IN_PROPOSAL`（独立R2再審査待ち） |

**非変更**：RG-R1-003〜006の是正、R2 A〜D、R2-FND-001/003/005、R3-FND-001/002のproposal判定を維持。G0基本方針承認は個別運用認可でなく、G1/G2/G3/G4は`NOT_STARTED`。本改訂は実装・GitHub書込み・Decision API呼出し・shadow/enforce有効化を行わず、最終状態`REVISION_READY_FOR_INDEPENDENT_RECHECK`。本記録は独立レビューPASSを宣言しない。

## 2026-10-25 Owner限定 A/B 実装候補の追補

**適用状態**：Owner handoffに記された2026-10-25の限定契約承認に基づく候補実装範囲。これは設計差分の限定解除であり、独立レビュー、Gate受入、実運用権限、shadow/enforce activationを意味しない。従来の要件・除外は、以下の明記範囲だけを除き引き続き有効とする。

- **A / `TARGET-NEW-001`**：`resolve-threads.mjs`と関連オフラインテストに限り、認可済み`shadow`のGraphQL thread fetch・pagination・reply・resolve失敗は非0終了とし、後続処理を止める。ページングが途中失敗した場合は部分threadを処理しない。正常な0件は成功。既存の再認可拒否はfail-closedを維持する。`off`のlegacy挙動、Host契約、モデル選択、OCR結果schema、workflow、Check Run更新、activation policyは変更対象外。
- **B / `UNV-NEW-002`**：`post-ocr-comments.mjs`と関連オフラインテストに限り、`shadow`/`enforce`でGitHub APIアクセス前にCLI `--repo`と`TARGET_REPO`の整形式ASCII `owner/repo`値と大小文字無視の一致を検証する。不一致・欠落・不正形式・未知modeはfail-closedとし、注入callbackで回避できない。`off`挙動は変更しない。正規`publish-routing-review.mjs`のgateと同一対象repo引渡しを維持する。

本追補は§10.7の`resolve-threads`非対象記述をAの限定範囲だけで上書きし、実装計画にあった`post-ocr-comments.mjs`の変更禁止をBの限定範囲だけで上書きする。その他の変更禁止・G0〜G4承認要件・過去Findingの状態を変えない。Candidateの上限は`CORRECTED_IN_CANDIDATE / INDEPENDENT_REVIEW_REQUIRED`であり、独立PASSまたはGate解除を自己宣言しない。
