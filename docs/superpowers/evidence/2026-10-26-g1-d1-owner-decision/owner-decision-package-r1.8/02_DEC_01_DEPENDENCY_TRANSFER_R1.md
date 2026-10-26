# 02. DEC-01 — オフライン依存補完（DEC-01A / DEC-01B / DEC-03 Stage 1 権限分離判断資料 R1）

## 1. Decision Summary

### 1.1 判断する内容
G1-D1 テストVMにおける外部依存パッケージの不足（`ERR_MODULE_NOT_FOUND: 'ajv'` および `npm ci --offline` 時の `ENOTCACHED`）を安全に解消するため、以下の3つの操作権限を厳格に分離して判断します（FND-ODP-002是正）。

1. **DEC-01A: 事前インベントリ検査（読み取り専用調査）**
2. **DEC-01B: 不足パッケージ限定転送（内容アドレス特定・完全性照合転送）**
3. **DEC-03 Stage 1: 承認済みオフライン依存インストール（`npm ci --offline --ignore-scripts` 実行）**

### 1.2 規範的権限境界と承認順序
- **`DEC-01A APPROVED` は DEC-01B の承認を意味しません。**
- **`DEC-01B APPROVED` は Stage 1（`npm ci`）実行の承認を意味しません。**
- **`DEC-03 Stage 1 APPROVED` のみでは、未承認のパッケージ転送を許可しません。**

```text
[DEC-01A: インベントリ調査承認] ──▶ (調査実施: 不足集合・SHA-512確定)
                                           │
[DEC-01B: 限定転送承認] ◀──────────────────┘
     │
     ▼ (転送実施: VM内ハッシュ再検証完了)
[DEC-03 Stage 1 実行承認] ──▶ (`npm ci --offline --ignore-scripts` 実行)
```

### 1.3 実施する必要性
- Stage 2（Group A 10件の再試験）を実行するためには、`package-lock.json` に定義されたロック済み依存関係がローカル環境に存在する必要があります。
- 現在のテストVM内では `require-from-string@2.0.2` の欠落が一次ログ（`raw_logs/05_npm_ci_enotcached.log`）で確認されており、このままでは依存関係が解決しません。

### 1.4 推奨判断
- **DEC-01A**: **`APPROVE`** を推奨。読み取り専用調査であり、不足集合を特定するために不可欠であるため。
- **DEC-01B**: 現時点では **`HOLD`**（保留）を推奨。DEC-01A の結果（不足集合マニフェスト案）が提出・照合されるまで転送対象が未確定であるため。

---

## 2. 確認済み事実と未検証事項

### 2.1 ロックファイルに基づく全5パッケージの確定状態

| パッケージ名 | バージョン | 完全性ハッシュ (SHA-512) | 依存要件区分 | 一次実測キャッシュ状態 |
| :--- | :--- | :--- | :--- | :--- |
| `require-from-string` | `2.0.2` | `sha512-Xf0nWe6RseziFMu+Ap9biiUbmplq6S9/p+7w7YXP/JBHhrUDDUhwa+vANyubuqfZWTveU//DYVGsDG7RKL/vEw==` | `LOCKED_DEPENDENCY_REQUIRED` | **`CACHE_MISSING_CONFIRMED`** (実測確定) |
| `ajv` | `8.17.1` | `sha512-B/gBuNg5SiMTrPkC+A2+cW0RszwxYmn6VYxB/inlBStS5nx6xHIt/ehKRhIMhqusl7a8LjQoZnjCs5vhwxOQ1g==` | `LOCKED_DEPENDENCY_REQUIRED` | **`CACHE_STATUS_UNVERIFIED`** (未検証) |
| `fast-deep-equal` | `3.1.3` | `sha512-f3qQ9oQy9j2AhBe/H9VC91wLmKBCCU/gDOnKNAYG5hswO7BLKj09Hc5HYNz9cGI++xlpDCIgDaitVs03ATR84Q==` | `LOCKED_DEPENDENCY_REQUIRED` | **`CACHE_STATUS_UNVERIFIED`** (未検証) |
| `fast-uri` | `3.1.9` | `sha512-hS/0Wt3Ya043oKXs0sIxrMpKQITXhMLIrVAKKXi4gozGC9v7YRWVnXIZzjNPTO02M9BdxLCWqK1yRXgNziVyJQ==` | `LOCKED_DEPENDENCY_REQUIRED` | **`CACHE_STATUS_UNVERIFIED`** (未検証) |
| `json-schema-traverse`| `1.0.0` | `sha512-NM8/P9n3XjXhIZn1lLhkFaACTOURQXjWhV4BA/RnOv8xvgqtqpAX9IO4mRQxSx1Rlo4tqzeqb0sOlruaOy3dug==` | `LOCKED_DEPENDENCY_REQUIRED` | **`CACHE_STATUS_UNVERIFIED`** (未検証) |

