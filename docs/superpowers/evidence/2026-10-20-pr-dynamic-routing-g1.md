# PR別動的LLMルーティング G1 オフライン証跡

## 状態サマリ

- ブランチ: `feature/pr-dynamic-llm-routing`
- G1 対象コミット: `6ebbf4a816e950621d97361676fa8b52ae85d8c8`
- G1 ステータス: **PASS**
- G2/G3/G4 ステータス: **NOT_STARTED**
- 証跡作成日: 2026-10-20T15:09:18Z

## 基本方針

- `off` 既定維持、`shadow` counterfactual 記録、`enforce` のみ新規ゲート有効
- GitHub への push / merge / PR 作成は人間の明示的な承認後のみ
- 実運用開始（G4）は別途 Owner 承認・Security 承認・能力実証を必要とする

## Preflight 0 ベースライン（Task 1 実施前）

Task 1 実施前に取得済み。

- ベースライン HEAD: `43690cbf9dd46ba236442fcce10267fb9b02f5ba`
- `node --test .github/workflows/scripts/*.test.mjs`: 151/151 PASS
- `(cd cloudflare-worker && npm ci --ignore-scripts && npm test)`: 31/31 PASS
- `actionlint .github/workflows/ocr-engine.yml`: clean
- `GIT_MASTER=1 git diff --check`: clean

## GREEN 1 — 実装後総合検証

実行コマンドと結果:

```bash
npm ci --prefix .github/workflows --ignore-scripts
```
- 結果: exit 0
- 備考: `ajv` など workflow ローカル依存がインストールされた

```bash
node --test .github/workflows/scripts/*.test.mjs
```
- 結果: 308/308 PASS、exit 0
- 対象コミット: `6ebbf4a`
- 備考: `prepare-review-routing.test.mjs` を含む全 workflow scripts の回帰テスト

```bash
(cd cloudflare-worker && npm ci --ignore-scripts && npm test)
```
- 結果: 31/31 PASS、exit 0
- 対象コミット: `6ebbf4a`

```bash
actionlint .github/workflows/ocr-engine.yml
```
- 結果: exit 0

```bash
GIT_MASTER=1 git diff --check
```
- 結果: exit 0

## GREEN 2 — R4 T-001〜T-034 証跡マトリクス

