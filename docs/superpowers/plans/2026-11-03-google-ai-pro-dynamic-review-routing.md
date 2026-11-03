# OCR App — Google AI Pro Dynamic Code Review Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Human Owner's anti-review-loop policy overrides any automatic reviewer dispatch: do not start any implementation, review, GitHub write, activation, or follow-on task without explicit authorization for that action.**

**Goal:** OCR Appの既存OpenCodeReview Delegation + Antigravity CLIによるコードレビューで、要求精度を維持し、Google AI Proのモデル利用枠を高リスクPRへ優先配分する。

**Architecture:** 既存の`fast`/`deep`リスク下限、Mercury Decideによる助言、認定済みモデルカタログ、Antigravity Hostの1モデル選択・品質を下げないFallbackを再利用する。信頼済みポリシーが限定許可した低リスクのコード変更だけを`fast`候補に加える。枠情報が確実に得られない場合は予測システムを作らず、既存の実行エラー検知とFallbackを用い、適格モデルがなければレビューを不成立にする。

**Tech Stack:** GitHub Actions / Node.js 20 ESM / `node:test` / OpenCodeReview Delegation (`ocr`) / Antigravity CLI (`agy`) / OpenRouter Decisions API（現行Mercury Decide）/ GitHub App / Cloudflare Worker。

**Spec:** `docs/superpowers/specs/2026-10-20-pr-dynamic-llm-routing-design.md`（既存R4設計の参照元）と、2026-11-03のHuman Owner承認済み最小差分設計R0。本計画は後者を優先する**候補**であり、既存のGate／実行権限を置換しない。

**Baseline:** `yohi/ocr-app`, `master` commit `49cd3978d638b0236d1d396ca1c101cac04e2726`。実装開始前にはHEADを読み直し、差分のある対象だけ再確認する。

## Global Constraints

- **Google AI Pro前提。** ただし非トライアル契約かどうか、実際のモデル一覧、残Quotaは未検証。公式Proモデル表ではGemini 4 Argon、Gemini 3.8 Flash、Claude Sonnet/Opus 5.5（Claude 5.5は有料・非トライアル限定）が候補。実際のCLI `model_id` は認証済み `agy models --output-format json` で確定する。
- **1レビューTaskにつき1レビューLLMモデルを基本**とする。容量エラーによる適格モデルへの再実行は許すが、アンサンブルや品質比較のための二重レビューはしない。
- レビュー精度最優先。重大・未知・不完全・スコープギャップのある変更は勝手に`fast`へ下げない。Decision応答はadvisoryのみ。
- 認定証拠がないモデルを`certified`に変更しない。モデル名、製品Tier、利用可能性は精度認定を意味しない。
- 認定モデルや実効権限が不足すれば**Fail Closed**。成功・PASS・レビュー完了を偽装しない。既存の失敗通知／Check Runを用い、新しいPending状態機械は作らない。
- `off`/`shadow`/`enforce`を維持。`enforce`の有効化、承認Registry編集、Secret、OAuth、外部送信Allowlist、CI実行、PRコメント投稿は今回の文書作成では許可しない。
- 新規ベンチマーク基盤、過去PR全件評価サービス、Quota予測デーモン、複数モデル照合、新規Registry、無制限Retryは作らない。AI Creditsの自動超過課金設定も変更しない。
- Markdownの`include`はOCR標準フィルタの既定除外を上書きするもので、コードレビューのホワイトリストではない。既存の`ocr delegate preview/rule`とMarkdown追加設定を変更しない。

## Current Code and Boundaries

