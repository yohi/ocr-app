# Dynamic Review Routing — enforce 観察記録

## 目的

- Issue #111 の review routing について、mode `enforce` への切替後に 1 次の実行観察を行い、次を確認する。
  - `Authorize routing start` が enforce activation（7 approval_refs）で AUTHORIZED 運用になること
  - `Evaluate routing publish eligibility` が正規に authorized となり、run conclusion が緑化すること
  - routing 起点の `Publish enforce review` が実行されること（fail closed でないこと）
- 本 PR は観察用のトリガー車輌であり、観察完了後にクローズする（マージ不要）。

## 前提（実施済み）

- shadow 観察は完了（run `42030419108`、audit 密封済み、fail closed 確認）。
- enforce activation の registry 登録は PR #119 で行う（本 PR 作成時点では未マージ）。
- repo Variable `DECISION_ROUTING_MODE` はマージ後に `shadow` から `enforce` へ切替する。

## 観察手順（Owner 操作後に実行）

1. PR #119 をマージする。
2. repo Variable `DECISION_ROUTING_MODE` を `enforce` に設定する。
3. 本 PR に mention コメントでトリガーし、engine run を観察する。
4. run の step 結果・check run・audit artifact を確認して本書に結果を追記する。

## 期待結果

- `evaluateRoutingStartup(mode=enforce)` に対応する runtime 認可が success。
- publish gate が authorized となり、run conclusion が success。
- `decision_status` / `egress_status` が shadow 時の `not_requested` / `denied` から実運用の値へ遷移。

## 既知事項

- shadow run では `Evaluate routing publish eligibility` step の step env 直参照により run conclusion が赤化する外観上の挙動を確認済み。enforce では publish gate が正規に走るため解消される見込み。
- `.github/workflows/scripts/*` および manifest 固定 8 ファイルを変更した場合、g1〜g4 approval と dossier の再発行が必要。
