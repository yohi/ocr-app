# R2 protected-file immutability record

Comparison base: `1c85d4979ae0153f3f5848e9dbf489dc124b98b1`.

For each listed file, the base Git blob SHA-1 (`git rev-parse BASE:path`) equals the R2 worktree content blob SHA-1 (`git hash-object path`) at the time of this record. The no-change check `git diff --name-only BASE -- <protected paths>` returned no paths.

| Protected file | Base blob | R2 worktree blob |
| --- | --- | --- |
| `.github/workflows/scripts/post-ocr-comments.mjs` | `bc4f2c77500c9e2119cea396ce968004cff79dcd` | `bc4f2c77500c9e2119cea396ce968004cff79dcd` |
| `.github/workflows/scripts/post-ocr-comments.test.mjs` | `6b11987b67bc73adb7e634eca4cf2087a7190998` | `6b11987b67bc73adb7e634eca4cf2087a7190998` |
| `.github/workflows/scripts/publish-routing-review.mjs` | `bdefe9c4bd6cdc1641f0896cdebf4d622256e68e` | `bdefe9c4bd6cdc1641f0896cdebf4d622256e68e` |
| `.github/workflows/scripts/publish-routing-review.test.mjs` | `09e49fd7295107ad7ca9b21e3df88e388a0c32bf` | `09e49fd7295107ad7ca9b21e3df88e388a0c32bf` |
| `.github/workflows/ocr-engine.yml` | `f2d91d1eb445e8517735b08802335e9e88cb8f79` | `f2d91d1eb445e8517735b08802335e9e88cb8f79` |
| `.github/workflows/scripts/antigravity-host.mjs` | `a9046678bce6c848c684d237d623313b2590e44d` | `a9046678bce6c848c684d237d623313b2590e44d` |
| `.github/workflows/scripts/antigravity-host.test.mjs` | `4c61306d2c98c9756c3603b99a8667fbeab64579` | `4c61306d2c98c9756c3603b99a8667fbeab64579` |
| `.github/workflows/scripts/routing-authorization.mjs` | `c35bc2fafe78f2d98d867f5b5a92ad92b02b0405` | `c35bc2fafe78f2d98d867f5b5a92ad92b02b0405` |
| `.github/workflows/scripts/routing-authorization.test.mjs` | `c123949655873b6e29487a5672cd971bc3625851` | `c123949655873b6e29487a5672cd971bc3625851` |
| `.github/workflows/scripts/routing-mutation-authorization.mjs` | `a3185070c55bb4cc611eecf92f5d7e553e850e23` | `a3185070c55bb4cc611eecf92f5d7e553e850e23` |
| `.github/workflows/scripts/routing-mutation-authorization.test.mjs` | `bdfa8d893c9f14ca949550f88b6d1ce1286029a5` | `bdfa8d893c9f14ca949550f88b6d1ce1286029a5` |
| `.github/workflows/scripts/authorize-routing-start.mjs` | `6867303d1cf13d0ef9cc57f782a859f15c8eeecf` | `6867303d1cf13d0ef9cc57f782a859f15c8eeecf` |
| `.github/workflows/scripts/authorize-decision-egress.mjs` | `ab0cb68d69e729b09116f92c1394fe7e99d8772e` | `ab0cb68d69e729b09116f92c1394fe7e99d8772e` |

Final verification after source commit `6aceb8daf1a62d263f45febde9f4e19ecbd59870` and pushed branch tip `4599a6086867333d9fedef313425d730b81404f6` confirmed that the complete `.github/workflows/config` tree hash remains `8d0f168e290c80d416ca37d50b45de7a71df2861` and the `cloudflare-worker` tree hash remains `f3cde29ea7575d42069396ba7b1e8b7c51189ef3`. `GIT_MASTER=1 git diff --name-only 1c85d4979ae0153f3f5848e9dbf489dc124b98b1 4599a6086867333d9fedef313425d730b81404f6 -- <protected paths>` returned no paths. A subsequent evidence-only commit updates this record and its checksum; it does not change any protected path. These are author-side byte comparisons, not independent review findings.
