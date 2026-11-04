# OCR App — Google AI Pro Dynamic Code Review Routing Implementation Plan

> **For agentic workers (future, after Human Owner approval):** If implementation is separately authorized, use `superpowers:executing-plans` or an expressly approved equivalent. Steps use `- [ ]` for future tracking. **Do not automatically start implementation, subagent reviews, GitHub writes, CI, tests, external API calls, or activation.** The current R1 task is **DOCUMENT_ONLY targeted remediation**.

**Document status:** `F001_F004_F005_TARGETED_DOCUMENTARY_REMEDIATION_CANDIDATE / F007_HISTORY_CORRECTED / NOT_ADOPTED / NOT_EXECUTED`（2026-11-04 JST）。F-007の履歴訂正はGitHub記録済み。Human Owner未採択、Implementation/Activation HOLD。  
**Repository / intended target:** `yohi/ocr-app` / `feature/ocr-google-ai-pro-dynamic-review-plan-20261103` / `docs/superpowers/plans/2026-11-03-google-ai-pro-dynamic-review-routing.md`  
**Fixed source baseline:** `master @ 49cd3978d638b0236d1d396ca1c101cac04e2726`（不変）。**Historical Reviewed HEAD:** `013fc33b10a5622717d1a46cc6020a3d0805b7aa`（当時の文書blob `0eb0e89a36cdcb9adcfdc9904e6cf63e1763a1e0`）。**F-007 Reviewed HEAD / 訂正前の基点:** `10db62e6be0eca4db6e766264e4eb1067ef2253e`（当時の文書blob `feeb2ea3d340459019d546f3e8c1419db34ba23d`）。**2026-11-04 READ_ONLY照合時のfeatureブランチHEAD:** `3954235faafa728db05cee819cc2a216c3863f01`（F-007履歴訂正を記録済み）。各SHAは別時点の識別子であり、後続commitでHEADが進んでも歴史上の参照として保持する。**文書のGitHub記録済み状態とHuman Owner未採択状態は別**であり、Implementation/Activationの許可を意味しない。  
**Goal:** OpenCodeReview Delegation + Antigravity CLIによるコードレビュー精度を維持し、Google AI Proの利用枠を高リスクPRへ優先配分する。  
**Deliverable:** 既存機構を再利用し、実装者が新たな設計選択をせずに実施できる**最小限の実装計画**。  
**Architecture:** 現行の`fast/deep`、決定的なrisk floor、Mercury Decideのadvisory、認定済みモデルCatalog、同等以上TierのHost Fallback、既存Audit/Publish Gateを維持する。**コードfastは空の例外allowlistから開始**し、明示された非上書き安全条件・モデル品質認定・Owner承認がそろう場合にのみ許容する。`agy`のQuotaを予測する新規サービスは追加しない。  
**Tech Stack:** GitHub Actions / Node.js 20 ESM / `node:test` / Alibaba OpenCodeReview Delegation (`ocr`) / Antigravity CLI (`agy`) / Google AI Pro / OpenRouter Decisions API（現行 Mercury Decide）。
**Spec:** `docs/superpowers/specs/2026-10-20-pr-dynamic-llm-routing-design.md`（既存R4）。本書§2はR4への**限定規範差分の提案**であり、R0正式採択証拠は未確認。§2のHuman Owner採択が成立するまでR4のコードdeep下限を優先する。

## 0. Authority and Scope — 本改訂で確定すること・しないこと

- **Current work authority:** `DOCUMENT_ONLY / READ_ONLY SOURCE INVESTIGATION`。**禁止**: source modification、実装、テスト実行、GitHub書込み、Activation、外部API呼び出し、自動follow-up。本文中のシェルコマンドは**将来Ownerが許可した実行環境向け**であり、今回実行していない。
- **R4とR0の優先関係（F-001）:** 既存R4 `docs/superpowers/specs/2026-10-20-pr-dynamic-llm-routing-design.md` の「通常コードは `unclassified_code → deep`」が現時点の規範。本書は**2026-11-03最小差分設計R0の限定例外案**を具体化するが、R0承認原本は今回未検証。**R0がR4全体を上書きしたと扱わない。** Human Ownerが本書の§2「コードfast限定規範差分」を採用した時に限り、**その限定事項のみ**R4の通常コードdeep規則に優先する。採用前は従来の `deep` を維持し、実装を開始しない。その他のR4契約（全変更集合による危険検知・External Stateの最小化・Gateなど）は維持。
- **実効承認の区別:** 本書の採用、実装開始、モデル認定、G1〜G4、実効Activation、外部送信、`off/shadow`動作変更は**別の権限**。Ownerが本書を採択しても、Model CertificationやActivationは成立しない。既存のApproval/Activation/Model Certificationは未成立として扱う。
- **事実と未検証:** 実環境の認証済み`agy models`、Quota、モデル品質、R0承認原本、最新実行環境のCLI identityは**未確認**。今回の実行結果やPASSを主張しない。
- **Non-goals:** 新しいサービス、Registry、ベンチマーク基盤、独自Quota予測、複数モデルの並列レビュー、自動再レビュー、OCR対象選別の再定義、認定の自動付与、Safety Hold解除、既存CI/公開Gate変更。

## Global Constraints（全Task共通）

- PR全変更集合でrisk判定、OCR Delegateのreviewable集合だけにFinding。Markdownの`include`は既定除外を解除する例外であり、コードのホワイトリストではない。
- `off/shadow`既定動作、Google AI Pro認証境界、既存`enforce`、HEAD再検証、Model Certification、audit/publish gateを変更・解除しない。
- `fast`は明示allowlistの**低リスクコード**と既存docs-onlyに限定し、unknown/incomplete/高影響変更は常にdeep。Decisionのconfidenceは非使用。
- `DecisionState/v1`の15キーだけを外部へ送信し、raw diff、path、PR title、Secretsの外部送信禁止。
- 認定済み・CLI inventory掲載・必要Tier以上で、かつ`readInstalledCliIdentity`で得た同一CLIバイナリSHA-256に結合したモデル以外を`enforce`実行せず、適格0件・証拠不一致・Activation不成立時はFail Closed。
- 追加サービス、Registry、Quota予測、大規模ベンチマーク、複数モデルレビュー、レビュー循環を作らない。
- 本文のRED/GREEN/Commitコマンドは**将来の実装許可後に実行**する指示。今回の3件限定文書訂正では実行しない。

## Review Focus（既存テストへ限定追加）

1. `fast_code_allow_paths=[]`の初期状態では通常コードは従来どおり`deep`（Task 2 C02）。
2. allowlist一致でも認証・権限・CI・migration・rename・scope gap・テスト/fixture/生成物は`deep`（Task 2 C04〜C08e）。
3. Decision未実行・HTTP 429・低probability・狭いmarginではコードfastを選択しないがdocs-only fastは変えない（Task 2 C09〜C11）。
4. Catalogの**pending**旧モデルもCLI inventoryに不在なら全体を拒否し、参照・root/各modelの`catalog_version`を同期する。旧versionの認定は流用しない（Task 3）。
5. `enforce`でCLIバイナリIdentity・正式inventory・モデル認定・監査・公開証拠が不成立ならレビューを公開しない（Task 1・Task 3・Task 4）。

