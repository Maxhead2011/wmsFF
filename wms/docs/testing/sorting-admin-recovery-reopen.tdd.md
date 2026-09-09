# Sorting: administrator recovery and destination reopening

2026-09-09. Branch: `fix/sorting-admin-recovery-reopen`, based on `fix/sorting-available-kiz-zero-stock` (ee44b04). Proposed integration base: `fix/sorting-recorded-source-20260908`.

## Scope and impact

Only the opt-in ADMIN pallet-sorting workflow. No migrations, credentials, marketplace status changes, production stock repairs or deployment. No changes to sold-instance configuration or Android applicationId.

- `sorting-written-off-recovery.ts / restoreWrittenOffSortingUnit`: an incomplete/missing old request or other assemblies' box codes do not block physical confirmation. Keep the negative ledger event, zero balance in every status, client/branch/SKU, unique identity, exact-KIZ order/print/shipment/circulation checks, explicit fingerprint consent and transaction locks. Risk: inventory adjustment; no automatic receipt.
- `pallet-sorting.service.ts / openTarget`: reopen a closed destination of the current FORMING session, preserve quantity, recheck ownership/placement and competing work. Does not reopen a completed sorting session.
- `previewInTx / archiveSources`: retain the entire source box with non-AVAILABLE/negative balances, its stock, marks and placement; show this before completion, include it in fingerprint/audit. This is NOT repair or erasure of a reservation. Other sources can finish.
- Android screen/formatter and web panel/types: expose retained discrepancies, and Android destination top-up action. Existing versioned command/idempotency protocol reused.

## TDD evidence

User journeys derived from the supplied screenshots and explicit request. No plan file.

| Guarantee | Test | Evidence |
|---|---|---|
| Missing request, same box, absent other KIZ, duplicate/incomplete other assemblies still require physical confirmation | sorting-written-off-recovery.spec.ts | Five new runtime RED failures, then GREEN |
| Existing exact KIZ order/shipment/print evidence still blocks recovery | same suite | GREEN; no history erased |
| Closed destination reopens without resetting 13 units, foreign/moved/deleted/source/open-target cases rejected | pallet-sorting-reopen.spec.ts | Runtime RED on closed-target rejection; 8 GREEN |
| PACKING source stays intact while other sources complete | pallet-sorting-permanent-boxes.spec.ts | Runtime RED on reserved-stock exception; 7 GREEN |
| Retained goods are not described as empty or written off | Android PalletSortingProblemFormatterTest; web SortingRetainedNotice.spec.tsx | Android compile-time RED for new formatter, web runtime RED for missing component, then GREEN |
| Receipt once, retry/concurrent command, rollback, late history guard, close/reopen, missing request restoration | sorting-written-off-postgres.cjs | PASS in isolated synthetic PostgreSQL, real service and ledger |

Focused API run: 51 tests passed. Full API run initially had one old message-text expectation failure; retained compatible wording and reran: **1549/1549 passed**.
Web full suite: **62/62 passed**. Android `testLogoffDebugUnitTest` and `testFfullhabDebugUnitTest`: both passed; LOGOFF **62 tests**. Sold flavor tested locally only, not deployed.

Commands executed from respective application folders:

```text
vitest run --maxWorkers=2 --minWorkers=1 --reporter=json --outputFile=<local report>
tsc -p tsconfig.json --noEmit
tsc -p tsconfig.json
vite build
gradle :app:testLogoffDebugUnitTest :app:testFfullhabDebugUnitTest :app:assembleLogoffDebug --console=plain
SORTING_WRITEOFF_COVERAGE=true vitest run test/sorting-written-off-recovery.spec.ts --maxWorkers=1 --minWorkers=1
```

Recovery helper native V8 coverage: **59/60 blocks (98.33%)**. API typecheck/build and web typecheck/build passed. Existing Vite unresolved runtime asset / large-chunk warnings remain. Android has existing deprecated API warnings.

Synthetic SQL runner: `reports/sorting-screen-20260909/postgres-admin-recovery.sh` outside Git. Internal test network; production schema only, no production data copied. Production services not restarted. JSON stdout's `receiptQuantity:3` describes the original scenario; the new additional missing-request case separately asserts destination quantity 4.

No physical TSD or full browser interaction test was available in this run. Debug APK is a verification build, not a published update. Release requires signed versioned APK and production-compatible patch deployment through PR.

User rules prohibit committing RED checkpoints: RED evidence retained here; commit only after full GREEN. No refactor stage.
