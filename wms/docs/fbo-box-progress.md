# FBO box progress

Published21.11.2026 through PR1045. API fields are gated by existing WMS_MENU_READS_ENABLED. Sold response/UI remains unchanged when absent. No inventory writes, schema changes or TSD changes.

Below the two progress bars: unique nonempty source boxes with active picked/packed units; closed target boxes containing packed units. Returned units, open/empty boxes and duplicates do not inflate totals. Whole-box and partial-picking breakdown combines completed units with the remaining route; summary/history pagination does not affect counts. Unboxed storage contributes units but no source boxes. Shortages and waiting locations without an assigned route are not promised as planned boxes.

Read-only request3162 verification: COMPLETED,934 loose units,0 whole boxes,121 distinct sources,43 closed nonempty targets. Snapshot retained locally; no customer KIZ stored in Git.

Validation: API4837 tests pass,181 skipped; unrelated dedicated KIZ PostgreSQL integration suite excluded (database URL unavailable). Web653 pass,2 skipped; TypeScript passes. Four new API/UI regressions cover duplicates, returned units, empty/open boxes, summary projection and missing capability. Exact published browser component RED/GREEN and desktop/mobile geometry checks pass on the3162 snapshot. Published API2/web3 is layered onto fresh live images and checked against all file hashes.

Release tooling in scripts/releases/fbo-box-progress. Source/runtime parity remains false. Publish requires merged PR, source head, browser/control/read-only proofs and unchanged live image/compose baseline; automatic rollback retains previous images/config on failure.

Post-release: live full/summary3162 both return121/43/934/0; health, complete API/web hashes, unchanged environments and other containers verified. Public JS/CSS match tested candidate; public controls24 pass. No request writes. Baseline2026-11-21-fbo-box-progress.