---

## 1. 現行境界と維持すべき契約

| 対象 | 既存資産 | 本計画の扱い |
|---|---|---|
| 入口/レビュー文脈 | `cloudflare-worker/src/index.ts`, `.github/workflows/ocr-engine.yml`, `prepare-ocr-review-context.mjs`, `markdown-review-rules.json` | Webhook・PR diff・OCR Delegate・Markdown例外は変更しない |
| Risk features | `extract-pr-review-features.mjs`, `classify-pr-review-risk.mjs`, `review-risk-policy.json` | **全変更集合**を見て、限定コード例外のrisk floorだけ拡張 |
| External Decision | `build-decision-state.mjs`, `decision-provider.mjs` | PR本文・raw diff・file paths・Secretsを送らず、既存15-keyバケット化Stateのみ |
| 選択 | `select-review-model.mjs` | 決定的下限優先、`confidence`非使用、probability+marginの既存判定を再利用 |
| Catalog/認定 | `review-model-catalog.json`, `review-certification-index.json`, `validate-review-model-catalog.mjs` | 認証済みinventoryと**全Catalog登録モデル**の整合を必須とする |
| Host/Audit/Publish | `antigravity-host.mjs`, `ocr-routing-audit.mjs`, `run-routing-review.mjs`, `evaluate-routing-publish.mjs` | 同等以上TierのみFallback、attempt audit、HEAD検証、失敗時publish拒否を維持 |

**OCR `include` semantics:** `markdown-review-rules.json`の`include`はMarkdownの既定除外を上書きするための追加規則で、コードレビュー対象をMarkdownに限定するホワイトリストではない。コードreviewable集合と、risk判定の全変更集合を混同しない。

## 2. コードfast限定規範差分（F-001/F-002）

### 2.1 契約・バージョン・互換性

1. **新分類値:** `classification_status = "allowlisted_low_risk_code"` を新設する。`allowlisted_docs_only`をコードへ流用しない。`unclassified_code`は引き続き**常に`deep`**。分類値追加は`InternalPRFeatures/v3`、`DecisionState/v1`、Routing Decision/Auditのそれぞれの**既存キー・型構造を変えずに、列挙値だけ拡張**する限定契約変更である。
2. **バージョン処理の固定方針:** JSONの`schema_version`は**現行値を維持**する（`InternalPRFeatures/v3`=`"3"`、`DecisionState/v1`=`"1"`、`RoutingDecisionRecord/v1`=`"1"`、`RoutingAudit/v3`=`"3"`）。ただしこれは**新enumに対する旧validatorの互換性を意味しない**。分類値の宣言・受理・serialize・validateを**同一の原子的ソース変更**で同期し、古い実行中ワークフローへ新値を渡さない。別の新規version系列や移行サービスを作らない。
3. **変更する列挙値受理点:** `classify-pr-review-risk.mjs`、`build-decision-state.mjs`の`CLASSIFICATION`、`ocr-routing-audit.mjs`の`CLASSIFICATIONS`、その他**現行の同じenumを閉じて検証する既存箇所**（該当するvalidator/fixtureに限る）。Decision Stateの**15 keys**、Decision Record/Auditの各既存record keys、`feature_schema_version="3"`、`decision_state_version="1"`、`fast/deep`の文字列値、`selectReviewRoute`の戻り値契約は変更しない。`createRoutingDecisionRecord`/`validateRoutingDecisionRecord`は`schema_version="1"`、`finalizeRoutingAudit`/`validateRoutingAudit`は`"3"`を維持する。R4の歴史的な監査version記述を理由に、現行実装のAudit v3をv1/v2へ変更しない。
4. **信頼済みRisk Policy:** 既存`review-risk-policy.json`に`fast_code_allow_paths: []`を追加する（既存`validPolicy()`に新キーの安全な配列検証を追加）。値は**重複のないrepo-relative path用JavaScript正規表現文字列の配列**（既存`allow_paths`/`deny_paths`と同形式）、初期値は**必ず空**。追加後も`new RegExp(pattern)`と既存`pathsMatch`を使用し、別のglobエンジンは作らない。新キーは`classify-pr-review-risk.mjs`の`validPolicy()`で配列・文字列・長さ最大256・正規表現構文・重複を検証する。キー欠落は互換性のため**空配列**として扱う。不正な値があればfail-closedし、`fast`と解釈しない。**このrisk policyには`policy_version`キーが存在しないため新設・更新しない。** `decision-egress-policy.json.policy_version`も変更しない。既存の`hashRoutingSourceManifest`でrisk policyを含むソースの変更ハッシュを再照合する。実効Activationを流用して`enforce`に進むことは禁止。
5. **実装・承認の境界:** この例外の**規範採用はOwner判断待ち**。将来許可パターンを空から非空にする行為も別のRisk Policy変更・品質証拠確認・Owner承認を要する。今回の計画は許可パターンを**1件も提案・登録しない**。

### 2.2 決定的な評価順序

以下は**PR全体**に適用する。最初に一致した行で判定を確定し、後段で上書きしない。

| 順位 | 条件 | `classification_status` / `risk_floor` |
|---|---|---|
| 1 | 入力欠損、Git解析不完全、未知status、trusted policy不正・欠落の危険情報、`features_incomplete=true` | `incomplete` / `deep` |
| 2 | `review_scope_gap=true`、OCR reviewable範囲外にコード・高影響ファイルを含む、reviewableの集合がPR全変更集合に一致しない | 該当既存分類（不明は`incomplete`） / `deep` |
| 3 | security/auth/authorization/IAM/credential/secret/token/crypto/payment/migration/deploy/permission/policy、CI・Workflow・保護設定・認証境界に該当するpath/areaまたは既存risk signalがある | `high_risk_metadata`（該当時） / `deep` |
| 4 | **コード変更に限り**、rename/copy/delete、binary、symlink、submodule、file mode/executable bit変更、`A/M`以外の状態、**後述の`isNonOverridableTestOrGenerated`が真**、未対応拡張子 | 既存の`unclassified_code`/`unclassified_other` / `deep` |
| 5 | **コード変更に限り**、コード以外を含むmixed PR、`change_size !== "small"`、`all_changed_file_count`が1〜5の範囲外、`security_signal`または`migration_signal`が`metadata_not_observed`でない | `unclassified_code`（コードを含む場合） / `deep` |
| 6 | **コード変更に限り**、`fast_code_allow_paths`が空、**または**変更したコードの全pathが明示allowlistに一致しない | `unclassified_code` / `deep` |
| 7 | 1〜6のいずれにも該当せず、全変更が既知の通常`A/M`の**コードのみ**で、全ファイルがreviewable、信頼済みallowlist一致 | **`allowlisted_low_risk_code` / `fast`（下限のみ）** |
| 8 | 従来の非実行文書条件をすべて満たすPR | `allowlisted_docs_only` / `fast`（従来動作） |
| 9 | その他すべて | 既存の保守的分類 / `deep` |

