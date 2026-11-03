# OCR App — Google AI Pro Dynamic Code Review Routing Implementation Plan

> **For agentic workers (future, after Human Owner approval):** If implementation is separately authorized, use `superpowers:executing-plans` or an expressly approved equivalent. Steps use `- [ ]` for future tracking. **Do not automatically start implementation, subagent reviews, GitHub writes, CI, tests, external API calls, or activation.** The current R1 task is **DOCUMENT_ONLY targeted remediation**.

**Document status:** `R1_TARGETED_REMEDIATION_CANDIDATE / NOT_ADOPTED / NOT_EXECUTED`（2026-11-03 JST）  
**Repository / intended target:** `yohi/ocr-app` / `feature/ocr-google-ai-pro-dynamic-review-plan-20261103` / `docs/superpowers/plans/2026-11-03-google-ai-pro-dynamic-review-routing.md`  
**Fixed source baseline:** `master @ 49cd3978d638b0236d1d396ca1c101cac04e2726`。R1限定訂正候補は既にfeatureブランチのcommit `4758a9067bc8d9f95eabc408f8a2de5c3a071f20`に記録済み。**記録はOwner採択・実装許可を意味しない。** 今回のwriting-plans作業はその文書を入力にしたローカルの置換候補作成で、GitHubには書き込まない。  
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
- 認定済み・CLI inventory掲載・必要Tier以上のモデル以外を実行せず、該当モデル0件またはActivation不成立時はFail Closed。
- 追加サービス、Registry、Quota予測、大規模ベンチマーク、複数モデルレビュー、レビュー循環を作らない。
- 本文のRED/GREEN/Commitコマンドは**将来の実装許可後に実行**する指示。今回のwriting-plansでは実行しない。

## Review Focus（既存テストへ限定追加）

1. `fast_code_allow_paths=[]`の初期状態では通常コードは従来どおり`deep`（Task 2 C02）。
2. allowlist一致でも認証・権限・CI・migration・rename・scope gapは`deep`（Task 2 C04〜C08）。
3. Decision未実行・HTTP 429・低probability・狭いmarginではコードfastを選択しないがdocs-only fastは変えない（Task 2 C09〜C11）。
4. Catalogの**pending**旧モデルもCLI inventoryに不在なら全体を拒否し、参照を解消する（Task 3）。
5. `enforce`で認定済み適格モデルがなく、または監査・公開証拠が不成立ならレビューを公開しない（Task 3・Task 4）。

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
2. **バージョン処理の固定方針:** JSONの`schema_version`は**現行値を維持**する（Internal features=`"3"`、Decision State=`"1"`、Routing Decision/Audit=`"1"`）。ただしこれは**新enumに対する旧validatorの互換性を意味しない**。分類値の宣言・受理・serialize・validateを**同一の原子的ソース変更**で同期し、古い実行中ワークフローへ新値を渡さない。別の新規version系列や移行サービスを作らない。
3. **変更する列挙値受理点:** `classify-pr-review-risk.mjs`、`build-decision-state.mjs`の`CLASSIFICATION`、`ocr-routing-audit.mjs`の`CLASSIFICATIONS`、その他**現行の同じenumを閉じて検証する既存箇所**（該当するvalidator/fixtureに限る）。Decision Stateの**15 keys**、監査のrecord keys、`fast/deep`の文字列値、`selectReviewRoute`の戻り値契約は変更しない。
4. **信頼済みRisk Policy:** 既存`review-risk-policy.json`に`fast_code_allow_paths: []`を追加する（既存`validPolicy()`に新キーの安全な配列検証を追加）。値は**重複のないrepo-relative path用JavaScript正規表現文字列の配列**（既存`allow_paths`/`deny_paths`と同形式）、初期値は**必ず空**。追加後も`new RegExp(pattern)`と既存`pathsMatch`を使用し、別のglobエンジンは作らない。新キーは`classify-pr-review-risk.mjs`の`validPolicy()`で配列・文字列・長さ最大256・正規表現構文・重複を検証する。キー欠落は互換性のため**空配列**として扱う。不正な値があればfail-closedし、`fast`と解釈しない。**このrisk policyには`policy_version`キーが存在しないため新設・更新しない。** `decision-egress-policy.json.policy_version`も変更しない。既存の`hashRoutingSourceManifest`でrisk policyを含むソースの変更ハッシュを再照合する。実効Activationを流用して`enforce`に進むことは禁止。
5. **実装・承認の境界:** この例外の**規範採用はOwner判断待ち**。将来許可パターンを空から非空にする行為も別のRisk Policy変更・品質証拠確認・Owner承認を要する。今回の計画は許可パターンを**1件も提案・登録しない**。

