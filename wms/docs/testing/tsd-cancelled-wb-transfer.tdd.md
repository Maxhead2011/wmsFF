# Live WB cancellation check during TSD physical transfers

User request: when a TSD box-to-storage-box transfer is blocked by a reserved/shipping KIZ, verify the linked WB order live instead of trusting an obsolete WMS status.

## Scope / isolation

- `stock-operations.service.ts`: `inspectTsdTransferItem`, `executeTsdTransfer`, `prepareCancelledStorageBoxTransfer`, `resolveStorageBoxTransferItem`, transfer-only types.
- `cancelled-wb-transfer.ts`: isolated, read-only eligibility and live WB status check; transaction-time local revalidation.
- Enabled only with `WMS_TSD_CANCELLED_WB_TRANSFER_ENABLED=true`. Default off, ordinary transfers and sold installations unchanged.
- No Android, web, dependencies, schema or migrations changed.

Only physical transfer is authorized by cancellation: source AVAILABLE quantity -1, destination +1, existing mark location updated in the same Serializable transaction. Its SHIPPING/RESERVED status remains unchanged. Shipment, order, reservation history and resale restrictions are not deleted or reset. No WB cancellation/metadata writes. A successful movement includes an audit with operator, source/destination, order, checked status/time and prior mark location/status.

This is NOT a general return-to-sale workflow or a repair of all historical order-link synchronization. The stale order link itself is not rewritten by this change.

## Eligibility

- Physical source is authorized by the existing warehouse/client and barcode checks; there must be an unassigned available unit.
- Known KIZ must belong to the same SKU/client/branch, with SHIPPING or RESERVED status.
- Exactly one linked WB assembly, matching shipping/printing history. Ambiguous ownership, other orders, repeat-assembly archives and competing source tasks remain blocked.
- Read only `POST /api/v3/orders/status` for that order/cabinet, timeout 4 seconds. No network call in a stock transaction.
- Explicit WB cancellation required: supplier `cancel` or `complete`, WB `canceled`, `canceled_by_client`, `declined_by_client`. Sold, waiting, unknown, missing/duplicate response, HTTP errors/timeouts fail closed.
- Check again on execution; proof is server-local, expires after 15 seconds and cannot be supplied by the TSD payload.
- Re-read local ownership inside the transaction; reject any changed mark/task/history fingerprint. Optimistic mark update and audit must both succeed or the entire transfer rolls back.
- After a recorded physical MOVE, require the current source location even if another idempotency key is submitted.

## TDD evidence

Journeys derived from the reported case, no external plan file.

From `apps/api`:

`node node_modules/vitest/vitest.mjs run test/tsd-storage-box-transfer.spec.ts --maxWorkers=1 --minWorkers=1`

- Initial RED: 12 failed, 91 passed. Stale SHIPPING blocked before the required WB check.
- Initial GREEN: 103 passed.
- Additional retry RED: 1 failed, 103 passed. A second operation key could consume another unit for the same relocated mark.
- Retry GREEN: 104 passed.

`node node_modules/vitest/vitest.mjs run test/cancelled-wb-transfer.spec.ts test/tsd-storage-box-transfer.spec.ts --maxWorkers=1 --minWorkers=1`

- 132 passed: WB contract/error/ownership tests and real-service transfer tests with transactional mocks.
- Full API: 900/900. Web: 34/34.
- API/web TypeScript lint/noEmit and builds: exit 0. Existing web bundle-size warning remains.
- `git diff --check`: passed. No production credentials in code or logs.
- Coverage provider unavailable; no coverage percentage claimed.
- No RED checkpoint commit because repository rules require the full suite green before commits.

## Read-only real-case verification

The compiled new guard was executed in a separate diagnostic process against existing production data and the live WB status endpoint. Only that process had the feature flag enabled; the running application was NOT changed/enabled.

- Source `FFL_LKB1007_137`, available quantity 1.
- Order `5544665829`: `cancel / canceled`.
- Result `ELIGIBLE_FOR_PHYSICAL_TRANSFER`; preserved mark status SHIPPING.
- No movement, stock, mark, order or history writes performed by the diagnostic.

## Handoff

Branch: `fix/tsd-cancelled-wb-transfer-check`.
Proposed PR target: `fix/fbs-box-scan-route-consistency` (WMSFF2207 release branch).
Not published/enabled in production in this task. Before rollout test the exact current-image overlay (stock module plus new guard), preserve all other image modules and settings, then enable the flag only for WMSFF2207. Rollback must never restore stock from a snapshot over employees' subsequent movements.
