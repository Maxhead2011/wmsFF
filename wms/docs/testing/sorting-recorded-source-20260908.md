# Sorting: physical box differs from the KIZ accounting box

User journey: ADMIN scans a confirmed physical source box, a product barcode and its KIZ.
If the available unit is recorded in another box, move that existing unit to the sorting target
and preserve both physical and accounting source evidence, without a new receipt.

Incident: two KIZs of barcode 2052399249995 are AVAILABLE in FFL_LKB2107_41 (2 units).
The operator physically scanned FFL_LKB2107_44; target FFL_LKBS0709_07. The previous diagnostic
found neither KIZ in the checked FBS assignment, shipment, print or circulation history.
Those are not the two PACKING units previously observed in box 44.

## Scope / impact

- `apps/api/src/modules/inventory/pallet-sorting.service.ts`: `move`, new `moveFromRecordedSource`,
  optional `moves[].sourceCorrection`. High stock-domain risk; reuse `transferSortingUnit`,
  existing paired ledger MOVE and scoped route invalidation. One production file changed.
- `apps/api/test/pallet-sorting-recorded-source.spec.ts`: regression and negative cases.
- This report. No schema, Android, web, shared transfer service or sold-WMS changes.

Enabled only via the existing ADMIN + WMS_PALLET_SORTING_ENABLED gate and client/warehouse scope.
Physical confirmation is the explicit source-box scan already supplied by web/TSD, not a new
client-controlled bypass flag. Missing/unconfirmed physical source remains a blocking prompt.

The accounting source is locked and checked for another sorting session, inventories and
non-FBS requests. Both boxes must be active, same client/warehouse; the physical source must
still have its confirmed placement. The recorded SKU must match the scanned barcode and have
positive AVAILABLE balance. Another target or an already settled source cannot be consumed.
Re-read the unique KIZ and all six FBS/print/circulation history tables inside the owning
Serializable action transaction. Existing transfer service revalidates stock/KIZ and updates it.

Accounting effect: recorded source -1 AVAILABLE, target +1 AVAILABLE, physical source unchanged.
Do NOT add the accounting source to `state.sources`: its other contents must never enter the
final shortage/archive preview. The move includes `sourceCorrection`; audit action
`PALLET_SORTING_UNIT_MOVED_SOURCE_CORRECTED` records both sources, destination, user, SKU and KIZ.
Logical FBS routes affected by either source are queued using the existing mechanism.

## TDD evidence

- RED: initial 24 tests executed, 2 failed with the exact existing error about unavailable
  KIZ in scanned source boxes. The normal movement and duplicate replay were blocked.
- GREEN: same 24 tests passed after the minimal service change. Four sorting suites: 102/102.
- Extended targeted suite: 35/35, including changed mark ownership/status/SKU, no balance,
  wrong barcode, role/flag denial, other client/warehouse, six history types, locks, repeat
  scan, target change and failure before writing the session result.
- Native V8 coverage of `moveFromRecordedSource`: 31/34 blocks = 91.18%. Not a claim of full
  application branch coverage or physical-device testing.

Commands (bundled Node runtime, API cwd):

```powershell
node node_modules/vitest/vitest.mjs run test/pallet-sorting-recorded-source.spec.ts
$env:SORTING_RECORDED_SOURCE_COVERAGE='true'
node node_modules/vitest/vitest.mjs run test/pallet-sorting-recorded-source.spec.ts
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node ../../node_modules/typescript/bin/tsc -p tsconfig.json
```

Full API regression suite: 1469/1469, 154 files. Typecheck and API build passed.
Web regression suite: 58/58, 16 files.
No isolated PostgreSQL write test or physical TSD test performed for this change; service
tests use mocked storage/ledger writes. No production data changes or publication performed.
RED evidence retained here; user's green-before-commit rule overrides separate RED commits.

Branch: `fix/sorting-recorded-source-20260908`, from `9ef395a8`.
Proposed PR target: our established integration branch `fix/fbs-box-scan-route-consistency`.
Unrelated dirty `test/pallet-sorting-postgres.cjs` preserved/excluded, SHA256
93133d4ca1115e3d399c16b0b918b318d4feda0b6d0e393658575ef268661a18.

```ts
// FIX: explicit physical source scan can reconcile an AVAILABLE KIZ recorded in another box.
return this.moveFromRecordedSource(tx, state, dto, user, mark, code, target, identity);
// TEST: exact incident; accounting source must not be added to the archive/write-off manifest.
```