### 2.2 決定的な評価順序

以下は**PR全体**に適用する。最初に一致した行で判定を確定し、後段で上書きしない。

| 順位 | 条件 | `classification_status` / `risk_floor` |
|---|---|---|
| 1 | 入力欠損、Git解析不完全、未知status、trusted policy不正・欠落の危険情報、`features_incomplete=true` | `incomplete` / `deep` |
| 2 | `review_scope_gap=true`、OCR reviewable範囲外にコード・高影響ファイルを含む、reviewableの集合がPR全変更集合に一致しない | 該当既存分類（不明は`incomplete`） / `deep` |
| 3 | security/auth/authorization/IAM/credential/secret/token/crypto/payment/migration/deploy/permission/policy、CI・Workflow・保護設定・認証境界に該当するpath/areaまたは既存risk signalがある | `high_risk_metadata`（該当時） / `deep` |
| 4 | **コード変更に限り**、rename/copy/delete、binary、symlink、submodule、file mode/executable bit変更、`A/M`以外の状態、テスト・fixture・生成物、未対応拡張子 | 既存の`unclassified_code`/`unclassified_other` / `deep` |
| 5 | **コード変更に限り**、コード以外を含むmixed PR、`change_size !== "small"`、`all_changed_file_count`が1〜5の範囲外、`security_signal`または`migration_signal`が`metadata_not_observed`でない | `unclassified_code`（コードを含む場合） / `deep` |
| 6 | **コード変更に限り**、`fast_code_allow_paths`が空、**または**変更したコードの全pathが明示allowlistに一致しない | `unclassified_code` / `deep` |
| 7 | 1〜6のいずれにも該当せず、全変更が既知の通常`A/M`の**コードのみ**で、全ファイルがreviewable、信頼済みallowlist一致 | **`allowlisted_low_risk_code` / `fast`（下限のみ）** |
| 8 | 従来の非実行文書条件をすべて満たすPR | `allowlisted_docs_only` / `fast`（従来動作） |
| 9 | その他すべて | 既存の保守的分類 / `deep` |

**分類優先順位の実装上の意味:** 文書のみのPRは1〜3に該当しなければ8の既存docs-only判定を用いる。4〜7はコードを含むPRにだけ適用する。非上書き危険条件は、`change_areas`内の`ci/auth/iam/secret/crypto/migration/deploy/payment/unknown`、既存の非安全risk signal、`.github/`配下、および任意の変更pathのsegment/filename tokenに`security/auth/authentication/authorization/iam/secret/secrets/credential/credentials/token/crypto/permission/permissions/policy/policies/migration/migrations/deploy/deployment/payment/payments/workflow/workflows`がある場合とする。tokenは`/`、`.`, `_`, `-`で分割した小文字単語を基本とし、path先頭が`.github/`であることは別に検出する。既存の危険判定がこれより広い場合は**既存判定を優先**する。新allowlistはこれらを上書きしない。まず旧来の`deny_paths`を**非上書きハード禁止**と**普通のコードをdeepとする包括既定規則**に分けて扱う。`src/**`, `lib/**`, 一般コード拡張子のような包括規則は**例外成立前のdeep既定**であり、例外判定では単純なハード拒否として使わない。一方、テスト、CI、auth/security/secret/migrationなどを検出する既存の高影響条件は**必ず非上書き**。新allowlistを旧denylistより無条件優先するのは禁止。既存のdeny ruleそのものを削除せず、例外にのみ影響する**ローカル判定順**を変更する。既存path分類と**JavaScript RegExp**によるpolicy matcherを再利用し、新規汎用ルールエンジンは作らない。例えばC01の許可パターンはテスト用に`^src/safe/.*\.(?:ts|js|py)$`という正規表現文字列を使い、`src/safe/`の単なるprefix一致を「安全」と扱わない。

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

## 4. Google AI Proモデル・Catalog・Fallback（F-004/F-005）