**分類優先順位の実装上の意味:** 文書のみのPRは1〜3に該当しなければ8の既存docs-only判定を用いる。4〜7はコードを含むPRにだけ適用する。非上書き危険条件は、`change_areas`内の`ci/auth/iam/secret/crypto/migration/deploy/payment/unknown`、既存の非安全risk signal、`.github/`配下、および任意の変更pathのsegment/filename tokenに`security/auth/authentication/authorization/iam/secret/secrets/credential/credentials/token/crypto/permission/permissions/policy/policies/migration/migrations/deploy/deployment/payment/payments/workflow/workflows`がある場合とする。tokenは`/`、`.`, `_`, `-`で分割した小文字単語を基本とし、path先頭が`.github/`であることは別に検出する。既存の危険判定がこれより広い場合は**既存判定を優先**する。新allowlistはこれらを上書きしない。まず旧来の`deny_paths`を**非上書きハード禁止**と**普通のコードをdeepとする包括既定規則**に分けて扱う。`src/**`, `lib/**`, 一般コード拡張子のような包括規則は**例外成立前のdeep既定**であり、例外判定では単純なハード拒否として使わない。一方、テスト、CI、auth/security/secret/migrationなどを検出する既存の高影響条件は**必ず非上書き**。新allowlistを旧denylistより無条件優先するのは禁止。既存のdeny ruleそのものを削除せず、例外にのみ影響する**ローカル判定順**を変更する。既存path分類と**JavaScript RegExp**によるpolicy matcherを再利用し、新規汎用ルールエンジンは作らない。例えばC01の許可パターンはテスト用に`^src/safe/.*\.(?:ts|js|py)$`という正規表現文字列を使い、`src/safe/`の単なるprefix一致を「安全」と扱わない。

**テスト・fixture・生成物の非上書き禁止述語（F-002、§2.2の順位4／説明用の述語名であり新しい公開APIは不要）:** `classifyPRRisk(features, trustedRiskPolicy)`の既存の`features.all_changed_files`および`features.test_files_changed`のみを用い、**許可正規表現を評価する前**にPR全体について次の順で判定する。既存の高リスク条件が先に成立していれば、その既存分類を優先する。

1. `features.test_files_changed === true`なら`isNonOverridableTestOrGenerated = true`。`test_files_changed`がbooleanでない入力は`incomplete / deep`として扱い、`false`だけを「この信号では拒否しない」と解釈する。
2. `paths = features.all_changed_files.flatMap(file => [file.path, file.oldPath].filter(path => typeof path === 'string'))`の**いずれか**について、以下のどちらかが真なら`isNonOverridableTestOrGenerated = true`とする。`all_changed_files`やpath等のメタデータが欠損・不正なら、既存の入力完全性検査を優先して`incomplete / deep`にする。
   - **ディレクトリsegment:** `/(?:^|\/)(?:test|tests|spec|specs|__tests__|fixtures|__fixtures__|generated|__generated__)(?:\/|$)/i` にpath全体が一致する。`src/safe/fixtures/data.ts`、`src/safe/generated/client.ts`、二重アンダースコア付きの同名ディレクトリは必ず拒否。
   - **テスト/specファイル名:** pathの最後の`/`以降（basename）に `/(?:^|[._-])(?:test|tests|spec|specs)(?=[._-]|$)/i` が一致する。例: `src/safe/parser.spec.ts`、`src/safe/parser.test.ts`、`src/safe/test_parser.py`。大文字小文字を区別しない。
3. 上記1または2が真なら、コード変更を含むPRの`classification_status`は既存の保守的な`unclassified_code`（より高優先順位の危険分類が該当する場合はそれ）、`risk_floor='deep'`。**全pathが`fast_code_allow_paths`に一致しても上書き禁止**。F-002専用の外部Featureキー、Schema version、追加Risk Policyキー、Registryは導入しない。初期`fast_code_allow_paths=[]`は維持する。

**検出限界:** この述語はpathおよびGit metadataの命名規則だけに基づく。別名で格納されたfixture、生成されたソース、コード本文内の高リスク処理を完全に識別できない。`test_files_changed=false`かつ上記正規表現が非一致でも**安全性やfastレビュー品質の証明にはならない**。§2の限定規範差分・許可path・Model Certificationは引き続きOwner承認が必要。

**信頼境界:** 「path/メタデータ上で危険シグナルが観測されない」は**コード本文の安全性を証明しない**。`allowlisted_low_risk_code`はHuman Ownerが特定した限定パスの**ルーティング候補**であって、セキュアコード証明でも品質認定でもない。将来の`fast`実行には**対象の軽量モデル自体のModel Certification**が別途必須。

**Mixed PR:** たとえ全コードパスがallowlist一致でも、README/設定/テスト/CI/他言語などが混在すれば**deep**。Markdownのみの既存docs-only fastは変えない。Decision APIが不達・429・不正応答の場合、**コード例外候補はdeep**（§3）、docs-onlyは旧local floor経路を維持。

### 2.3 Fixture（現時点では未実行の将来テスト入力）

| case | all-changed / state（テストの`fast_code_allow_paths=["^src/safe/.*\\.(?:ts|js|py)$"]`のみ仮使用、JSON上ではバックスラッシュをエスケープ） | 期待 |
|---|---|---|
| C01 | `src/safe/parser.ts` 1件・`M`・small・all reviewable・危険シグナルなし（許可パターンはJavaScript正規表現 `^src/safe/.*\.(?:ts|js|py)$`） | `allowlisted_low_risk_code` / floor `fast` |
| C02 | 同じpathだが**初期空allowlist** | `unclassified_code` / floor `deep` |
| C03 | `src/safe/parser.ts` + `README.md` | `unclassified_code` / floor `deep` |
| C04 | `src/safe/auth/token.ts`（allow内だがauth/secret） | `high_risk_metadata` / floor `deep` |
| C05 | `.github/workflows/ci.yml` または`src/safe/migrations/001.ts` | `deep` |
| C06 | `src/safe/parser.ts` のrename / binary / executable-mode変更 / delete | `deep` |
| C07 | `src/safe/parser.ts` だが`review_scope_gap=true` / `features_incomplete=true` / signal=`unassessable` | `deep` |
| C08 | `src/safe/parser.test.ts` または`tests/safe.py` | `deep` |
| C08a | `src/safe/fixtures/data.ts`（仮のfast allowlistには一致、ディレクトリsegmentで拒否） | `unclassified_code` / floor `deep` |
| C08b | `src/safe/generated/client.ts`（同上） | `unclassified_code` / floor `deep` |
| C08c | `src/safe/parser.spec.ts`（ファイル名tokenで拒否） | `unclassified_code` / floor `deep` |
| C08d | `src/safe/__fixtures__/data.ts` / `src/safe/__generated__/client.ts`（それぞれ単独のPR） | `unclassified_code` / floor `deep` |
| C08e | `src/safe/parser.ts`（他のC01条件は維持、`test_files_changed=true`のみ） | `unclassified_code` / floor `deep` |
| C09 | READMEのみ、既存docs-only条件すべて成立 | **従来どおり**`allowlisted_docs_only` / `fast` |
| C10 | C01だがDecision不達、429、低probability、狭いmargin、不正応答 | **実効戦略**`deep`、`fast`実行なし |
| C11 | C01でDecisionが有効かつfast・既存probability/margin条件を通過 | **選択可能**`fast`（モデル認定・実効Activationが別途必要） |
| C12 | C01でも認定済みfastモデル0件 | `enforce`は**HOLD/失敗**、未認定モデルへ降格しない |