| Responsibility | Existing file | Planned handling |
|---|---|---|
| GitHub Actions | `.github/workflows/ocr-engine.yml` | 現行のトリガー・Gateを維持。モデルIDを確定した後に古い既定Fallbackの扱いのみ限定検討 |
| OCR対象選別 | `.github/workflows/scripts/prepare-ocr-review-context.mjs` | 変更しない |
| 安全リスク分類 | `.github/workflows/scripts/classify-pr-review-risk.mjs` | 限定的な低リスクコード許可条件を追加 |
| 安全ポリシー | `.github/workflows/config/review-risk-policy.json` | `fast_code_allow_paths`など、明示的な空初期値を導入する場合に限定変更 |
| Decision状態 | `.github/workflows/scripts/build-decision-state.mjs` | 新たな分類値が不可欠なら既存列挙値を同期（後述）。不必要なフィールドを増やさない |
| Decision API | `.github/workflows/scripts/decision-provider.mjs` | `fast`が「文書のみ」という条件文を低リスク認定コードにも対応させる |
| モデル選択 | `.github/workflows/scripts/select-review-model.mjs` | 原則再利用。最低Tier・confidence/margin不確実時deep維持 |
| モデルカタログ | `.github/workflows/config/review-model-catalog.json` | 実在するProモデルIDに更新する候補。ただし未認定は`pending`維持 |
| 監査 | `.github/workflows/scripts/ocr-routing-audit.mjs` | 新分類値が必要なときのみ列挙を同期。記録形式の拡張はしない |
| Host/Fallback | `.github/workflows/scripts/antigravity-host.mjs` | 既存の同等以上TierでのFallbackと監査を再利用 |
| 認定 | `.github/workflows/config/review-certification-index.json` | Owner認定までは空維持。単なるモデル掲載を認定にしない |

## Review Focus (one bounded self-check, not an extra review task)

1. 未認定モデル、偽のCLIモデルID、CLI inventory不明 → `enforce`実行前に失敗する。
2. セキュリティ・認証・migration・CI・未知状態・rename・binary・mode変更・scope gap → `deep`下限を維持する。
3. Decision APIの`fast`助言がローカル下限`deep`に反する → 降格せず`deep`。
4. 主モデルのQuota不足でFallbackを試すとき → 認定済み・同等以上のTierのみに限定し、他は失敗してレビューを公開しない。
5. Model/Quota取得不可、認証失敗、モデル廃止 → 利用可能・品質認定済みと誤認しない。Secret・生エラー・差分を監査に漏らさない。

---

### Task 1: Google AI Pro対応モデルの入力を確定する（READ_ONLY準備）

**Files:** 既存参照 `.github/workflows/config/review-model-catalog.json`, `.github/workflows/config/review-certification-index.json`, `.github/workflows/scripts/load-review-certification.mjs`, `.github/workflows/scripts/validate-review-model-catalog.mjs`; 本Taskでコード編集なし。

**Interfaces:** `agy models --output-format json`が認証済みCLIから返す`model_id`と、既存認定・CLI inventory証拠を照合する。`agy -p '/quota' --output-format json`は読取り専用の参考情報とし、安定したJSON構造を確認するまでルーティングの必須入力にしない。

- [ ] Step 1: Human Ownerが許可した環境で `agy --version` と `agy models --output-format json` を実行し、CLIバージョン、JSON、モデルslugを**秘密情報なしで**保存する。現チャットでは実行しない。
- [ ] Step 2: 実一覧と公式Pro候補（Gemini 3.8 Flash、Gemini 4 Argon、Claude 5.5系）を照合し、存在しない旧 `claude-opus-4-6-thinking` を利用可能と仮定しない。非トライアル契約の必要条件を区別する。
- [ ] Step 3: 既存認定根拠の有無を照合する。未認定なら`pending`維持。モデルの性能序列・Fallback適格性を**名前から自動決定しない**。
- [ ] Step 4: 入力が不十分ならModel Certificationを保留し、`off`/`shadow`を無断で変更しない。これは後続設計の証拠不足として記録するだけで、独立レビューTaskを増やさない。

**Acceptance:** Pro契約向けの候補モデルIDの由来と認定状態が分離されている。実アカウントの一覧が取れない場合は未確認と明記する。