1. **入力取得は今は未実行。** Ownerが別途許可した環境でのみ次を実行する。CLI引数順が異なる版を想定し、**先頭側**の`--output-format`を採用する。

   ```bash
   agy --version
   agy --output-format json models
   ```

   期待する契約: 実際のCLI出力で`status`が成功、`command.data.models`が配列、各モデルIDが**文字列 `command.data.models[].id`**。形式・コマンド失敗・モデル未掲載時は`NOT_VERIFIED`として止める。正規化したModel IDは、出力原本をハッシュ記録したうえで照合する。CLIの版と認証アカウントのPro・非トライアル条件は別に確認する。実API、quota取得、`agy -p`はこのTaskの必要条件にしない。
2. **Catalogは全登録モデルを検証する。** `validateCatalogSemantics`は`pending`を含む**全`models[]`**にCLI inventory上の存在を要求する。したがって不在の旧`claude-opus-4-6-thinking`を`pending`で残す方式は**禁止**。実inventoryにないIDはCatalogから**削除または実在IDへ置換**し、`strategies.fast/deep.preferred_model_id`、各`allowed_fallbacks`を**同じ変更で整合**させる。
3. **更新対象は`enforce`候補Catalogだけ。** `OCR_LLM_MODEL`、`ANTIGRAVITY_MODEL`、`ANTIGRAVITY_FALLBACK_MODEL`のLegacy `off/shadow`既定値や`ocr-engine.yml`を暗黙に置換しない。そこに不在IDが残る場合は**Legacy実行上の残余リスク**としてOwnerに提示し、別途明示承認まで保留。
4. **認定とTierは独立条件。** `capability_tier: fast|deep`は**必要品質を満たしたという証拠ではない**。`certification_status=certified`、ハッシュ一致する`certification_reference`、CLI inventoryに存在すること、`allowed_fallbacks`から参照できること、必要Tier以上であることを**全て**確認する。確認できないPro候補は`pending`、`certification_reference=null`。根拠がないときに`deep`や`certified`を付与しない。
5. **Fallbackの意味:** `fast→fast/deep`、`deep→deep`のみ（いずれも認定済み）。`deep→fast`禁止。既存`isFallbackError`で`rate limit`/`quota`/capacity等の**観測された実行失敗**を扱う。1レビューTaskの通常実行は1モデル、Fallbackは失敗後の限定代替であり、二重レビューや自動品質再レビューをしない。
6. **Enforce HOLD:** 適格・認定済みモデルが1件もない、ID不在、認定index空、CLI binary identity不整合、実効Activationなし、audit不完全なら**Fail Closed**。`off/shadow/enforce`や旧Gateを緩めず、`enforce` READYと記載しない。

## 5. 実装Task（将来のOwner許可後のみ）

### Task 1 — Pro CLI inventoryのREAD_ONLY証拠確定（事前条件、**実装Taskではない**）

**Consumes:** Google AI Pro認証状態（Owner許可下）、CLI/モデル一覧、現行Catalog、認定Index。  
**Produces:** `cli_version`、正常にparseした`command.data.models[].id`集合、ID有無の対照表、`NOT_VERIFIED`の理由、証拠のhash。新規Registry不要。  
**Files to modify:** **なし**（参照のみ: `review-model-catalog.json`、`review-certification-index.json`、`load-review-certification.mjs`、`validate-review-model-catalog.mjs`）。  
**Functions / Interfaces:** CLI出力を読取り、既存CLI inventory証拠契約に照合。実行コマンドは§4.1。  
**RED/GREEN:** 読取り専用証拠取得のため**N/A（テストなし）**。`status`不成功、models欠損・非配列・ID重複・未知形式は未検証。  
**Bounded REFACTOR:** なし。  
**Commit boundary:** なし。  
**STOP / Owner approval:** 現時点ではこのCLIを実行しない。将来実行に明示許可が必要。実際の一覧が得られなければ**モデル変更を停止**し、過去の公開モデル一覧を実inventoryと偽らない。

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