## 3. Decisionとモデル選択の限定変更（F-003）

- **`confidence`を選択判定に使用しない。** `normalizedDecision`が`confidence`を伝達しない現行実装に合わせる。`null` / 欠落 / 低`confidence`によって別の新しい分岐を作らない。新thresholdも追加しない。
- `strategyFor`の**既存probabilitiesとmarginの閾値・検証ロジックを変更しない**。有効な`fast`選択と解釈する条件は既存の`strategyFor`が`fast`を返した場合に限る。曖昧/無効なDecisionは既存ロジックが`deep`に倒す。
- **コード例外だけの追加ガード:** `features.classification_status === "allowlisted_low_risk_code"`のとき、Decision状態が既存列挙の`"succeeded"`で、既存`strategyFor`が`fast`と確定した場合だけ実効`fast`を許可する。それ以外（Decision未実行、不達、429、invalid、`deep`提案）は**実効`deep`**にする。実際の`decisionStatus`列挙は既存ソースから参照し、文字列`"succeeded"`を使う（新しい状態名を導入しない）。このguardは`select-review-model.mjs`の**現行選択関数内に1か所だけ**置く。`allowlisted_docs_only`および`off/shadow`の旧動作を変更しない。
- `decision-provider.mjs`の固定trusted question/criteriaは「`fast`は文書専用」と解釈されないよう`allowlisted_low_risk_code`も選択候補であると記述を調整するのみ。引き続き`DecisionState/v1`の**15キーだけ**を送信し、raw diff、paths、PR title、Secretsを決して含めない。外部レスポンスのParserやHTTP再試行は拡張しない。
- `risk_floor=deep`に対する`fast`助言は従来どおり拒否。`fast`モデルの認定が不明なら`deep`モデルを勝手に選ばず、既存の`resolveCertifiedModels` / `enforce`Fail Closedを維持する。

## 4. Google AI Proモデル・Catalog・Fallback（今回のF-004/F-005限定訂正）

1. **CLI Identityに結合したinventory取得（今は未実行）:** 将来、Human OwnerがREAD_ONLY取得を明示承認した**認証済みGoogle AI Proのtrusted runner**上で、既存の`.github/workflows/scripts/load-review-certification.mjs`の`readInstalledCliIdentity({env: process.env, targetRoot: env.TARGET_REPO_PATH || 'target-repo'})`を使用する。この関数は`$HOME/.local/bin/agy`の実体パスを検査し、checkout内の実行物を拒否して、`{resolvedPath, binarySha256}`を返す。`binarySha256`は**実体ファイルのraw-byte SHA-256、prefixなしの64文字小文字hex**。**PATH上の別の`agy`を呼ばない**。Owner許可後に限り、同じ環境で取得した`resolvedPath`を使って以下を実行する（表示は将来用、今は実行禁止）。

   ```bash
   # この AGY_BIN は readInstalledCliIdentity(...).resolvedPath を
   # trusted runner 上で取得し、同じ実行環境に設定した絶対パスとする。
   "$AGY_BIN" --version
   "$AGY_BIN" --output-format json models
   ```

   JSON応答が成功`status`、`command.data.models`が配列、全`command.data.models[].id`が非空のモデルID文字列であることを確認し、**表示された実IDだけ**を重複排除して昇順に記録する。CLIの引数順・出力が環境で拒否された場合、推測で代替IDを登録せず`NOT_VERIFIED`。取得前後に**同じ`readInstalledCliIdentity`を再実行**し、`resolvedPath`と`binarySha256`の完全一致を確認する。不一致は`NOT_VERIFIED`。CLIの`--version`出力を`cli_version`とするが、Pro有料非トライアル契約の適格性、残Quota、レビュー品質は**別の未証明事項**であり、この一覧取得だけでは認定しない。外部Decision API、`agy -p`、quota予測は本取得の対象外。

2. **既存inventory証拠schema（`loadVerifiedCertification`に準拠）:** 認証済みの上記結果から、**正確に6キー**のJSON evidenceを作る。`schema_version="1"`（固定）、`cli_version`（非空文字列）、`cli_binary_sha256`（取得時のIdentityの64文字hex）、`models`（重複なしの実モデルID文字列配列）、`observed_at`、`expires_at`（ともに`YYYY-MM-DDTHH:mm:ss.sssZ`のUTC日時）。`observed_at <= 検証時刻 < expires_at`でなければ失効。**有効期限はHuman Owner承認済みの証拠運用条件で確定**し、担当実装者がTTLを任意設定しない。未承認期限や時刻不整合なら`NOT_VERIFIED`。モデル一覧コマンドの生出力は証拠取得の検査対象であり、`models[]`以外のraw provider内容、認証Token、個人情報をinventoryに転写しない。

3. **正式index登録とOwner承認は別権限:** evidenceの確定**raw bytes**のSHA-256を求め、既存の`.github/workflows/config/routing-evidence/`をrootとして読む相対`path`を使い、既存`review-certification-index.json`の`index.cli_inventory = {path, sha256, approval_ref}`に結合する。`sha256`は`sha256:`prefixなし64文字hex、`approval_ref`はそのバイトハッシュを`subject_sha256="sha256:<digest>"`として承認する、未失効・非取消・対象repo一致の`kind="cli_inventory"` Human Owner承認を参照する。**evidence配置・index登録・承認記録の作成は将来の別権限**で、今回一切行わない。現行indexは`certifications: []`、`cli_inventory: null`であり、そのままでは`loadVerifiedCertification`は不成立。旧証拠や未承認の候補を正式indexとみなさない。

4. **実行CLIとの照合（既存契約をそのまま利用）:** `prepare-review-routing.mjs`は`readInstalledCliIdentity`から得た`binarySha256`を`loadVerifiedCertification({..., cliBinarySha256})`へ渡し、indexが`path`/`sha256`で参照するinventory evidence内の`cli_binary_sha256`と照合する。`routing-execution-context.mjs`は`cli_binary_sha256`と`cli_inventory_sha256`を封印・再検証し、`run-routing-review.mjs`が実行前にCLI Identityを再読取する。`antigravity-host.mjs`の`enforce`は証明済み絶対`resolvedPath`でspawnし、各fallbackを含む**各実spawn前**にIdentityを再照合する。この既存連鎖以外のバイナリを起動しない。未取得、不一致、期限切れ、証拠ref不整合は`NOT_VERIFIED` / **Enforce HOLD**であり、PATH上のLegacy CLIへ戻さない。

