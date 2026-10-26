# 05. DEC-04 — 全体回帰範囲・Gate審査基準判断資料（R1）

## 1. Decision Summary

### 1.1 判断する内容
Stage 5 における全体回帰試験の対象範囲として、固定HEADに存在する全39テストファイルを確定し、多面的合格契約に基づくGate審査基準を承認するかどうかの判断です。

### 1.2 実施する必要性
- 初回テスト実測（455件）は、依存不足やキャンセルにより一部のテストが中断された状態のカウントであり、固定の合格目標件数として適切ではありません。
- 実行担当者が恣意的に都合のよいテストのみを抽出し「全体回帰合格」と主張することを防ぐため、固定HEADのGitツリーに基づく全39テストファイルを公式な審査対象として固定する必要があります。

### 1.3 推奨判断
- **`APPROVE`** を推奨。
- 理由: 39ファイルの独立静的照合が完了しており、多面的合格契約（FAIL=0, CANCELLED=0等）が厳格に定義されているため。

---

## 2. 独立静的照合結果（全39テストファイル一覧）

固定HEAD（`6b08251170265c444ce8957377e6bfca23b21fd7`）のGitツリー（`.github/workflows/scripts/*.test.mjs`）を読み取り専用で独立に照合し、以下の**全39ファイル**が実在することを確認しました。

```text
 1. .github/workflows/scripts/antigravity-host.test.mjs
 2. .github/workflows/scripts/antigravity-policy.test.mjs
 3. .github/workflows/scripts/authorize-decision-egress.test.mjs
 4. .github/workflows/scripts/authorize-routing-start.test.mjs
 5. .github/workflows/scripts/build-decision-state.test.mjs
 6. .github/workflows/scripts/check-pr-head.test.mjs
 7. .github/workflows/scripts/check-pr-target.test.mjs
 8. .github/workflows/scripts/classify-pr-review-risk.test.mjs
 9. .github/workflows/scripts/decision-provider.test.mjs
10. .github/workflows/scripts/deduplicate-review-comments.test.mjs
11. .github/workflows/scripts/evaluate-routing-publish.test.mjs
12. .github/workflows/scripts/extract-pr-review-features.test.mjs
13. .github/workflows/scripts/filter-ocr-findings.test.mjs
14. .github/workflows/scripts/llm-proxy.test.mjs
15. .github/workflows/scripts/load-review-certification.test.mjs
16. .github/workflows/scripts/ocr-routing-audit.test.mjs
17. .github/workflows/scripts/ocr-routing-entrypoints.test.mjs
18. .github/workflows/scripts/ocr-routing-workflow.test.mjs
19. .github/workflows/scripts/ocr-run-binding.test.mjs
20. .github/workflows/scripts/post-ocr-comment-dedup.test.mjs
21. .github/workflows/scripts/post-ocr-comments.test.mjs
22. .github/workflows/scripts/prepare-ocr-review-context.test.mjs
23. .github/workflows/scripts/prepare-review-routing.test.mjs
24. .github/workflows/scripts/publish-routing-review.test.mjs
25. .github/workflows/scripts/read-checkout-identity.test.mjs
26. .github/workflows/scripts/resolve-threads.integration.test.mjs
27. .github/workflows/scripts/resolve-threads.test.mjs
28. .github/workflows/scripts/routing-audit-contract.test.mjs
29. .github/workflows/scripts/routing-authorization.test.mjs
30. .github/workflows/scripts/routing-execution-context.test.mjs
31. .github/workflows/scripts/routing-mutation-authorization.test.mjs
32. .github/workflows/scripts/routing-remediation.integration.test.mjs
33. .github/workflows/scripts/routing-traceability.test.mjs
34. .github/workflows/scripts/run-routing-review.test.mjs
35. .github/workflows/scripts/select-review-model.test.mjs
36. .github/workflows/scripts/update-check-run-cli.test.mjs
37. .github/workflows/scripts/update-check-run.test.mjs
38. .github/workflows/scripts/validate-ocr-result.test.mjs
39. .github/workflows/scripts/validate-review-model-catalog.test.mjs
```

**独立検証ステータス**: `TEST_SCOPE_INDEPENDENT_VERIFICATION_PASS`（全39ファイル完全一致照合済み）

---

## 3. 多面的合格契約（Stage 5 Gate 基準）

単なるテスト総数の比較（例: 455件一致）ではなく、以下の**6条件の同時成立**を Stage 5 の公式合格要件と定めます。

1. **`EXPECTED_TEST_SCOPE_ACCOUNTED_FOR`**:
   - 上記全39テストファイルが漏れなくテストランナーによって検出・実行開始されていること。
2. **`NO_UNEXPLAINED_TEST_OMISSIONS`**:
   - 旧実測の436件PASSおよび未解決19件が、新テスト実行ログ中で一対一に追跡可能であること。
3. **`FAIL = 0`**:
   - テストランナー最終集計において `# fail 0` であること。
4. **`CANCELLED = 0`**:
   - テストランナー最終集計において `# cancelled 0` であること。
5. **`UNEXPECTED_SKIP = 0`**:
   - 事前に承認されていないスキップがゼロであること（`# skipped 0`）。
6. **`UNEXPECTED_TODO = 0`**:
   - 未実装スタブの混入がゼロであること（`# todo 0`）。

---

## 4. 権限境界の明確化

- **重要**: DEC-04 の承認は、「**審査基準および回帰範囲の定義に対する合意**」に限定されます。
- 将来実施されるテスト実行結果の承認や、G1-D1 Formal Gate の解除を意味するものではありません。
- 実際のテスト結果の承認は、実行後に提出される全ログ・ハッシュ突合結果に基づき、別途行われます。

---

## 5. Decision Options（判断選択肢）

- **`APPROVE`**: 全39ファイルの対象範囲および多面的合格契約を公式Gate基準として承認する（**推奨**）。
- **`CONDITIONAL_APPROVE`**: 特定のテストファイルに対する追加検証条件を付与して承認する。
- **`HOLD`**: 保留。
- **`REJECT`**: 拒否する。