### 2.2 事実と未検証事項の分離
- **確認済み事実**: `require-from-string@2.0.2` の欠落により `npm ci --offline` が停止したこと。ロック済み依存集合は上記5パッケージのみであること。
- **未検証事項**: テストVM内およびホスト側のキャッシュに残り4パッケージが存在するかどうか。ホスト側に完全な SHA-512 一致で tarball が保管されているかどうか。

---

## 3. DEC-01A：事前インベントリ検査仕様と調査リスク（FND-ODP-006是正）

### 3.1 許可される操作
1. 事前承認された特定パス（テストVM内の `~/.npm` キャッシュ、およびホスト側のキャッシュ保管ディレクトリ）を完全読み取り専用で走査する。
2. 上記5パッケージの tarball の有無、サイズ、SHA-512 ハッシュを照合する。
3. 不足パッケージ集合を特定し、ファイル名、サイズ、SHA-256、SHA-512 を記載した「転送マニフェスト案」を作成する。

### 3.2 調査に伴うリスクと調査契約
- **リスク**:
  - 調査対象パスの過大な拡張による不要なシステム走査。
  - Secrets や個人トークンへの偶発的アクセス。
  - ファイル内容や認証情報の不要なログ出力。
  - ホストへの過度なI/O負荷による稼働中26コンテナへの間接的影響。
- **調査契約**:
  - 調査対象パスは事前合意されたディレクトリに限定する。
  - 原則として存在有無および完全性ハッシュ（SHA-512/SHA-256）のみを記録し、ファイル本文や設定値はログに出力しない。
  - 読み取り以外のファイル変更・属性変更・作成操作を厳禁とする。

### 3.3 厳格な禁止事項
- ファイルの転送、コピー、展開。
- `npm ci` や `npm install` の実行。
- ホストDocker環境・設定へのアクセス。
- 外部インターネットへの通信。

---

## 4. DEC-01B：不足依存パッケージ限定転送仕様

### 4.1 許可される操作（DEC-01A 完了および Owner 承認後）
1. DEC-01A で特定・承認された特定パッケージの `.tgz` ファイルのみを抽出する。
2. ロックファイルの SHA-512 integrity 文字列と完全一致することを確認した上で、テストVMへ限定転送する。
3. VM内で転送された `.tgz` の SHA-512 を再計算し、マニフェストと完全一致することを確認する。

### 4.2 厳格な禁止事項（FND-ODP-002是正）
- **`npm ci` や `npm install` の実行**（これは Stage 1 実行権限であり、DEC-01B では許可されない）。
- テストの実行。
- `~/.npm` ディレクトリ全体の無検証コピー。
- `.npmrc`、認証トークン、資格情報の持ち込み。
- ロックファイルに含まれないパッケージの追加。
- 外部ネットワーク接続の有効化。

---

## 5. Decision Options（判断選択肢）

### DEC-01A (インベントリ検査)
- **`APPROVE`**: 仕様に沿った読み取り専用インベントリ検査およびマニフェスト案作成を許可する（**推奨**）。
- **`CONDITIONAL_APPROVE`**: 調査対象パスをさらに限定して許可する。
- **`HOLD`**: 保留。
- **`REJECT`**: 調査を拒否する。

### DEC-01B (限定転送)
- **`APPROVE`**: 転送を許可する（01A完了前は不可）。
- **`CONDITIONAL_APPROVE`**: 独立レビュアーによるマニフェスト検証完了を条件に許可する。
- **`HOLD`**: DEC-01A のインベントリ結果が提示されるまで保留する（**推奨**）。
- **`REJECT`**: 転送を拒否する。

---

## 6. Authorization Scope & Evidence Requirements

### 6.1 承認範囲とセキュリティ境界
- **対象環境**: テスト専用VM。ホスト環境は完全 READ-ONLY。
- **ネットワーク**: ループバックのみ有効（完全オフライン維持）。
- **有効条件**: 固定HEAD `6b08251170265c444ce8957377e6bfca23b21fd7` の維持。

### 6.2 必要証跡
- **承認前**: ロックファイルの抜粋、ENOTCACHED 発生ログ。
- **01A実行後**: キャッシュ走査ログ、確定した不足パッケージ一覧、転送マニフェスト案。
- **01B実行後**: VM内での SHA-512 再計算一致ログ（`npm ci` ログは Stage 1 証跡となる）。