5. **Catalog全件の実モデル照合:** `validateCatalogSemantics`は`pending`も含めた**全`models[]`**にCLI inventoryでの存在を要求する。不在の旧`claude-opus-4-6-thinking`を`pending`で残す方式は禁止。ID不在のモデルは**削除またはinventory掲載の実IDへ置換**し、`strategies.fast/deep.preferred_model_id`、すべての`allowed_fallbacks`参照を同一変更で同期する。参照先不在・self-reference・重複・循環・Tier降格は既存validatorに従い拒否する。適切なfast/deep両preferred候補を揃えられなければCatalog変更を保留する。

6. **Catalog version lifecycle（今回のF-004）:** 現行`review-model-catalog.json`は`schema_version="1"`、`catalog_version="1.0.0"`。**モデルID、tier、preferred、fallbackの構造変更**を1つのCatalog更新単位として実施する場合、最新のroot `catalog_version=X.Y.Z`の**patchを1回だけ+1**して`X.Y.(Z+1)`とし（現行のままなら`1.0.1`）、rootと**全`models[*].catalog_version`**へ同じ値を記す。`schema_version="1"`は変えない。既存Catalogの`certification_status`/`certification_reference`だけを証拠に従って更新するときは、**この構造変更ルールによる追加のversion bumpはしない**（認定の参照先versionが動く循環を防ぐ）。他のCatalog形式や新規version系列は導入しない。root/model不一致は`catalog_version_mismatch`相当で不適格。

7. **旧versionのModel Certificationを流用しない:** `loadVerifiedCertification`は認定証拠の`model_id`、`capability_tier`、**`catalog_version`**が現行Catalogと全て一致し、`cli_evidence_sha256`が正式inventoryのraw-byte digestに一致し、モデル証拠・capability証拠・Owner承認が有効なことを要求する。Catalog version更新時は旧versionの認定を**失効扱いとして実効利用禁止**し、現行versionに結び付く認定が確立するまでは`certification_status="pending"`、`certification_reference=null`にする。**既存`index.certifications`に旧証拠が残る場合、無断で変更・削除せずEnforce HOLD**とし、別途許可されたOwner管理手順で整合させる。`capability_tier`という名前だけでは品質証明にならない。`certified`への変更、index登録、Model CertificationのOwner承認は別権限。

8. **LegacyとFallbackの維持:** Catalog更新は`enforce`用の候補変更に限る。`ocr-engine.yml`、`OCR_LLM_MODEL`、`ANTIGRAVITY_MODEL`、`ANTIGRAVITY_FALLBACK_MODEL`の`off/shadow`動作を暗黙に変更しない。不在IDがLegacyに残る場合は残余リスクとしてOwnerに提示する。Fallbackは`fast→fast/deep`、`deep→deep`の**認定済み・inventory掲載モデル**に限定し、`deep→fast`は禁止する。`isFallbackError`による実際のrate limit/quota/capacity等の失敗後だけ既存Host経路で代替し、二重レビュー・自動再レビューは導入しない。**正式CLI inventory・新Catalog versionの認定・Owner承認・source-manifest再認可・実効Activationが揃うまではEnforce HOLD**。`hashRoutingSourceManifest`、`evaluateRoutingStartup`、catalog digest照合、Audit/Publish Gateを緩めない。

## 5. 実装Task（将来のOwner許可後のみ）

### Task 1 — Pro CLI inventoryのREAD_ONLY証拠確定（事前条件、**実装Taskではない**）

**Consumes:** Ownerが許可したGoogle AI Proのtrusted runner/認証、実環境の`$HOME/.local/bin/agy`、既存`load-review-certification.mjs`、現行Catalogとindex。  
**Produces:** `readInstalledCliIdentity`による`{resolvedPath,binarySha256}`の取得前後一致、同バイナリで得た`cli_version`と厳密な実ID一覧、§4.2の**6-key inventory evidence候補**、raw-byte digest、`NOT_VERIFIED`理由。正式index登録・Owner承認は**未実施**。  
**Files to modify:** **なし**（READ_ONLY: `.github/workflows/scripts/load-review-certification.mjs`、`.github/workflows/config/review-certification-index.json`、`.github/workflows/config/review-model-catalog.json`、`.github/workflows/scripts/validate-review-model-catalog.mjs`）。  
**Functions / Interfaces:** `readInstalledCliIdentity({env, targetRoot}) -> {resolvedPath: absolutePath, binarySha256: hex64}`、同`resolvedPath`による`--version` / `--output-format json models`、既存`loadVerifiedCertification({ catalog, index, registry, repoIdentity, now, readEvidence, cliBinarySha256 })`の6-key inventoryと`index.cli_inventory={path,sha256,approval_ref}`契約。認定済みindexがない場合、証拠候補を認定と混同しない。  
**RED/GREEN:** 読取り専用の証拠取得であり**N/A（本Taskのテストなし）**。将来の許可された検証で`status`失敗、ID配列不正・重複、CLI Identityの取得前後不一致、期限不明、正式index/Owner承認欠損を個別に`NOT_VERIFIED`/`NOT_AUTHORIZED`として記録する。  
**Bounded REFACTOR:** なし。  
**Commit boundary:** なし。  
**STOP / Owner approval:** 今回CLIは実行しない。将来のREAD_ONLY取得、evidence保存、正式`index.cli_inventory`登録、Owner承認は**それぞれ許可範囲を区別**する。未取得・バイナリ不一致・期限未承認・証拠登録未承認ならEnforce HOLDを維持。公開モデル一覧や別バイナリで得た結果で代用しない。

### Task 2 — Risk floor・列挙契約・Decision選択の限定実装

**Consumes:** R4基準とOwner採用済みの本書§2限定差分、`InternalPRFeatures/v3`全変更データ、trusted`review-risk-policy.json`、現行Decision応答。  
**Produces:** 既存`classifyPRRisk`の戻り値契約に`allowlisted_low_risk_code`のenumのみ追加、`buildDecisionState(features)`で15-key射影、既存Routing Decision/Audit enum同期、コードfastに限るDecision成功ガード。  
**Files to modify:**
- `.github/workflows/config/review-risk-policy.json`（`fast_code_allow_paths: []`を追加。**versionキーは存在せず、新設しない**）
- `.github/workflows/scripts/classify-pr-review-risk.mjs`
- `.github/workflows/scripts/build-decision-state.mjs`
- `.github/workflows/scripts/ocr-routing-audit.mjs`
- `.github/workflows/scripts/decision-provider.mjs`
- `.github/workflows/scripts/select-review-model.mjs`
- 追加のrisk policy validationは`classify-pr-review-risk.mjs`内の既存`validPolicy()`だけを拡張する。未知のvalidator/schemaを実装対象に含めない