- [ ] **RED 2-1:** `.github/workflows/scripts/classify-pr-review-risk.test.mjs`に§2.3 C01〜C09を追加する。既定空allowlistで普通コードは`deep`、一時fixture allowlistでC01だけ`fast`、高リスク/mixed/不完全は`deep`。期待FAIL: 新enumまたは許可例外が未実装でC01を満たさない。
- [ ] **RED 2-2:** `.github/workflows/scripts/build-decision-state.test.mjs`にC01の15-key射影、厳密enum受理、paths/diff非送信を追加。`.github/workflows/scripts/ocr-routing-audit.test.mjs`に新enumのDecision Record/Auditを追加。期待FAIL: 閉じたenum検証が新値を拒否。
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
- [ ] **Minimum GREEN 2-5:** §2.2の順序でrisk floorを判定し、`fast_code_allow_paths`が空なら従来どおり。新enumだけを内部/外部/監査受理点へ同期する。既存Decision質問の記述だけ更新し、§3の**コードfast例外にだけ**`decisionStatus === 'succeeded' && strategyFor(...) === 'fast'`ガードを追加する。低信頼・HTTP失敗などではコードfastを**deep**に戻す。docs-only/off/shadowは変更しない。
- [ ] **GREEN 2-6 実行（将来のみ）:** **RED 2-4と完全に同一の5ファイルの`node --test`コマンド**。**Expected:** 全PASS、C01〜C11、旧docs-only、既存deep下限、外部データ最小化、監査enum受理がPASS。
- [ ] **Bounded REFACTOR 2-7:** 既存path/policy matcherの重複した条件整理のみ。変更後にGREEN 2-6を1回再実行。新規判定サービス・新規schemaフィールド追加禁止。
- [ ] **Commit boundary 2-8:** `git add`は上記Task 2変更ファイルと対応テストのみ。例: `git commit -m "feat(ocr): gate low-risk code routing with deterministic floor"`。本Taskでは実行しない。

**STOP / Owner approval:** 本書§2のOwner採択がなければTask 2開始禁止。Policy schemaや出力契約がこの確定案と一致しなければ無断で代替方式へ拡張せずOwnerへ報告。変更によるsource-manifest hash差異は既存Activationの再承認対象であり、現行承認を再利用しない。

### Task 3 — 実在ProモデルでCatalog整合・Fallbackを維持

**Consumes:** Task 1の**実inventory**、現行`TrustedReviewModelCatalog/v1`、実際に認定されたモデル根拠。  
**Produces:** `models[]`の全IDがCLI inventoryに存在し、2戦略のpreferred modelと全fallback参照が同一Catalog内で整合した**候補**（認定根拠がなければ`pending`）。  
**Files to modify:** `.github/workflows/config/review-model-catalog.json`（Task 1 verified時のみ）。テスト: `.github/workflows/scripts/validate-review-model-catalog.test.mjs`、`.github/workflows/scripts/select-review-model.test.mjs`、`.github/workflows/scripts/antigravity-host.test.mjs`。**`ocr-engine.yml`/Legacy変数は触らない。**

**Functions / Types / Interfaces:** `validateCatalogSemantics(catalog, evidence)`、`resolveCertifiedModels(catalog, strategy, evidence)`、`runHost({model, fallbackModels, modelCatalog, routingMode:'enforce'})`。新しいHost引数やCatalog schemaは設けない。

- [ ] **RED 3-1:** `validate-review-model-catalog.test.mjs`に`pending`でもCLI inventory不在なら**Catalog全体拒否**、削除した旧IDのpreferred/fallback参照拒否、認定証拠不一致拒否を追加。
- [ ] **RED 3-2:** `select-review-model.test.mjs`に適格認定モデル不在・`fast→deep`許可・`deep→fast`禁止を追加。`antigravity-host.test.mjs`にQuota/容量失敗→認定済み同等以上fallback、空fallback→失敗を追加。**Expected failure:** 追加テストが旧ID残存Catalog/参照不整合を検出すること。既存テストが既に同じケースを保証する場合は重複を追加しない（既存PASSを証拠に記載）。
- [ ] **RED 3-3 実行（将来のみ）:**
  ```bash
  node --test \
    .github/workflows/scripts/validate-review-model-catalog.test.mjs \
    .github/workflows/scripts/select-review-model.test.mjs \
    .github/workflows/scripts/antigravity-host.test.mjs
  ```
  **Expected:** 新規追加された未整合caseはFAIL、重複不要の既存caseは既存仕様どおりPASS。
