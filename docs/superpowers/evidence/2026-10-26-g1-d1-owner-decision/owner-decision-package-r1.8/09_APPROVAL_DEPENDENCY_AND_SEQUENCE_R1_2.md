# 09. 承認依存関係と判断順序（Approval Dependency & Sequence R1.2）

## 1. 意思決定の依存関係と判断フェーズ

全7項目（DEC-01〜07、01A/01B分割により全8項目）は、相互の前提条件および再試験の進行状況に応じて依存関係を持ちます。

```text
[Phase 1: 初期判断候補]
  ├── DEC-01A (キャッシュインベントリ検査) ─────────┐
  ├── DEC-02  (独立ローカルGit環境配備)             │
  ├── DEC-03  (再試験実行権限・リソース枠: 方式A)   │ (01A完了・不足確定)
  └── DEC-04  (全体回帰範囲・Gate基準合意)         ▼
                                            [Phase 2: 条件成立後の判断候補]
                                              ├── DEC-01B (不足依存限定転送)
                                              ├── DEC-05  (Group B 診断実験 ※Primary失敗時)
                                              ├── DEC-06  (Group C 診断実験 ※Primary失敗時)
                                              └── DEC-07  (STOP後の個別再開 ※STOP発生時)
```

### 1.1 初期判断候補（Phase 1: 即時判断可能）
- **DEC-01A**: 承認対象パス限定の読み取り専用調査のため、即時 APPROVE 可能。
- **DEC-02**: 独立Git配備のオブジェクト検証仕様が確定しており、Stage 3 の前提として即時 APPROVE 可能。
- **DEC-03**: リソース上限候補枠および Stage 0（受入）の単一実行について、方式A（1 Record = 1 Stage）で即時 APPROVE 可能。
- **DEC-04**: 全39ファイルの独立静的照合が完了しており、審査基準として即時 APPROVE 可能。

### 1.2 条件成立後の判断候補（Phase 2: 前提成立まで保留）
- **DEC-01B**: DEC-01A による不足集合マニフェストが提出されるまで **HOLD**。
- **DEC-05**: Stage 3 Primary 再試験が実施され、失敗原因の切り分けが必要になるまで **HOLD**。
- **DEC-06**: Stage 4 Primary 再試験が実施され、タイムアウト・非同期挙動のトレースが得られるまで **HOLD**。
- **DEC-07**: 試験中に STOP が発生し、Phase A 承認前条件（9条件）が充足された報告書が提出されるまで **HOLD**。

---

## 2. 再試験計画 R1.3 の規範的 DAG と各 DEC のマッピング

R1.3 で確定された規範的 Stage DAG（7エッジ）は厳格に維持されます。

```text
Stage 0 -> Stage 1
Stage 1 -> Stage 2
Stage 0 -> Stage 3
Stage 0 -> Stage 4
Stage 2 -> Stage 5
Stage 3 -> Stage 5
Stage 4 -> Stage 5
```

### 2.1 Stage と 意思決定項目の対応関係（Method A: 1 Record = 1 Stage 整合）

| Stage | 名称 | 必須 Owner 意思決定記録 | 進入前提条件 | 実行許可操作 |
| :--- | :--- | :--- | :--- | :--- |
| **Stage 0** | **環境受入再確認** | **DEC-03 (Stage 0 単一指定記録)** | VM起動済み、固定HEADチェックアウト | 単一実行、テスト実行なし、環境検証のみ |
| **Stage 1** | **オフライン依存補完** | **DEC-01A, 01B, DEC-03 (Stage 1 単一指定記録)** | Stage 0 PASS | キャッシュ配置、`npm ci --offline --ignore-scripts` 検証 |
| **Stage 2** | **Group A 限定再試験** | **DEC-03 (Stage 2 単一指定記録)** | Stage 1 PASS | 並列度1での順次実行、Group A 対象ファイルのみ |
| **Stage 3** | **Group B 限定再試験** | **DEC-02, DEC-03 (Stage 3 単一指定記録)**<br>*(失敗時のみ DEC-05)* | Stage 0 PASS<br>(Stage 1/2 とは独立) | 並列度1での実行、`authorize-routing-start.test.mjs` |
| **Stage 4** | **Group C 限定再試験** | **DEC-03 (Stage 4 単一指定記録)**<br>*(失敗時のみ DEC-06)* | Stage 0 PASS<br>(Stage 1/2 とは独立) | 並列度1での実行、`authorize-decision-egress.test.mjs` |
| **Stage 5** | **全体回帰確認** | **DEC-04, DEC-03 (Stage 5 単一指定記録)** | **Stage 2, 3, 4 すべてが PASS** | 並列度1での順次実行 (`--test-concurrency=1`)、全39ファイル |

---

## 3. 独立経路と逐次実行の原則

- **独立経路の存在**:
  - DAG 上、`Stage 1 -> Stage 2` 系統と、`Stage 3`、`Stage 4` の3系統は論理的に独立しています。
- **同時実行（並行実行）の禁止**:
  - **DAG 上の経路独立性は、複数 Stage の同時並行実行を許可することを意味しません。**
  - 不測のリソース競合、ログの交錯、予期せぬ環境破壊を排除するため、すべての Stage は**1つずつ逐次的に実行**されなければなりません。
- **テストファイル並列度**:
  - 各 Stage 実行時、Node.js CLI テストランナーのファイル並列度は `--test-concurrency=1` に固定されます。

---

## 4. STOP 再開条件の非循環アーキテクチャ

STOP 発生時の再開フローは、以下の非循環な 3 段階によって制御されます：
1. **Phase A (Pre-approval)**: STOP 原因特定、ログ保全、修復文書化、HEAD整合、隔離境界、cgroup制限等の事前検証。
2. **Phase B (Owner Decision)**: Human Owner による明示的判断（DEC-07 署名・個別判断記録発行）。
3. **Phase C (Post-approval Eligibility)**: 再実行直前の実行資格判定（真正性、Stage一致、回数上限、条件充足確認）。