**Functions / Types / Interfaces:** `classifyPRRisk(features, trustedRiskPolicy)`（既存公開入口を変更しない。内部`validPolicy()`に正規表現配列検証、`decideStatus()`にコードfast限定例外を追加）、`buildDecisionState(features) -> DecisionState/v1`、`selectReviewRoute({mode, features, decision, certifiedCatalog, runBinding})`、`strategyFor`（既存probability/margin判定をそのまま呼ぶ）、Decisionの`requestReviewDecision`（既存固定questionのみ変更）、`validateRoutingDecisionRecord`/`validateRoutingAudit`。新しいAPI・Response fieldは追加しない。

- [ ] **RED 2-1:** `.github/workflows/scripts/classify-pr-review-risk.test.mjs`に§2.3 C01〜C09および**C08a〜C08e**を追加する。既定空allowlistで普通コードは`deep`、一時fixture allowlistでC01だけ`fast`。`test_files_changed=true`、`fixtures`/`__fixtures__`、`generated`/`__generated__`ディレクトリ、`.spec.`/`.test.`などのfile-name tokenは**allowlist一致でもdeep**。高リスク/mixed/不完全も`deep`。期待FAIL: C01の新enum/許可例外が未実装、またはコードfast許可のみ実装して禁止述語が未実装ならC08a〜C08eが`fast`に誤分類される。
- [ ] **RED 2-2:** `.github/workflows/scripts/build-decision-state.test.mjs`にC01の15-key射影、厳密enum受理、paths/diff非送信を追加。`.github/workflows/scripts/ocr-routing-audit.test.mjs`に新enumのDecision Record（`schema_version="1"`）/最終Audit（`"3"`）を追加。`feature_schema_version="3"`・`decision_state_version="1"`も不変と検証する。期待FAIL: 閉じたenum検証が新値を拒否。
- [ ] **RED 2-3:** `.github/workflows/scripts/decision-provider.test.mjs`にtrusted questionがdocs-onlyという限定を持たず、送信Bodyが既存15-keyのみである検査を追加。`.github/workflows/scripts/select-review-model.test.mjs`にC10/C11、既存docs-only fast不変、`confidence`有無で選択が変わらない検査を追加。期待FAIL: コードfast例外のDecision失敗時ガードが未実装。
- [ ] **RED 2-4 実行（将来のみ）:** 
  ```bash
  node --test \
    .github/workflows/scripts/classify-pr-review-risk.test.mjs \
    .github/workflows/scripts/build-decision-state.test.mjs \
    .github/workflows/scripts/ocr-routing-audit.test.mjs \
    .github/workflows/scripts/decision-provider.test.mjs \
    .github/workflows/scripts/select-review-model.test.mjs
  ```
  **Expected:** C01は`allowlisted_low_risk_code`非実装のためFAIL、新enumを使うState/Auditテストは`invalid enum`相当でFAIL、Decision失敗時guardのケースは旧`fast`選択が残るためFAIL。実際の失敗箇所を記録し、既存無関係テストの失敗を「意図したRED」とみなさない。
- [ ] **Minimum GREEN 2-5:** §2.2の順序でrisk floorを判定し、**§2.2の`isNonOverridableTestOrGenerated`を`test_files_changed`と全変更path/oldPathの固定正規表現から既存`classify-pr-review-risk.mjs`内で計算し、allowlist照合より先にdeep固定**する。`fast_code_allow_paths`が空なら従来どおり。新enumだけを内部/外部/監査受理点へ同期する。既存Decision質問の記述だけ更新し、§3の**コードfast例外にだけ**`decisionStatus === 'succeeded' && strategyFor(...) === 'fast'`ガードを追加する。低信頼・HTTP失敗などではコードfastを**deep**に戻す。docs-only/off/shadowは変更しない。
- [ ] **GREEN 2-6 実行（将来のみ）:** **RED 2-4と完全に同一の5ファイルの`node --test`コマンド**。**Expected:** 全PASS、C01〜C11と**C08a〜C08e**（fixture/generated/test・spec・`test_files_changed=true`の非上書き拒否）、旧docs-only、既存deep下限、外部データ最小化、監査enum受理がPASS。
- [ ] **Bounded REFACTOR 2-7:** 既存path/policy matcherの重複した条件整理のみ。変更後にGREEN 2-6を1回再実行。新規判定サービス・新規schemaフィールド追加禁止。
- [ ] **Commit boundary 2-8:** `git add`は上記Task 2変更ファイルと対応テストのみ。例: `git commit -m "feat(ocr): gate low-risk code routing with deterministic floor"`。本Taskでは実行しない。

**STOP / Owner approval:** 本書§2のOwner採択がなければTask 2開始禁止。Policy schemaや出力契約がこの確定案と一致しなければ無断で代替方式へ拡張せずOwnerへ報告。変更によるsource-manifest hash差異は既存Activationの再承認対象であり、現行承認を再利用しない。Decision Recordはv1、最終Routing Auditはv3を維持する。

### Task 3 — 実在ProモデルでCatalog整合・Fallbackを維持

**Consumes:** Task 1の**同一CLIバイナリに結合した実inventory候補**、現行`TrustedReviewModelCatalog/v1`、登録・認定・Activationの状態（未成立でも**pending Catalog候補の文書/限定実装準備は可能**。ただし`enforce`はHOLD）、新Catalog versionに対応する認定根拠（未成立ならpending）。  
**Produces:** root/全modelで同じ`catalog_version`、実在IDとpreferred/fallbackの全参照整合、証拠と未認定状態を区別したCatalog候補。**Catalog候補だけでは実効Activationもモデル認定も成立しない。**  
**Files to modify（将来、明示承認時のみ）:** `.github/workflows/config/review-model-catalog.json`。対象既存テスト: `.github/workflows/scripts/validate-review-model-catalog.test.mjs`、`.github/workflows/scripts/select-review-model.test.mjs`、`.github/workflows/scripts/antigravity-host.test.mjs`、`.github/workflows/scripts/load-review-certification.test.mjs`、`.github/workflows/scripts/run-routing-review.test.mjs`。**`review-certification-index.json`への正式登録は別権限であり、このTaskで自動変更しない。`ocr-engine.yml`/Legacy変数は触らない。**

**Functions / Types / Interfaces:** `validateCatalogSemantics(catalog, {verifiedCertificationRefs,cliAvailableModels})`、`resolveCertifiedModels(catalog,strategy,evidence)`、`loadVerifiedCertification({catalog,index,registry,repoIdentity,now,readEvidence,cliBinarySha256})`、`readInstalledCliIdentity({env,targetRoot})`、`runHost({model,fallbackModels,modelCatalog,routingMode:'enforce',executablePath,executableIdentity,targetRoot})`。既存Host引数・Catalog schema・CLI証拠schemaを増やさない。

