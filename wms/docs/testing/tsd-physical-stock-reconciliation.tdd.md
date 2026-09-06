# TSD physical-stock reconciliation — first stage, 2026-09-06

## Scope and isolation

Branch: `fix/tsd-physical-stock-reconciliation`, from `fix/permanent-boxes-live-deploy` (`89cb7f4`).
WMSFF2207 only. No production stock changes, deployment, migrations, Android changes or FFULHAB changes in this task.

The new behavior requires `WMS_TSD_PHYSICAL_STOCK_RECONCILIATION_ENABLED=true`. It is disabled by default.
Client-role users cannot perform recovery. Existing client/warehouse write scope and inventory-lock checks remain in place.

## User journeys implemented

1. Open an existing zero-balance/archived source box without writing anything.
2. Scan the client's marked SKU barcode, then a physical KIZ. Catalog lookup and inspection remain read-only.
3. With a zero quantity and no ownership/history conflicts, scan a storage destination: restore exactly one unit and move it in the existing Serializable transaction.
4. Reuse an existing AVAILABLE same-SKU mark (including a proven empty previous box of the same client/warehouse), or register a previously unknown mark at the destination.
5. Save employee, device, barcode, KIZ, source, target, before/after quantities, previous mark, movement and operation identity in `TSD_PHYSICAL_STOCK_RECOVERY` audit.
6. Reject duplicate identities, conflicting statuses/SKUs/clients/warehouses, nonzero source/old-box balances, active tasks, shipment/print/attempt/circulation history, and a second restoration of the same identity.
7. Preserve retries across flag enable/disable; fingerprinted operations cannot be replayed with another worker, scan or destination.

## What is NOT implemented in this stage

- No full-SKU recount dialog, no automatic retirement/replacement of a different AVAILABLE KIZ when the numeric balance is occupied.
- No new manager resolution queue or bulk automatic correction of historical stock.
- No new zero-stock cancellation/return acceptance. Existing WB cancellation checks for normal stock transfers remain unchanged; disputed restoration is blocked.
- No zero-stock recovery in `KIZ_TO_STORAGE_BOX` or batch transfer: the physical source must be explicitly scanned.
- No real-device or concurrent PostgreSQL integration test. Transaction rollback is exercised through the service's stateful test adapter; Serializable isolation and identity-based uniqueness are checked, but a staging concurrency pilot remains required before enabling production.

These are deliberate limits of the first stage, not claims that the entire proposed reconciliation workflow is complete.

## Repeated deduction investigation

Read-only ledger inspection confirmed that requests 619 and 629 contained an AVAILABLE physical pick and another AVAILABLE deduction at closure on September 4–5.
The current base already includes `readFbsPickedStockProof` and `planFbsSafeManualShipment` protection. Its 20 existing tests pass (11 double-consumption + 9 proof tests). That code was not rewritten in this change. Historical balances were not reconstructed wholesale.

## TDD evidence

- Runtime RED: two newly added entry tests rejected empty source opening/catalog-barcode inspection with the original `нет доступного товара` error (170 other targeted tests passed).
- Policy test suite initially referenced the missing new module; that import failure is NOT counted as runtime RED.
- Additional runtime RED: old-box active task was incorrectly accepted; added guard made the same test pass.
- Additional runtime RED: legacy retry after enabling the flag failed, and changed-payload retry after disabling the flag was accepted; fingerprint compatibility changes made both pass.
- Targeted GREEN: 180 tests across `tsd-storage-box-transfer.spec.ts` and `tsd-physical-stock-reconciliation.spec.ts`.
- Native compiled-policy coverage: 7 tests; 100% lines, branches and functions for `dist/modules/stock/tsd-physical-stock-reconciliation.js` only, NOT for the entire service/application.

The user's green-before-commit rule takes precedence over the skill's suggested RED checkpoint commit. RED evidence is retained here; no failing-test checkpoint was committed.

## Commands

Run from `apps/api`:

```powershell
node node_modules/vitest/vitest.mjs run
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node ../../node_modules/typescript/bin/tsc -p tsconfig.json
node --test --experimental-test-coverage --test-coverage-include='**/dist/modules/stock/tsd-physical-stock-reconciliation.js' --test-coverage-lines=80 --test-coverage-branches=80 --test-coverage-functions=80 test/tsd-physical-stock-reconciliation.coverage.cjs
```

Run from `apps/web`:

```powershell
node node_modules/vitest/vitest.mjs run
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node node_modules/vite/bin/vite.js build
```

The configured pnpm wrapper attempted an implicit dependency reinstall and failed with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. Existing local Vitest/TypeScript/Vite binaries were used directly; dependencies and lockfile were not modified.

Final full API suite: 1187/1187, 140 files. Web tests: 53/53. Native compiled-policy tests: 7/7. API/web type checks and builds passed. Web build retains warnings about two Jura fonts, the warehouse hero image and chunk sizes; unrelated assets were not changed.

## Release / rollback

No publication or activation performed. Use a PR into the verified WMSFF2207 production line, not the sold-VM branch. Stage-test the source → barcode → KIZ → destination journey and concurrent duplicate submissions before enabling the flag. Preserve all current production flags and existing deployment safeguards. Disable this new flag to stop new recoveries; already committed ledger/audit records remain and must not be erased.
