# FBO packing reads — 2026-10-03

Large requests slowed down scans and new-carton selection. Request 1626 was still in PICKING while operators packed in parallel. Route availability scanned already picked SKUs, reading 8448 FBS tasks instead of 1368 remaining-SKU tasks. Every packing action also fetched the full 2718-unit ledger.

`WMS_FBO_PACKING_READS_ENABLED` narrows route reservation reads to positive unpicked demand, skips route-only reads after picking, and scopes PACK_UNIT/OPEN_BOX/MANUAL_OPEN_BOX unit reads. Other actions retain the full ledger. Physical-KIZ lookup, request lock, durable operation identity, composition/closure guards, whole-box fallback, stock movement and audit mutations are retained. Default off; only our runtime overlay enables it. Sold WMS is not deployed.

Runtime baseline: API `sha256:e7aa81ff68a153426ea7fdd4efc8a994f3119f107ee8b4b2d58ce4bdefd6a67b`, web `sha256:7fab10dcd44ce9813cd63689ea03fbc7ad4e5b461c57950ceec8e59bd8200532`. Apply `runtime.patch` only to the verified pinned dist. One runtime file changes: `modules/tsd/fbo-two-stage.service.js`. Do not rebuild the older TypeScript service: source/runtime parity remains false. Source edits record the equivalent scope supported by that source; the runtime patch additionally preserves its newer parallel/manual/closure features.

18 runtime tests compare packing writes/errors, marked/unmarked scans, whole-picked fallback, durable retry, empty picking, reopen, invalid phase, composition and closure, disabled flag, completed/packing/control snapshots and unchanged picking checks. Run in the exact candidate with `FBO_API_DIST=/app/apps/api/dist`, `FBO_ORIGINAL_SERVICE=<saved-original.js>` and `node --test ...runtime.cjs`. Before-fix failures reproduce excess reads.

Local full suite baseline/candidate: 1487 tests, 1442 pass, identical 45 failures; two additional suites cannot load missing files. User explicitly approved publication despite these confirmed pre-existing failures. Local installed dependencies are not asserted identical to production; exact-image tests are the runtime gate.

Read-only RepeatableRead comparison on request1626: entire plan response identical; plan 931ms → 418ms. OPEN_BOX progress reads: 2718 rows /82ms →0rows /4ms. PACK_UNIT:2718rows /63ms →39rows /8ms. These are scoped diagnostics, not an end-to-end terminal latency guarantee.

Release verification uses `release_baseline.py verify/materialize/check-candidate`, full image runtime hash comparison, exact-image tests, API/web release locks, current-image guard, rollback tag and post-release health/read-only checks. No migration or business-data repair. Web, APK and print-agent assets are preserved.

Published on 2026-10-03 as API `sha256:3ef0489614fef715a1ec2a3d476f3bf4edb58e03b0fd10e269a81081d8b11d32`. PR471 remains open; source code commit at release is `9fd5d5514ed0d71186f4158397c92efb74df0b42`. The configured GitHub account can publish the PR branch in the parent repository but cannot merge into the integration fork. The owner approved this scoped runtime publication. See `published.json`.

Post-publication health, all564 runtime hashes, unchanged .env/compose/prior flags and other container identities passed. Same-snapshot read-only comparison:953→471ms, response identical. Initial live sample:17PACK_UNIT acknowledgements median800ms, oneOPEN_BOX455ms,36plan reads median1226ms; previous medians1920/2069/3377ms. Short differing observation windows, not a guaranteed end-to-end terminal latency.

New validated runtime reference: `/opt/logoff-wms-backups/verified-runtime-fbo-packing-20261003`; copied and hash-verified on the owner's PC. API archiveSHA256 `189b204d1d54341d75c3483da1cff18d199d9a14a1d6749340c1adf9a2b751a6`. No new database snapshot claimed. Rollback:`logoff-api:before-fbo-packing-reads-20261003`.