- [ ] **RED 3-1:** `validate-review-model-catalog.test.mjs`に、`pending`のinventory不在でもCatalog拒否、旧IDを指すpreferred/fallbackの参照拒否、rootとmodelのversion不一致拒否を追加する。既存の同等テストがあれば新設せず既存を利用する。
- [ ] **RED 3-2:** `select-review-model.test.mjs`に認定適格0件と`deep→fast`禁止を確認し、`load-review-certification.test.mjs`の**旧Catalog version、inventory raw digest、CLI binary digest不一致、Owner承認欠損**ケース、`run-routing-review.test.mjs`の実行前Identity検査を利用する。`antigravity-host.test.mjs`はenforce時の各spawn/各fallbackにおけるCLI Identity一致、同等以上Tierのfallback失敗動作を確認する。既存PASSで保証される場合は重複テストを書かない。
- [ ] **RED 3-3 実行（将来のみ）:**
  ```bash
  node --test \
    .github/workflows/scripts/validate-review-model-catalog.test.mjs \
    .github/workflows/scripts/select-review-model.test.mjs \
    .github/workflows/scripts/antigravity-host.test.mjs \
    .github/workflows/scripts/load-review-certification.test.mjs \
    .github/workflows/scripts/run-routing-review.test.mjs
  ```
  **Expected:** 新たに追加した不整合caseは意図した拒否が未実装の箇所でFAIL。同等の既存テストがある場合は追加不要として、既存PASSを区別して記録する。未実行はPASSとしない。
- [ ] **Minimum GREEN 3-4:** Task 1 inventoryに存在しないIDを全`models[]`から除外/実IDへ置換し、`strategies.fast/deep.preferred_model_id`と`allowed_fallbacks`全参照を同期する。**モデルID・tier・preferred・fallbackの構造差分がある場合**、§4.6の規則に従い現在の`catalog_version`のpatchを一度だけ+1し、**全`models[*].catalog_version`をrootに統一**する。schema_versionは`"1"`維持。新versionに結び付く認定・index整合が未成立なら全該当モデルは`pending`/`certification_reference=null`とし、`certified`を捏造しない。適格fast/deepのpreferredが揃わない場合は偽IDを入れずCatalog変更を停止する。
- [ ] **GREEN 3-5 実行（将来のみ）:** **RED 3-3と同じ5ファイルの`node --test`コマンド**。**Expected:** 全PASS、version/ID/参照の整合、旧認定証拠の拒否、CLI Identity不一致時のFail Closed、`deep→fast`禁止、認定0件ではenforce HOLDを確認。
- [ ] **Bounded REFACTOR 3-6:** 不要。Catalogと既存テストに限定し、Host実装やLegacy既定設定は変更しない。
- [ ] **Commit boundary 3-7:** Catalog構造差分と対応テストが実際に存在し、別途OwnerのGitHub書込許可がある場合だけ`git add`し、例: `git commit -m "chore(ocr): align route catalog and version with Pro inventory"`。Task 1未検証や正式証拠不足ならコミットは作らない。本Taskでは実行しない。

**STOP / Owner approval:** Task 1のCLI Identity・実inventoryが未検証なら**Catalog候補の更新を停止**する。Task 1は確認できたが`index.cli_inventory=null`、認定index空/旧version、owner evidence/activation未成立の場合、別途許可されたCatalog候補の準備だけは可能だが**Enforce HOLD**を維持する。evidence配置・`index.cli_inventory`正式登録・認定承認・source-manifest/Catalog digest再認可は別権限であり、無断変更しない。Catalog更新のみで`enforce`を有効化せず、Legacy `off/shadow`動作の変更も別途Owner判断とする。

### Task 4 — 限定オフライン受入とHuman Owner checkpoint（実装Taskではない）

**Consumes:** Task 2/3の限定差分、Owner許可された実行証拠。  
**Produces:** **1回**の差分・テスト実績報告と、採用/保留/許可範囲をOwnerが選べる根拠。  
**Files to modify:** 新規成果物なし。既存テストのみを**許可後**実行。  
**Functions / Types / Interfaces:** `selectReviewRoute`、`resolveCertifiedModels`、`runHost`の既存契約、既存Audit/Publish Gateに対する回帰を確認。  
**RED/GREEN:** Task 2とTask 3の記載コマンドで局所TDDを終えた後、次の**既存テスト**を統合して1回実行する。新たなCIやテスト基盤を作らない。**本書では未実行**。

```bash
node --test \
  .github/workflows/scripts/classify-pr-review-risk.test.mjs \
  .github/workflows/scripts/build-decision-state.test.mjs \
  .github/workflows/scripts/ocr-routing-audit.test.mjs \
  .github/workflows/scripts/decision-provider.test.mjs \
  .github/workflows/scripts/select-review-model.test.mjs \
  .github/workflows/scripts/validate-review-model-catalog.test.mjs \
  .github/workflows/scripts/antigravity-host.test.mjs \
  .github/workflows/scripts/load-review-certification.test.mjs \
  .github/workflows/scripts/run-routing-review.test.mjs \
  .github/workflows/scripts/prepare-ocr-review-context.test.mjs \
  .github/workflows/scripts/prepare-review-routing.test.mjs \
  .github/workflows/scripts/run-routing-review.test.mjs \
  .github/workflows/scripts/check-pr-head.test.mjs \
  .github/workflows/scripts/evaluate-routing-publish.test.mjs \
  .github/workflows/scripts/publish-routing-review.test.mjs \
  .github/workflows/scripts/ocr-routing-workflow.test.mjs
```

**Expected:** すべてPASS。`off/shadow/enforce`、OCR preview/Markdown追加、HEAD、attempt audit、publish/Fail Closedの回帰を確認する。既存テスト自体が失敗した場合は新変更由来か判別して報告し、PASSとは記載しない。  
**Bounded REFACTOR:** なし。  
**Commit boundary:** なし（Task 2・Task 3の承認済み境界以外でコミットを増やさない）。  
**STOP / Owner approval:** テスト未実行をPASSとしない。`off/shadow/enforce`、監査、公開Gate、Model Certification、外部送信の権限を緩めない。実装結果が`REVISION_REQUIRED`でも自動訂正→再レビューに入らずOwner checkpointで停止。

## 6. Acceptance / STOP Conditions

**将来の実装受入（いずれもテスト未実行）**

- §2.3 C01〜C12および**C08a〜C08e**の経路が期待どおり。テスト・fixture・生成物の明示的な非上書き禁止述語がallowlistより優先する。**初期空allowlistの本番挙動は既存コードdeep下限と同一**。
- `confidence`を新判定に使わず、既存probability/marginとコード例外ガードだけを使う。Decision不達時のコードfastはdeep、docs-only fast/off/shadowは従来どおり。
- State 15 keys、Decision Record v1とRouting Audit v3（`schema_version="1"`/`"3"`）、両者の既存キー・`feature_schema_version="3"`/`decision_state_version="1"`、列挙値のみ同期。raw diff/paths/Secretsの外部漏出なし。
- inventory不在の`pending`モデルもCatalogへ残さない。モデルID/tier/preferred/fallback変更時にはpatch versionを1回更新しroot/全model一致、旧versionのcertification不流用。`readInstalledCliIdentity`とinventoryの`cli_binary_sha256`一致、正式`index.cli_inventory`/Owner承認と同Tier以上の認定が必要。認定0件・適格0件・権限なしは**Fail Closed**。
- 既存OCR Preview/Rule・Markdown追加レビュー・HEAD再検証・attempt audit・公開Gate・Check Runに副作用のある変更なし。
- 実証できないCLIモデル、Quota、認定、Activationは`NOT_VERIFIED`/`NOT_AUTHORIZED`として区別。未実行、証拠不足、観測された失敗を混同しない。

