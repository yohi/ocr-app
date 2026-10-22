# PR別動的LLMルーティング G1 オフライン証跡（2026-10-21 是正版）

## 状態サマリ

- ブランチ: `2026-10-21-pr-dynamic-routing-remediation`
- G1 対象コミット: `5564145fdd4ffcef57de8f109771fe3ca1817540`
- G1 ステータス: **PASS（offline 総合）**
- G2/G3/G4 ステータス: **NOT_RUN / NOT_GRANTED**
- 証跡作成日: 2026-10-21T00:00:00Z（Asia/Tokyo）
- 実行者: 自動化エージェント（Sisyphus / OpenCode）
- 独立性: ローカル検証証跡。Owner による独立レビュー・承認は別途必要。

## 前提と制約

- `off` 既定維持、`shadow` counterfactual 記録、`enforce` のみ新規ゲート有効。
- GitHub への push / merge / PR 作成は人間の明示的な承認後のみ。
- 実運用開始（G4）は別途 Owner 承認・Security 承認・能力実証を必要とする。
- 本証跡はオフライン検証（Node test、Worker test、actionlint、diff check、traceability）のみ。Decision/model/API 実ランタイムチェックは含まない。

## Preflight 0 ベースライン

- ベースライン HEAD: `7851be47c15c8b55faa473a9ae8f4806e0694d45`
- ベースラインの workflow tests: 一部失敗（当該計画で修正対象）

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

- 結果: 443/443 PASS、exit 0
- 対象コミット: `5564145fdd4ffcef57de8f109771fe3ca1817540`
- 備考: `prepare-review-routing.test.mjs`、`run-routing-review.test.mjs`、
  `routing-remediation.integration.test.mjs`、`routing-traceability.test.mjs`
  等を含む全 workflow scripts の回帰テスト

```bash
npm ci --prefix cloudflare-worker --ignore-scripts
npm test --prefix cloudflare-worker
```

- 結果: 31/31 PASS、exit 0
- 対象コミット: `5564145fdd4ffcef57de8f109771fe3ca1817540`

```bash
actionlint .github/workflows/ocr-engine.yml
```

- 結果: exit 0

```bash
git diff --check
```

- 結果: exit 0

## GREEN 2 — コードマニフェスト不変性

検証対象の tracked source files の SHA-256 マニフェストダイジェスト:

```text
343c873b1874f5bc44d393ab6e260f45b4173cf5556023e61082ea2b9ce17b7c
```

上記は検証完了時点の clean worktree における全 tracked file の
SHA-256 マニフェストダイジェスト。実行コマンドはすべて読み取り専用であり、
検証中にソースは変更されていない。

## GREEN 3 — R4 T-001〜T-034 証跡マトリクス

設計 T-ID と実装・テストの対応は `.github/workflows/config/routing-traceability.json` に記録。
traceability テストは以下を検証済み:

- T-001〜T-034、REM-001〜REM-005 の ID セットが設計と一致
- `design_sha256` が設計ファイルの実ダイジェストと一致
- 各 COVERED assertion が実在するテストファイル・テスト名に紐付く
- 各 mapped test name を exact name で実行し pass/fail カウントを確認
- runtime scope のエントリは `NOT_RUN`
- synthetic fixture のみのエントリは `PARTIAL` + limitation

詳細は `.github/workflows/config/routing-traceability.json` および
`.github/workflows/scripts/routing-traceability.test.mjs` を参照。

## 環境情報

- Node.js: v26.10.0
- npm: v10.9.2
- actionlint: 最新版（実行時に取得）
- markdownlint-cli2: v0.24.0
- OS: linux

## ログとハッシュ

検証ログは `docs/superpowers/evidence/2026-10-21-pr-dynamic-routing-g1/` に配置。
各ログファイルの SHA-256 は
`docs/superpowers/evidence/2026-10-21-pr-dynamic-routing-g1/log-manifest.sha256`
に記録。

- `npm-ci-workflow.log`
- `node-test-workflow.log`
- `npm-ci-worker.log`
- `npm-test-worker.log`
- `actionlint.log`
- `git-diff-check.log`
- `node-test-traceability.log`
- `markdownlint-new.log`

## 制約・承認状態

- `off` 既定維持、`shadow` counterfactual、`enforce` のみ新規ゲート有効
- GitHub への push / merge / PR 作成は人間の明示的な承認・確認後のみ
- G0 基本方針承認は取得済み（計画承認時）; per-repo egress grant、モデル認定、監査運用手順は **PENDING**
- 実運用開始（G4）は **NOT_STARTED**

## 参考ファイル

- 本証跡: `docs/superpowers/evidence/2026-10-21-pr-dynamic-routing-g1.md`
- ログ・ハッシュ: `docs/superpowers/evidence/2026-10-21-pr-dynamic-routing-g1/`
- 旧証跡（是正対象）: `docs/superpowers/evidence/2026-10-20-pr-dynamic-routing-g1.md`
- 計画: `docs/superpowers/plans/2026-10-21-pr-dynamic-routing-remediation.md`
- 設計: `docs/superpowers/specs/2026-10-20-pr-dynamic-llm-routing-design.md`
- 追跡性マトリクス: `.github/workflows/config/routing-traceability.json`
- Ledger: `.superpowers/sdd/2026-10-21-pr-dynamic-routing-remediation/progress.md`