### Task 2: 認定済み低リスクコードだけにfast候補を許す

**Files:**
- Modify: `.github/workflows/config/review-risk-policy.json`
- Modify: `.github/workflows/scripts/classify-pr-review-risk.mjs`
- Modify: `.github/workflows/scripts/build-decision-state.mjs`（分類値追加時）
- Modify: `.github/workflows/scripts/ocr-routing-audit.mjs`（分類値追加時）
- Modify: `.github/workflows/scripts/decision-provider.mjs`（fast候補の意味を一致させる）
- Test: 対応する既存 `.test.mjs` ファイル

**Interfaces:** `classifyPRRisk(features, trustedRiskPolicy) -> {...features, classification_status, risk_floor}`。既存`InternalPRFeatures/v3`、`DecisionState/v1`、`fast/deep`、`selectReviewRoute`を維持する。

**Design decision:** 新規ファイルの作成なし。既存の`allowlisted_docs_only`をコードに流用せず、必要なら意味が正しい`allowlisted_low_risk_code`分類値を既存の内部／外部状態・監査列挙に同期する。信頼済みポリシーのコードパス許可リストは**既定で空**とし、許可候補が承認・根拠確認されるまでコードは`deep`。

- [ ] Step 1 (RED): `classify-pr-review-risk.test.mjs`に、明示許可した通常のコードファイルにのみ`fast`候補を返す例を追加。混在PR・auth/secret・CI・rename・binary・mode変更・未知/不完全・scope gapは`deep`を検証する。
- [ ] Step 2 (RED): `build-decision-state.test.mjs`（該当する既存テスト）、`ocr-routing-audit.test.mjs`に分類列挙の整合性を確認するケースを追加。既存の`docs-only fast`ケースは維持。
- [ ] Step 3: `node --test .github/workflows/scripts/classify-pr-review-risk.test.mjs .github/workflows/scripts/select-review-model.test.mjs` を実行し、追加テストの期待どおりの失敗を確認する（実行には別途Owner許可が必要）。
- [ ] Step 4 (GREEN): 例外条件を決定的に判定し、分類・risk_floor・監査値を整合させる**最小限の変更**のみ実装する。`decision-provider.mjs`のtrusted `criteria.fast`を低リスク認定コードにも対応させ、Decision APIの送信内容は従来のバケット化メタデータに限定する。
- [ ] Step 5: 変更した関連テストを`node --test ...`で実行しPASSを確認する。既存の`deep`下限を一件も黙示降格させない。

**Acceptance:** 既定（許可リスト空）では今までどおり通常コードは`deep`。明示的・安全条件の揃ったコードだけを`fast`候補とする。`fast`の実行には別途Model Certificationが必要であり、本Taskだけで実行可能とはしない。

### Task 3: Proモデルカタログと能力を下げないFallbackを整合する

**Files:**
- Modify: `.github/workflows/config/review-model-catalog.json`（実モデルIDを確定した場合のみ）
- Possibly modify: `.github/workflows/ocr-engine.yml`（実際に廃止された既定Fallbackの参照を置き換える必要がある場合のみ）
- Test: `.github/workflows/scripts/validate-review-model-catalog.test.mjs`, `select-review-model.test.mjs`, `antigravity-host.test.mjs`、既存Workflow関連テスト

**Interfaces:** 既存Catalog schema v1と`resolveCertifiedModels(catalog, strategy, evidence)`を利用。`runHost({ model, fallbackModels, modelCatalog, routingMode: 'enforce' })`を維持。

