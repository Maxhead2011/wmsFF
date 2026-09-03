# TSD: one-unit transfer from a source box to a storage box

## Scope and isolation

Requested journey: source box → product barcode → KIZ (marked goods) → destination storage box.
The next unit uses the same source box. Each destination scan moves exactly one unit.

Branch: `feature/tsd-box-to-storage-box`, based on our production baseline `dede9a6`.
Publication was requested by Konstantin after the initial implementation report.
No database migration is required. Only our Logoff APK is built and published.
The new Android entry point is restricted to the `logoff` flavor. Server behavior is
opt-in using `transferMode: BOX_TO_STORAGE_BOX`; legacy batch transfers are unchanged.

Changed production functions/files:

- `stock-operations.service.ts`: opt-in inspection and single-unit execution,
  `resolveStorageBoxTransferItem` for barcode/KIZ consistency.
- `box-code-policy.service.ts`: `requireStorageBox`, separate from ordinary box validation.
- `MainActivity.java`: seven-line Logoff-only navigation entry; existing screens are retained.
- `StorageBoxTransferActivity.java`: separate scanner screen and persisted pending-request retry.
- `StorageBoxTransferState.java`: explicit scan stages and stable retry operation key.
- Missing Android DTO/helper dependencies and stale session/receipt DTO signatures were
  restored from compatible existing source copies. Existing baseline fields are preserved,
  including emergency FBS recovery, source-box item details and aggregate pallet counts.
  MainActivity, WmsApi, WmsApiFactory and sync implementations were not replaced by older copies.
  Restored FbsTaskSafety and FbsAssemblyUi tests run as part of the full Android suite.

## Guarantees

- Inspection is read-only: no automatic replacement or creation of KIZs.
- Barcode and KIZ must identify the same available SKU in the selected source box.
- Destination must use the configured storage-box prefix, including a non-empty suffix.
- Existing client, branch, archived-box and inventory-lock checks remain in force.
- Quantity decrement, increment, MOVE ledger entries and mark placement commit in one
  serializable transaction. An existing completed operation key returns ALREADY_APPLIED.
- On network failure the Android screen retains the unit, destination and operation key.
  A different destination cannot be selected while the previous result is uncertain.
  Pending source/barcode/KIZ/target/operation key are committed to local preferences before
  sending the mutation and restored on reopening. No access token is duplicated there.
- New scan input is blank after every response. Worker/token changes close the screen,
  and stale responses cannot update another employee's screen.

## RED / GREEN evidence

1. `node node_modules/vitest/vitest.mjs run test/tsd-storage-box-transfer.spec.ts`
   before implementation: 6 failed, 6 passed. Failures include missing storage-prefix
   validation, wrong scan state, accepting KIZ before barcode, rejecting SBOX targets.
2. Android test compiled before implementation: compilation failed specifically because
   the new `StorageBoxTransferState` class did not exist.
3. After implementation: 16 new API tests passed. Two box-policy regression tests and
   the legacy empty-source archival transfer test also passed (19 total selected tests).
4. Final Gradle `testLogoffDebugUnitTest`: **24 tests passed**, including six new state tests.
   The two new uncertain-request guard tests were RED (missing methods) before implementation.
   `assembleLogoffRelease` and release lint completed successfully.
5. API TypeScript check: `tsc -p tsconfig.json --noEmit` passed.

Full API suite, including the final edge-case additions:

| Source | Result |
|---|---|
| Unchanged dede9a6 baseline | 75 failed, 526 passed; 24 failing files |
| Feature branch | 75 failed, 542 passed; 24 failing files |

All 75 failing test titles were compared; the sets are identical. No existing failing
test was changed or skipped in the full-suite runs. The final 75 failure titles were
compared with the untouched baseline again; the sets are identical.

## Source reconciliation and unverified areas

The baseline Android sources are incomplete/incompatible. After restoring the six
missing files, Gradle compilation reports 56 existing symbol/signature errors in
authentication, receipt, FBS and inventory dependencies (e.g. TsdSession.hasRole,
TsdInventorySession.completedAt, OperationOutbox.enqueueReceipt overload).
The missing dependencies were restored additively, without replacing the existing MainActivity.
Independent Gradle compilation of untouched dede9a6 also failed (35 errors, primarily
missing classes); restoring the six classes exposes the additional stale signatures.

No physical-TSD E2E, actual PostgreSQL concurrency/rollback test, or measured coverage
has been performed. Restore of the pending-operation identifiers is unit-tested, but
actual Android process termination has not been tested on hardware. The full API suite
is not green because of the 75 verified pre-existing failures; there are no new failures.
The sold WMS is not deployed or modified on its server. Shared Android dependency
restoration must be reviewed before any future sold-flavor release.

## Artifact

- Logoff versionName: `0.1.153`, versionCode: `152`.
- SHA-256: `5b02067d1178f5c4a81095c912844028a571b2cea7ec462def5fa8c9f4e7ab0c`.
- Size: `2235056` bytes.
- Signing certificate SHA-256: `52916d7797ade50cc1c50bba8787b9d2307b1e5dfd4ea725bd7c3be0e64f989b`,
  identical to published 0.1.152, so an in-place update is supported.
