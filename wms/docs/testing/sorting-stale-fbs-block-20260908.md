# Admin sorting: historical FBS task must not block a different KIZ

Scope: our WMS only, existing `WMS_PALLET_SORTING_ENABLED=true` + ADMIN gate.
Branch: `fix/sorting-stale-fbs-block-20260908`, from `1798a582`.
Proposed PR base: our established integration branch `fix/fbs-box-scan-route-consistency`.
No deployment, APK change, DB repair, order-status update or stock write was performed.

## User journey and incident

Administrator physically confirms a source box, then scans SKU/KIZ and moves the unit to a target.
An unrelated historical RETURN_REQUIRED task must not reserve this new unit. Active, unpicked FBS
routes must be invalidated at source confirmation and before MOVE, including already-FORMING sessions.

Read-only production evidence: order 5621225407, source FFL_LKB0104_215, barcode 2047945565575.
The historical order has a DIFFERENT KIZ. Its three ledger entries are AVAILABLE PICK -1,
PACKING PICK +1, PACKING SHIP -1. All match client, warehouse, source and SKU. The exact
task-prefixed keys were rechecked in a READ ONLY transaction on 2026-09-08.

## Surgical changes and risks

| File / functions | Change | Risk / isolation |
|---|---|---|
| `stock/sorting-settled-box-tasks.ts`: sortingSettledBoxTaskIds | Read-only proof for fully deducted historical tasks with another KIZ | High stock-domain risk: exact three-entry proof, scope matching, completed RETURN_REQUIRED, different identity; fail closed otherwise |
| `stock/stock-operations.service.ts`: transferSortingUnit, resolveStorageBoxTransferItem, resolveStorageBoxTransferMark, resolveUnregisteredStorageBoxTransferMark | Internal sorting-only exception; all own-KIZ history checks retained, print/circulation checked; return excluded IDs for audit | Shared source file, but ordinary transfer defaults unchanged and ADMIN/feature gate required; sold deployment must not be updated |
| `inventory/pallet-sorting.service.ts`: start, runAction, includeScannedSource, move | Invalidate logical routes at physical source scan and before MOVE; record historical IDs in UNIT_MOVED audit | Existing CAS, physical-pick guards, scoped route queue and post-commit web/TSD rebuild reused |
| `test/sorting-settled-task.spec.ts` | 37 regression/safety cases | Synthetic mocks only, no stock mutation in production |
| `test/pallet-sorting-stock.spec.ts`, `test/pallet-sorting-session.spec.ts` | Fixtures now model ADMIN/feature gate and source-scan route call | No disabled tests or weakened expectations |

Historical task fields, SHIPPING marks, return decisions and shipment history are NOT rewritten.
No inferred new receipt: normal movement remains paired MOVE -1/+1. The existing zero-stock
physical-discrepancy recovery remains separate. Only newly scanned/confirmed source boxes are
eligible; the pallet scan does not declare every listed box physically present.

Full-inventory locks, unresolved recounts, non-FBS active requests, other sorting sessions,
own-KIZ shipment/print history and already physically picked FBS work remain protected.
This is not a global "clear every lock" operation.

## TDD evidence

1. Runtime RED: initial 18 tests executed; 3 failed for the intended defects (old task blocks
   new KIZ; source scan does not invalidate; MOVE runs before invalidation). Remaining 15 passed.
2. Minimal fix: same cases GREEN. Combined initial sorting suites: 99/99.
3. Added sorting exception safety for own print/circulation records: 2 runtime RED cases,
   then both GREEN after scoped checks were added.
4. Final targeted suite: 37/37, including public transfer entry through real barcode/KIZ/history
   resolution (DB and ledger writes mocked), role/flag gates, real route-invalidation method,
   concurrent-update failure and physical-pick protection.
5. Native V8 coverage: sortingSettledBoxTaskIds 24/24 executed blocks (100%). This is helper
   block coverage, NOT a claim of whole-service branch or end-to-end coverage.

Commands from `apps/api` (Node is the configured bundled runtime):

```powershell
node node_modules/vitest/vitest.mjs run test/sorting-settled-task.spec.ts
$env:SORTING_SETTLED_COVERAGE='true'
node node_modules/vitest/vitest.mjs run test/sorting-settled-task.spec.ts
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node ../../node_modules/typescript/bin/tsc -p tsconfig.json
```

Final full API run: 1434/1434 (153 files), including all 37 new regression/safety cases.
Initial unrestricted-worker run had one unrelated billing PDF 5s timeout; the entire suite
passed with two workers, without editing billing or increasing its timeout. Typecheck and
server build passed. Web: 58/58 (16 files), using its existing Vitest runner.

RED commits were not created: the user's repository rule requires green tests before committing.
This report preserves the RED/GREEN evidence for the eventual single green checkpoint.

## Release / known gaps

- No live TSD scan or isolated PostgreSQL write integration was run for this change. Local
  public service-chain tests are not presented as a successful physical terminal test.
- The live stock service has an independently deployed calculated-weight warning inside
  `validateBoxWeight`. Before release preserve it via the established guarded overlay;
  never replace the whole live source blindly from this checkout.
- Source scan queues invalidation; existing web/TSD action handlers perform the route rebuild
  after commit and retain pendingRoutes/error for retry. No new WB stock/status writes added.
- Exclusion is deliberately strict (exact proven single-unit ledger pattern, at most 100
  historical tasks). Other historical patterns continue to fail closed for investigation.
- Existing dirty `test/pallet-sorting-postgres.cjs` is excluded. SHA256 remains
  `93133d4ca1115e3d399c16b0b918b318d4feda0b6d0e393658575ef268661a18`.

## Key code markers

```ts
// FIX: the historical-task exception is exclusive to enabled ADMIN sorting.
assertSortingAdmin(user);
// FIX: existing FORMING sessions also release logical routes before transfer.
await this.resetAffectedRoutes(tx, state, [source.id], user);
// TEST: incident 5621225407 must not block a new KIZ in the same box/SKU.
```
