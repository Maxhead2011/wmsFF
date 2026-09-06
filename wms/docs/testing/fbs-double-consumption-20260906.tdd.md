# FBS: prevent a second physical deduction when closing a request

Status: prepared for review; **do not merge or deploy without Konstantin's approval**.
Branch: `fix/fbs-double-consumption-20260906`.
PR base: `fix/fbs-box-scan-route-consistency`, the existing integration branch used by PR #54.

## Cause and scope

The reported source box contained two correct recent transfers to a storage box.
The shortage predated those transfers: two FBS requests had already deducted
AVAILABLE during physical FBS picking, then deducted AVAILABLE again on manual closure.
The old closure logic inferred physical availability from aggregate PACKING/SHIPPING
and did not check the exact FBS task's pickup ledger.

Changes are isolated to this fix branch; no Android/web/MP publication changes,
no schema migration, no update of the sold WMS installation.
The stock service is shared code: merging this change into the sold branch requires
its own review and stock-flow regression run. Do not silently promote it there.

## Files and risks

| File / function | Change | Risk |
| --- | --- | --- |
| stock-operations.service.ts / shipClientRequestFromCurrentStock | use exact-pick-aware planning | High: stock, shipment and billing quantities |
| stock-operations.service.ts / planFbsSafeManualShipment | split proven picks from remaining quantities, preserve source validation, account missing internal SHIPPING without changing AVAILABLE | High: mixed picked/unpicked requests |
| stock-operations.service.ts / prepareFbsPickedStock, ensureAvailableStockIsInPacking, ensurePackedStockIsInShipping | same protection during ordinary preparation | High: packing/shipment; no new UI flow |
| stock-operations.service.ts / three allocation planners | exclude quantities already allocated to proven picks | Medium: default empty exclusion keeps existing callers unchanged |
| fbs-picked-stock-proof.ts | exact task identity, client/SKU/branch, completed live/history tasks; returns cancel pickups chronologically | Medium: ambiguous evidence must not be treated as a physical count |
| repair-fbs-double-consumption.ts | read-only preview, physical-count gate, snapshot digest, admin check, serializable correction through existing adjustInventoryToCounted | High: manual data correction; never schedule automatically |
| three new test files | regression and repair guard tests | Low |

Production modifications contain `// FIX`; tests contain `// TEST` comments.

## TDD evidence

Journeys were derived from Konstantin's report and read-only ledger inspection.
RED: initial tests failed because the proof reader and safe planner did not exist.
Additional RED cases reproduced ordinary preparation consuming AVAILABLE, duplicate
allocations of one process balance, and returns entering another box.

| Guarantee | Test | Result |
| --- | --- | --- |
| Manual closure respects an existing physical pick with saved sources, no saved sources, explicit box and no-box confirmation | fbs-double-consumption.spec.ts | PASS |
| Mixed picked/unpicked items consume AVAILABLE only for the unpicked part | fbs-double-consumption.spec.ts | PASS |
| Multiple task allocations on one balance are coalesced | fbs-double-consumption.spec.ts | PASS |
| Ordinary packing/shipment preparation uses the same protection | fbs-double-consumption.spec.ts | PASS |
| Non-FBS closure remains unchanged; invalid confirmation causes no reconciliation write | fbs-double-consumption.spec.ts | PASS |
| Exact task, client, SKU and warehouse match; absent ledger is not proof | fbs-picked-stock-proof.spec.ts | PASS |
| Returns cancel picks, including returns to another box | fbs-picked-stock-proof.spec.ts | PASS |
| Recovery requires physical count plus ledger proof and no later recount/active work | repair-fbs-double-consumption.spec.ts | PASS |

Commands executed in apps/api using the installed Node runtime:

```
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node ../../node_modules/typescript/bin/tsc -p tsconfig.json
```

Final local API suite: **1042 passed / 0 failed**, including 30 new tests.
API lint (TypeScript noEmit) and compilation passed. Web suite: **45 passed**.
Coverage percentage is not claimed: @vitest/coverage-v8 is not installed.
No physical TSD/UI end-to-end interaction was performed; server handler verification
is described separately below. Android and web source were not modified.

## Server candidate, not deployed

Candidate built from the actual running API image, not the stale server checkout.
Exactly three runtime source files changed: stock service, proof helper, repair script.
All other runtime source hashes match the pre-change manifest.

Server baseline: 601 passed / 84 failed. Candidate: 631 passed / the **same 84 failed**.
No formerly passing test failed; no new failing test. All 30 new tests passed.
The server baseline failures are pre-existing and remain a known limitation, not a
claim of a fully green production test suite.

Konstantin explicitly requested PR preparation only, **no publication**.

## Authorized data correction already applied

Fresh PostgreSQL backup, pg_restore catalog and SHA-256 verified before applying.
This is a safety backup, not permission for a destructive whole-database restore.

The physically confirmed source: AVAILABLE **0 -> 2**. Two distinct +1 INVENTORY_ADJUSTMENT records,
each with an idempotency key derived from its proven duplicate movement ID.
The original pickup/closing ledger and ProductMark records were not modified.
One administrative audit entry preserves before/after and supporting IDs.
The operation used a fresh matching digest and repeated checks inside a
SERIALIZABLE transaction. Replay returned **ALREADY_APPLIED**.

Read-only postcheck through the running API's inspectTsdTransferSource returned
**SCAN_ITEM, totalQuantity=2**. Source has 2 AVAILABLE KIZs; the target box
still has 2 units and 2 KIZs. No target movement was repeated.

## General audit: candidates are not an approved restoration quantity

The read-only audit classified candidates into: exact-task proof and physical
count required; later recount/adjustment; not on a pallet-sort; archived; boxless.
Candidate totals are not approval for stock increases. Only the physically
confirmed correction above was applied. Later recounts may already supersede
old errors. Customer identifiers, quantities and operational artifacts remain
in the private operational report, not this public repository.
