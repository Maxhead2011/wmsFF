# TSD receipt server close — 2026-09-10

## Scope and accepted behavior

Konstantin confirmed: a closed box whose own receipt packet has reached WMS is ready.
Branch: `fix/tsd-receipt-server-close`, created from `fix/sorting-cancelled-wb-return`.
No production deployment, historical data repair, commit or push performed.

The LOGOFF Android boxed-receipt path atomically saves scans and a `receipt_close`
marker in its local outbox. A close references the exact scan keys. Its own packet
is drained without waiting for unrelated boxes. The server verifies accepted scans
against committed receipt movements, then changes `receiving` to `active` and
writes the closure audit in one transaction. No additional receipt is generated.
Offline/retry paths retain stable operation keys. A missing acknowledgement does
not mean ready. A delayed closure from an earlier filling cannot close a reused box.

Other Android flavors retain their existing receipt flow. The additive API operation
does not change legacy receipt-scan behavior. No changes were deployed to sold WMS.

## Files/functions

- `apps/android-tsd/app/src/main/java/pro/logoff/wms/tsd/MainActivity.java`:
  boxed receipt rendering, closeReceiptBox/closeReceiptBoxOnServer, finish/reset guards.
- `.../data/ReceiptCloseBatch.java`: immutable packet, close acknowledgement, bounded query keys.
- `.../data/OperationDao.java`: atomic packet insert and scoped pending/key lookup.
- `.../data/OperationOutbox.java`: durable receipt packet and bounded pending reads.
- `.../sync/TsdSyncRunner.java`: packet-specific drain and close failure messages.
- `apps/api/src/modules/tsd/dto/scan-operation.dto.ts`, `tsd-operation.types.ts`:
  additive receipt_close/RETRY contract.
- `apps/api/src/modules/tsd/tsd-sync.service.ts`: close dispatch with nonterminal retry.
- `apps/api/src/modules/tsd/tsd-receipt.service.ts`: closeBox and payload validation.
- New tests: `apps/api/test/tsd-receipt-close.spec.ts`, Android
  `ReceiptCloseBatchTest.java` and `ReceiptCloseSyncTest.java`.

## RED → GREEN evidence

- API initial 24 tests failed before closeBox/dispatch implementation.
- Movement quantity mismatch: 1 of 31 tests failed, then passed after proof validation.
- Stale receipt-generation cases: 3 of 39 failed, then passed after generation checks.
- Android initial regression compilation failed on absent batch/close methods.
- Large packet regression failed compilation before bounded key helper existed.
- Server refusal-message regression then ran: 12 tests, 1 failed at
  ReceiptCloseSyncTest.rejectedCloseKeepsServerReason; fixed message propagation.
- Final new tests: 39 API + 13 Android passed. Production/test additions use FIX/TEST comments.

## Final verification

- API: `node node_modules/vitest/vitest.mjs run` — 166 files, 1706 tests passed.
  Log: `C:/WMSFF2207/reports/tsd-receipt-close-20260910/api-tests-final.log`.
- API TypeScript noEmit check passed (existing installed TypeScript runtime).
- Web: `node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=2`
  — 19 files, 70 tests passed.
- Android Gradle offline: `:app:testLogoffDebugUnitTest :app:testFfullhabDebugUnitTest
  :app:testPlatformDebugUnitTest :app:assembleLogoffDebug` — BUILD SUCCESSFUL.
  JUnit XML: 75 tests per flavor, zero failures/errors/skips; 225 executions total.
- `git diff --check` passed.

## Limitations / handoff

No real-device acceptance test or live PostgreSQL concurrency integration test ran.
Transaction/retry tests use mocked dependencies; Android sync tests use a fake outbox.
The 900-key chunk test verifies binding bounds, not SQLite on actual legacy hardware.
Coverage percentage is not claimed: a usable service coverage provider is unavailable.
No dependencies were installed. Source generation and normal receipt resume are tested,
but historical records are deliberately not repaired by this change.

Publish API support before distributing the updated LOGOFF APK. An older server
does not know receipt_close, so do not distribute this APK independently first.
Existing receiving boxes closed by old APKs require a separately reviewed repair.

Pre-commit Gate 2: await user confirmation. Proposed message:
`fix(tsd): close received boxes after their own durable receipt batch`.
PR should target the confirmed current LOGOFF development/release branch, not main
or the sold-WMS branch; verify the target again when publication is requested.

## Publication approved by Konstantin

User subsequently approved publication and historical status repair, restricting
repair to batch **0409**. Batch **0809** is inspection only: 9 active boxes, 128
received/current units; the real server Excel generator includes all 128 units.

Additional release files: `apps/android-tsd/app/build.gradle.kts`,
`apps/web/public/downloads/logoff-tsd.{apk,json}`, `infra/tsd-receipt-close.Dockerfile`,
`infra/scripts/tsd-receipt-close-{artifacts.cjs,release.sh,release.test.cjs}` and
`infra/scripts/receipt-0409-repair{.cjs,.test.cjs}`. The release overlay is limited
to four API sources and their JS files plus three LOGOFF download paths. Existing
web assets, runtime configuration and other services must stay identical.

Signed LOGOFF APK: versionCode 165 / versionName 0.1.166-receipt-close,
2,263,489 bytes, SHA256 ac073fc8d07c8d2e84cf86a05d73645051720b7f9760f42bea437af7ef9f2f46.
Signing certificate matches existing release: SHA256
52916d7797ade50cc1c50bba8787b9d2307b1e5dfd4ea725bd7c3be0e64f989b.
Debug APK was used only for tests; it is not published.

Historical selection: exactly 117 receiving boxes of client/warehouse from the
0409 report, positive stock, accepted scans with matching receipts, no failed scans,
no later reopening. SQL revalidates the exact snapshot under locks, writes only
Box status and audit, and verifies unchanged stock/mark fingerprints. Any drift
aborts the entire correction. Empty, archived and other-batch boxes are excluded.
18 release/repair guard tests pass. Publication and data-repair outcomes are recorded
separately in the execution report; this plan alone is not deployment evidence.

Confirmed PR target from merged PR 86:
`fix/tsd-receipt-server-close` → `fix/sorting-recorded-source-20260908`.