- [ ] Step 1 (RED): 認定済みでないProモデル、CLI inventoryにないモデル、劣格Fallback、空Fallback時に主モデル容量エラーが起きた場合に、適切にFail Closedになる既存テストを確認し、必要な不足テストだけ追加。
- [ ] Step 2: Task 1で実証された**正確なslug**だけをCatalog候補にする。実証されないモデルは加えない。ステータスは認定根拠がなければ`pending`、既存`certification_reference`を捏造しない。
- [ ] Step 3: 既存の高性能主モデル/代替モデルは、精度Tierの根拠が揃う場合だけ並べる。`fast → deep`へFallbackは許可できるが、`deep → fast`は絶対に許可しない。
- [ ] Step 4: Quota・容量不足は既存の `isFallbackError` / attempts audit を利用。データが得られたからといって独立したQuota監視・予測サービスを追加しない。Fallbackが1回失敗した場合に再レビューを連鎖させない。
- [ ] Step 5: `node --test .github/workflows/scripts/validate-review-model-catalog.test.mjs .github/workflows/scripts/select-review-model.test.mjs .github/workflows/scripts/antigravity-host.test.mjs`を実行してPASS。実モデルでの有償/枠消費テストを自動起動しない。

**Acceptance:** Proモデル候補の出典と実際の`agy`認識名が一致する。品質根拠のないモデルは選択されず、適格モデルがないとレビューが未完了になる。

### Task 4: 限定静的/オフライン受入とHuman Owner判断

**Files:** 変更した既存ファイルのみ。新たな文書管理シリーズを作成しない。

- [ ] Step 1: 許可された範囲のNodeテストを一度実施し、`npm ci`等の副作用を含む実行は個別に承認された環境でのみ実施する。
- [ ] Step 2: 受入ケースを確認：通常の低リスクコード（条件付きfast）、高リスク/不明コード（deep）、Decision不達（ローカルfloor）、Deep不足で適格Fallbackあり、Fallbackなし・quota exhausted、レビュー対象0件、認定/Activation未成立。
- [ ] Step 3: テスト結果を「実際にPASS」「未実行」「証拠不足」「観測FAIL」に分けて1回報告する。重要な未解決の権限・データ保全問題はFail Closed。Minor Findingのみを理由にループを作らない。
- [ ] Step 4: **Human Owner checkpoint**。修正候補の採用・GitHub commit/push・`shadow`/`enforce`起動・外部送信・有償テストは各々別の明示承認を受ける。承認なしでは停止。

**Definition of Done for this planning task:** 実装者が必要なファイル、制約、最小テストを把握し、実アカウントのモデル一覧と認定が未確認なことを理解できる。本ファイルの作成で実装や有効化が承認されたことにはならない。

## Known limitations and stop conditions

- `agy models`は利用可能なモデル名の情報源であり、レビュー品質の認定証拠ではない。Quota情報の取得に失敗した場合にも、存在しない枠を推測しない。
- Google AI Proには5時間単位の回復と週次上限がある。ユーザーの具体的な残枠は未取得。自動超過課金は想定しないが、実際の既存アカウント設定は未確認。
- 現行の`routing-authorization.json`はApproval/Activation空、`review-certification-index.json`も空、モデルはpending。従って**いま`enforce`を起動してよいという判断には到達していない**。
- Source of truthは実アカウントの`agy`出力とOwner認定証拠。公開表のみを根拠にモデルIDを断定しない。
- OpenCodeReview本体v1.13.1→v1.13.4は独立した互換性更新候補であり、本計画の前提作業として自動追加しない。

## References

- Repo: https://github.com/yohi/ocr-app/tree/49cd3978d638b0236d1d396ca1c101cac04e2726
- Existing design: https://github.com/yohi/ocr-app/blob/49cd3978d638b0236d1d396ca1c101cac04e2726/docs/superpowers/specs/2026-10-20-pr-dynamic-llm-routing-design.md
- Google Antigravity Models: https://antigravity.google/docs/models
- Google Antigravity CLI Headless: https://antigravity.google/docs/cli/headless/
- Google Antigravity Plans: https://www.antigravity.google/docs/plans
- Alibaba OpenCodeReview v1.13.4: https://github.com/alibaba/open-code-review/releases/tag/v1.13.4