- [ ] **Minimum GREEN 3-4:** Task 1の認証済みID一覧と一致しないモデルは**未認定であっても**Catalogから削除・置換する。2つの`preferred_model_id`と全`allowed_fallbacks`を更新する。`certification_status`、`certification_reference`、Tierは裏付けなしに昇格させない。使用可能モデルが1件もなければ**Catalog候補の変更を作らずTask停止**（schemaに偽IDを入れない）。
- [ ] **GREEN 3-5 実行（将来のみ）:** **RED 3-3と完全に同一の3ファイルの`node --test`コマンド**。**Expected:** 対象全PASS、どのCatalog modelもinventory外にない、劣格fallbackがない、適格0件で`enforce`はFail Closed。
- [ ] **Bounded REFACTOR 3-6:** 不要。Catalog以外のHost実装やLegacy既定設定を変更しない。
- [ ] **Commit boundary 3-7:** 実際にCatalog差分と対応テストがある場合だけ`git add`し、例: `git commit -m "chore(ocr): align certified route catalog with Pro CLI inventory"`。Task 1未検証ならコミットを作らない。本Taskでは実行しない。

**STOP / Owner approval:** Model Certification未成立、`review-certification-index.json`空、実CLI identity不明のまま`certified`にしない。Catalog変更だけでは`enforce`を有効化しない。Legacy `off/shadow`既定モデルの変更は別途Owner判断。

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

- §2.3 C01〜C12の経路が期待どおり。**初期空allowlistの本番挙動は既存コードdeep下限と同一**。
- `confidence`を新判定に使わず、既存probability/marginとコード例外ガードだけを使う。Decision不達時のコードfastはdeep、docs-only fast/off/shadowは従来どおり。
- State 15 keys、Audit既存キー、既存schema string維持、列挙値同期。raw diff/paths/Secretsの外部漏出なし。
- inventory不在の`pending`モデルもCatalogへ残さない。preferred/fallback参照整合、認定済み・同Tier以上のみ実行。認定0件・適格0件・権限なしは**Fail Closed**。
- 既存OCR Preview/Rule・Markdown追加レビュー・HEAD再検証・attempt audit・公開Gate・Check Runに副作用のある変更なし。
- 実証できないCLIモデル、Quota、認定、Activationは`NOT_VERIFIED`/`NOT_AUTHORIZED`として区別。未実行、証拠不足、観測された失敗を混同しない。

**このR1文書訂正の完了条件:** F-001〜F-006について、本文の限定スコープ内で実装上の選択肢、コマンド、期待結果、停止条件が確定した**文書候補**を作成すること。新規Findingの有無やレビュー再PASSを完了条件にしない。

**Owner checkpoint:** 本書は**未採択**。Human Ownerが§2の限定規範差分を採択し、実装を別途承認するまでは **IMPLEMENTATION HOLD**。CLI inventory取得、モデル認定、Catalog変更、GitHub commit/push、CI実行、外部API呼び出し、`shadow/enforce`起動はいずれも**自動開始禁止**。この文書訂正Taskはここで終了できる。

## 7. Writing-Plans限定補正のDisposition

- R1 Finding F-001〜F-006の対応は維持。今回の文書整形はそれらを再レビューするものではない。
- 現行risk policyの実装はglobではなく`RegExp`。Task 2の条件・Fixtureを実装と揃えた。
- `review-risk-policy.json`に`policy_version`はなく、実際の`policy_version`は`decision-egress-policy.json`由来。計画から存在しないversionの更新指示を削除した。
- 受入Task 4のテストファイルを実在パスで固定した。テストは未実行。
- GitHub上のR1候補はcommit済みだが、Owner採用・Implementation許可は未成立。今回の候補によって権限は変わらない。

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
- R1計画のGitHub HEAD: `4758a9067bc8d9f95eabc408f8a2de5c3a071f20`（今回のローカル置換候補は未commit／未push）。
- Review input: `OCR App — Google AI Pro Dynamic Review Routing / Superpowers Review Gate R1`、F-001〜F-006（このTaskの固定入力）
- OpenCodeReview upstream release（背景、更新作業は範囲外）: https://github.com/alibaba/open-code-review/releases/tag/v1.13.4
- `agy` CLI JSON引数順の注意（review input由来、未再検証）: https://github.com/google-antigravity/antigravity-cli/issues/777