**今回の文書訂正の完了条件:** Reviewed HEAD `013fc33b...`で指摘された**F-001（Audit schema）、F-004（Catalog version）、F-005（CLI inventory Identity）**の3件だけを、既存計画の該当箇所へ反映した**文書候補**を作ること。過去のR1 Finding F-001〜F-006は既存記録として保持し、今回の対象を増やさない。独立再レビューやFindingゼロを完了条件としない。

**Owner checkpoint:** 本書は**未採択**。Human Ownerが§2の限定規範差分を採択し、実装を別途承認するまでは **IMPLEMENTATION HOLD**。CLI inventory取得、モデル認定、Catalog変更、GitHub commit/push、CI実行、外部API呼び出し、`shadow/enforce`起動はいずれも**自動開始禁止**。この文書訂正Taskはここで終了できる。

## 7. Writing-Plans限定補正のDisposition

- R1 Finding F-001〜F-006の対応は維持。今回の文書整形はそれらを再レビューするものではない。
- 現行risk policyの実装はglobではなく`RegExp`。Task 2の条件・Fixtureを実装と揃えた。
- `review-risk-policy.json`に`policy_version`はなく、実際の`policy_version`は`decision-egress-policy.json`由来。計画から存在しないversionの更新指示を削除した。
- 受入Task 4のテストファイルを実在パスで固定した。テストは未実行。
- GitHub上のR1候補、後続F-001/F-004/F-005文書訂正、および**F-007 Provenance限定置換候補はすべて記録済み**（F-007記録commit・今回のReviewed HEAD: `27c1200d660d7d3fa274809a000b87378409fd64`）。過去のREAD_ONLY照合時HEAD `3954235faafa728db05cee819cc2a216c3863f01`は履歴として維持する。**GitHub記録済みとHuman Owner採択済みは別**であり、Owner採択・Implementation/Activation許可は未成立、権限は変わらない。

## 8. Finding Disposition（先行R1限定改訂範囲）

| Finding | 文書訂正箇所 | 現時点の扱い |
|---|---|---|
| `OCR-GAIP-RG-R1-F-001` | §0, §2.1, §2.2, Task 2 | R4との限定優先関係・enum同期・Normative Owner gateを明記。**fast品質は未実証** |
| `OCR-GAIP-RG-R1-F-002` | §2.2, §2.3, Task 2 | deny/default分離・非上書き優先順位・空allowlist・mixed/Fallback fixture |
| `OCR-GAIP-RG-R1-F-003` | §3, Task 2 | `confidence`非使用とprobability/margin再利用、コード例外に限るDecision成功guard |
| `OCR-GAIP-RG-R1-F-004` | §4, Task 3 | pending含む全inventory照合、旧ID除外・参照整合・認定HOLD・Legacy非変更 |
| `OCR-GAIP-RG-R1-F-005` | §4, Task 1 | `agy --output-format json models`、`status`/`command.data.models[].id`、未実証時NOT_VERIFIED |
| `OCR-GAIP-RG-R1-F-006` | Task 2, Task 3, Task 4 | 5ファイル/3ファイルのRED/GREEN・期待値・Interfaces・commit境界 |

## 9. Source Context（検証範囲を区別）

- Existing R4: `docs/superpowers/specs/2026-10-20-pr-dynamic-llm-routing-design.md`（過去確認内容／本Taskで再取得・再実行せず）
- Existing OCR App source: fixed baseline `49cd3978d638b0236d1d396ca1c101cac04e2726`（今回のwriting-plansで`classify-pr-review-risk.mjs`, `select-review-model.mjs`, `decision-provider.mjs`, `validate-review-model-catalog.mjs`, `prepare-review-routing.mjs`, `review-risk-policy.json`等の実ソースをGitHub READ_ONLYで再確認）。
- **固定master baseline:** `49cd3978d638b0236d1d396ca1c101cac04e2726`。**Historical Reviewed HEAD:** `013fc33b10a5622717d1a46cc6020a3d0805b7aa`（対象文書blob `0eb0e89a36cdcb9adcfdc9904e6cf63e1763a1e0`）。**F-007訂正前のReviewed HEAD:** `10db62e6be0eca4db6e766264e4eb1067ef2253e`（文書blob `feeb2ea3d340459019d546f3e8c1419db34ba23d`）。**F-007履歴訂正を記録済みのGitHub HEAD（2026-11-04 READ_ONLY照合時）:** `3954235faafa728db05cee819cc2a216c3863f01`。この順序は履歴を表し、各SHAを同じ時点の現行HEADとして混同しない。
- 先行Review input: `OCR App — Google AI Pro Dynamic Review Routing / Superpowers Review Gate R1`、F-001〜F-006（既存記録）。今回の固定入力はReviewed HEAD `013fc33b...`への**F-001 Audit schema / F-004 Catalog version / F-005 CLI inventory Identity**の3件のみ。
- OpenCodeReview upstream release（背景、更新作業は範囲外）: https://github.com/alibaba/open-code-review/releases/tag/v1.13.4
- `agy` CLI JSON引数順の注意（review input由来、未再検証）: https://github.com/google-antigravity/antigravity-cli/issues/777

## 10. 今回のReview Gate 3件限定訂正 Disposition（Owner判断待ち）

| 今回のFinding | 訂正箇所 | DOCUMENT_ONLYの結果 |
|---|---|---|
| F-001 — Audit schema version | §2.1、Task 2、§6 | `InternalPRFeatures/3`・`DecisionState/1`・`RoutingDecisionRecord/1`・`RoutingAudit/3`を分離。既存schemaを変更せずenum受理点のみ同期する計画 |
| F-004 — Catalog version lifecycle | §4.5〜§4.8、Task 3、§6 | 構造変更時patch 1回更新・root/全model一致、旧version認定の不流用、source-manifest再認可を明記 |
| F-005 — CLI inventory identity binding | §4.1〜§4.4、Task 1/3、§6 | `readInstalledCliIdentity`の実行物とモデル一覧を結合、6-key inventory、index/Owner承認別権限、未取得/不一致はEnforce HOLD |

**判定境界:** 上記は文書としての反映範囲であり、CLIやテストの実測PASS、Model Certification、index登録、実装承認、Activationを意味しない。Human Ownerが本候補の採否を決めるまで`NOT_ADOPTED / IMPLEMENTATION_HOLD`。この限定文書訂正で停止し、レビュー・修正・独立Taskを自動連鎖させない。
