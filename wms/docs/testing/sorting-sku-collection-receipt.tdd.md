# Sorting: receive a KIZ already picked by SKU collection

2026-09-09. Branch: fix/sorting-sku-collection-kiz-receipt, based on published d0e5846.
Journeys derived from Konstantin's request to correct KIZ bSWUB,BlKri7 and confirmed target FFL_LKBS0709_09.

## Scope / impact

- apps/api/src/modules/inventory/pallet-sorting.service.ts, move: recognize unboxed PACKING and route it to SKU collection receipt; count as moved, not recovered.
- apps/api/src/modules/stock/sorting-sku-collection-receipt.ts, receiveSkuCollectionSortingUnit: atomic paired MOVE (-1 PACKING, +1 AVAILABLE), update the same ProductMark and original SkuCollectionScan/Source, recompute request receipt progress, audit.
- apps/api/src/modules/stock/stock-operations.service.ts, receiveSkuCollectionSortingUnit: restricted internal adapter with ADMIN and client-scope checks and existing balance-key implementation.
- apps/api/test/sorting-sku-collection-receipt.spec.ts: 39 regression and access/concurrency tests.
- apps/api/test/sorting-written-off-postgres.cjs: real database receipt, rollback, concurrency, replay, zero net stock growth and explicit technical attribution.

Only the opt-in ADMIN pallet-sorting workflow changes. No ordinary FBS assembly/receipt, Android, web, sold VM or FFULHAB changes. No schema migration. No automatic unreservation or deletion of order/shipping history.

## TDD evidence

RED 16:56 MSK: actual PalletSortingService.move test failed with the existing source-box refusal for a PACKING KIZ. Production code was not modified before that test ran.
GREEN: same test plus 38 cases passed.

The user requires all tests green before any commit; that requirement takes precedence over a RED checkpoint commit in tdd-workflow. RED evidence is preserved here.

| Guarantee | Test | Result |
|---|---|---|
| Existing picked unit is received, not recreated | sorting-sku-collection-receipt.spec.ts | PASS |
| Same command / identity cannot add quantity twice | unit and PostgreSQL service action | PASS |
| Both ledger legs and collection receipt metadata agree | PostgreSQL service action | PASS |
| Failed transaction rolls back balance, mark, scan and session | PostgreSQL injected command-audit failure | PASS |
| Concurrent attempts debit once | PostgreSQL concurrent service commands | PASS |
| Wrong client, branch, SKU, source, request, shipment or missing balance does not receive stock | 39-test focused suite | PASS |
| Technical repair does not impersonate a picker | PostgreSQL null userId and explicit technical receivedByName | PASS |

Executed validation:

- Local API: node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1 --reporter=json --outputFile=C:/WMSFF2207/reports/sorting-admin-empty-20260909/sku633-api-tests.json — 1610 tests passed, 0 failed.
- Local web: node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1 — 62 tests passed.
- API lint/typecheck: node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit — exit 0.
- API build: node ../../node_modules/typescript/bin/tsc -p tsconfig.json — exit 0.
- SORTING_SKU_RECEIPT_COVERAGE=true with the focused test: precise V8 function-block coverage 72/77 = 93.51%. This is not whole-repository line coverage.
- Candidate built over live API image 4433d72d: API typecheck/build passed; exactly two changed runtime modules plus one new module and their compiled JS counterparts. Image configuration unchanged.
- Candidate full API suite: 1634 tests passed, plus 3 TSD message integration tests.
- Candidate isolated PostgreSQL integration: PASS. Synthetic data only; no production records or WB calls.

## Confirmed production item correction

KIZ identity: 0104680992598462215bSWUB,BlKri7.
Barcode 2051621250518; ProductMark 826ac458-f8e1-4541-93e5-7daa364630e6.
Client c76b78f9-1b83-4e9b-bee3-bc28336ee1c9, Moscow warehouse afb244a1-50ae-4ae6-9111-afe85949fa58.
Original request 633 (323223d3-d683-4727-a2ff-c733b93f0134), scan f8f9ec27-46e7-4787-9e0d-83b7265394a3: picked by Sonya on 2026-09-05, source FFL_LKB0207_66, not previously received.

User explicitly confirmed physical target FFL_LKBS0709_09 (61319028-32f8-4d35-b146-76edd305cd92).
Applied the tested service command in a one-off maintenance container, without replacing the live API:

- PACKING unboxed -1, AVAILABLE target +1. Old source box not debited again.
- Same mark AVAILABLE in the target; original scan RECEIVED, receivedByUserId null, name explicitly technical correction by confirmation of Konstantin. Original picker fields unchanged.
- Current sorting f5157b4f-43a7-4b41-b9d3-a49446d37db4 records the move and version 33 -> 34. Completed earlier sorting untouched.
- Total stock for the SKU in this client/warehouse: 83 -> 83; target SKU quantity 0 -> 1.
- Before snapshot audited under repair-sku633-bSWUB-20260909. Dry-run rolled back first, fingerprint checked before apply. Replay returned ALREADY_APPLIED.
- Backup /opt/logoff-wms-backups/sorting-sku633-20260909/wms.dump, pg_restore TOC and SHA checked. Scripts/evidence at C:/WMSFF2207/reports/sorting-sku633-20260909 and /opt/logoff-wms-releases/sorting-sku633-20260909.

Do not restore the whole dump over newer warehouse work. Do not rerun or modify this correction for another item.

## Publication boundary / remaining gaps

The individual data correction is applied. The general API change is prepared locally, not deployed to live API or pushed in this task.
Proposed PR base: fix/sorting-recorded-source-20260908. No APK rebuild required by this change.
Physical handheld UI was not automated; existing MOVE/session API contract is unchanged.
