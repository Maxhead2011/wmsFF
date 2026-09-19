# Whole-picked FBO box repacking, release 195

PR223 applied over current API and published Android194. Existing pickClosure, fast receipts, checkpoints and all unrelated modules preserved. No schema migration. Exact overlay: published-source.patch. Audio asset is the user-authorized error recording committed in PR223.

57 isolated PostgreSQL integration cases and1056 Android executions passed. Signed upgrade194 to195 preserves settings/language and a queued operation. Release DEX verified. Full image baseline/candidate comparison retains identical existing failures; see candidate-tests.json. Repository suite:2699 passed,38 skipped.

First individual packing scan converts the whole-picked box contents to loose picked stock within the same request, then packs the scanned unit. Quantity picked and AVAILABLE consumption do not increase. Atomic rollback, idempotency, changed mark location and continued loose packing are covered. No actual production stock movement is performed by deployment.

Only one API module changes; Android runtime source is unchanged apart from version metadata and the error recording. All other images/containers and server settings retained.