| テストID | 内容 | Plan タスク | 実行コマンド | 対象コミット | 結果 | 備考 |
|---|---|---|---|---|---|---|
| T-001 | NUL 区切り・特殊文字を含むパスを正しくパース | 2,3,9 | `node --test .github/workflows/scripts/ocr-feature-extractor.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-002 | リネーム/削除/コピー/バイナリ/シンボリックリンク/サブモジュール/モードのみをカウント | 2,3,9 | `node --test .github/workflows/scripts/ocr-feature-extractor.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-003 | 不明/不正な Git レコードを拒否 | 2,3,9 | `node --test .github/workflows/scripts/ocr-feature-extractor.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-004 | レビュー対象外ファイルでも完全な features を抽出 | 2,3,9 | `node --test .github/workflows/scripts/ocr-feature-extractor.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-005 | InternalPRFeatures/v3 → DecisionState/v1 厳密投影・追加キー拒否 | 3,5,9 | `node --test .github/workflows/scripts/select-review-model.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-006 | §4.3 と §6.2 の state 例が一致 | 3,5,9 | `node --test .github/workflows/scripts/select-review-model.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-007 | GitHub repo 権限・正確な allowlist | 4,5,9 | `node --test .github/workflows/scripts/check-pr-target.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-008 | 403/404/spoof/stale 拒否・POST0 | 4,5,9 | `node --test .github/workflows/scripts/check-pr-target.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-009 | internal/public/private 分類 | 4,5,9 | `node --test .github/workflows/scripts/check-pr-target.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-010 | Decisions API と決定論的フォールバック・有償リトライなし | 5,6,9 | `node --test .github/workflows/scripts/mercury-decide.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-011 | fallback tri-state（不在/[]/配列/null/undefined） | 1,7,8,9 | `node --test .github/workflows/scripts/antigravity-host.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-012 | observer イベント・時系列・試行記録 | 7,8,9 | `node --test .github/workflows/scripts/antigravity-host.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-013 | モデル証拠・認定カタログ照合 | 1,6,8,9 | `node --test .github/workflows/scripts/select-review-model.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-014 | OCR Review JSON スキーマ不変 | 7,9 | `node --test .github/workflows/scripts/antigravity-host.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-015 | seal/upload/publish・legacy 回帰 | 8,9,10 | `node --test .github/workflows/scripts/ocr-routing-audit.test.mjs .github/workflows/scripts/evaluate-routing-publish.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-016 | YAML モード分岐・off 既存挙動維持 | 9,10 | `node --test .github/workflows/scripts/antigravity-policy.test.mjs .github/workflows/scripts/ocr-routing-workflow.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-017 | Node + Worker + actionlint 総合 | 10 | 本文書 GREEN 1 参照 | `6ebbf4a` | PASS | exit 0 |
| T-018 | shadow 3 ファイル best-effort 監査 | 8,9,10 | `node --test .github/workflows/scripts/ocr-routing-workflow.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-019 | 認定カタログスキーマ・digest-backed 証拠 | 1,6,9,10 | `node --test .github/workflows/scripts/select-review-model.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-020 | Owner 承認プレースホルダー・認定モデル実証未完了 | 1,4,9,10 | カタログは pending 例のまま；認定済みモデルは別途 Owner 承認・実証を要する | `6ebbf4a` | NOT_RUN | G0-D05/D07 Owner 未決裁のため |
| T-021 | 欠落 Artifact | 8,9,10 | `node --test .github/workflows/scripts/evaluate-routing-publish.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-022 | 誤った run attempt | 8,9,10 | `node --test .github/workflows/scripts/ocr-routing-audit.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-023 | 繰り返し HEAD 照合 | 8,9,10 | `node --test .github/workflows/scripts/ocr-routing-workflow.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-024 | ゲート失敗時の PR 書込み 0 | 8,9,10 | `node --test .github/workflows/scripts/ocr-routing-workflow.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-025 | RG-R1-001 authority / Plan created | Preflight,1,4,8-9 | 基本方針承認は会話で取得；運用承認は未実施 | `6ebbf4a` | PASS (policy) | G0-D01〜D07 BASIC_POLICY_APPROVED |
| T-026 | RG-R1-002 routing order and secrets | 2-6,8-9 | `node --test .github/workflows/scripts/ocr-routing-workflow.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-027 | RG-R1-003 thread/HEAD | 9 | `node --test .github/workflows/scripts/ocr-routing-workflow.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-028 | RG-R1-004 shadow evidence | 6-9 | `node --test .github/workflows/scripts/ocr-routing-workflow.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-029 | RG-R1-005 progress and Check confidentiality | 7,9 | `node --test .github/workflows/scripts/update-check-run.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-030 | RG-R1-006 baseline timing | Preflight,1,10 | Preflight 0 記録あり | `43690cbf` vs `6ebbf4a` | PASS | 差分は workflow deps 追加と routing gate 追加のみ |
| T-031 | RG-R2-001 canonical run binding | 4-5,6,8-9 | `node --test .github/workflows/scripts/ocr-run-binding.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-032 | RG-R2-001 run-bound POST0/spawn0/publish false | 4-5,6,8-9 | `node --test .github/workflows/scripts/ocr-routing-workflow.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-033 | RG-R2-001 保存 route の厳密投影 | 4,9 | `node --test .github/workflows/scripts/prepare-review-routing.test.mjs` | `6ebbf4a` | PASS | exit 0 |
| T-034 | RG-R2-001 Host 前の照合・spawn 0 | 9 | `node --test .github/workflows/scripts/ocr-routing-workflow.test.mjs` | `6ebbf4a` | PASS | exit 0 |

## 制約・承認状態

- `off` 既定維持、`shadow` counterfactual、`enforce` のみ新規ゲート有効
- GitHub への push / merge / PR 作成は人間の明示的な承認・確認後のみ
- G0 基本方針承認は取得済み；per-repo egress grant、モデル認定、監査運用手順は **PENDING**
- 実運用開始（G4）は **NOT_STARTED**

## 参考ファイル

- Plan: `docs/superpowers/plans/2026-10-20-pr-dynamic-llm-routing.md`
- Design: `docs/superpowers/specs/2026-10-20-pr-dynamic-llm-routing-design.md`
- Ledger: `.superpowers/sdd/2026-10-20-pr-dynamic-llm-routing/progress.md`
