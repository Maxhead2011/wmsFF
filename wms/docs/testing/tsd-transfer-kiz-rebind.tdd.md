# TSD transfer: rebind stale SKU metadata after barcode/KIZ scans

## Scope and journey

User request: during a transfer, use the physically scanned product barcode to
correct a KIZ attached to the wrong SKU, then allow the unit to move.
Branch: `fix/tsd-transfer-kiz-sku-rebind`, starting at `b8ce4b6`.
Only WMSFF2207; do not deploy to FFULHAB/sold VM without a separate review.

## Implementation

- `StockOperationsService.bindMissingTsdTransferKiz`: existing Android sends the
  SKU returned after scanning the barcode. Reconcile the existing mark under
  the existing serializable transaction, with a user/device audit. No quantity
  changes during this step. Existing batch/single transfer then moves the unit.
- `resolveStorageBoxTransferMark`: permit stale SKU metadata in the physical
  source box or a verified empty old box of the same client/warehouse. Check
  the selected SKU's available mark capacity, both SKUs' active tasks, mark
  status, assembly, shipment history and sticker-print references.
- `executeTsdTransfer`: storage-box mode keeps inspection read-only; correct
  SKU and destination box in the movement transaction with optimistic matching
  against the previous SKU, box and update timestamp. Audit old/new SKU.
- No database migration, Android change, new stock receipt, mark duplication,
  deletion of other marks, or adjustment of old SKU balances.
- Deliberately still reject another box with nonzero old stock, foreign or
  unknown client/warehouse, reserved/shipped/order-linked KIZ, insufficient
  source stock or a source whose units already have other marks.

## RED / GREEN evidence

Command from `wms/`:

```text
pnpm --filter @logoff/wms-api test test/tsd-storage-box-transfer.spec.ts
```

RED before production edits: 7 failed / 43 passed. Ordinary transfer reproduced
`Этот КИЗ уже привязан к другому товару или коробу. Перемещение остановлено.`;
storage-box mode reproduced `КИЗ не соответствует отсканированному ШК товара.`

GREEN after the fix: 50/50 passed, then 56/56 after batch/guard coverage additions.
Tests exercise real service methods against an in-memory database fixture,
including simulated transaction rollback; these are not live PostgreSQL tests.

| Guarantee | Test group | Result |
| --- | --- | --- |
| Read-only storage-box inspection accepts stale SKU; execution moves only the scanned SKU | TSD storage-box transfer | PASS |
| Legacy barcode/KIZ correction changes one existing mark, writes an audit, changes no quantities | physical barcode/KIZ rebinding | PASS |
| Single and Android batch transfer move one unit; retries do not duplicate movements | transfer and rebinding groups | PASS |
| Old/new SKU, box, user and device remain traceable | reconciliation audit assertions | PASS |
| Foreign branch, old stock, missing/unknown SKU and full mark capacity block correction | insufficient evidence cases | PASS |
| Orders, shipment history, print records and reserved/shipping marks stay protected | protected mark cases | PASS |
| Audit failure/concurrent mark update abort correction; storage mode rolls back stock too | rollback cases | PASS |
| Existing empty-box reconciliation, raw GS/crypto values and destination checks remain valid | stale KIZ reconciliation | PASS |

Other validation:

- `pnpm --filter @logoff/wms-web test`: 32/32 PASS.
- `pnpm --filter @logoff/wms-api lint`: PASS (TypeScript no-emit).
- `pnpm --filter @logoff/wms-api build`: PASS.
- Full API run after initial fix: 583 passed / 75 failed. Failed test names
  exactly match the saved pre-change release report (573 passed / 75 failed).
- Final full API run: 589 passed / 75 failed; failed-name difference from the
  pre-change release report is zero. Local result:
  `C:/WMSFF2207/tmp/tsd-kiz-rebind-tests-20260904.json`.
- `git diff --check`: PASS.

## Gaps and release gate

No physical TSD or production database mutation was used for verification.
Coverage percentage is not claimed: no Vitest coverage provider is installed;
no dependencies were added for this surgical fix. Native device end-to-end and
real PostgreSQL concurrent transactions remain unverified.

No RED checkpoint commit was made: the user's explicit rule prohibits committing
with failing tests. Full-suite failures prevent claiming a completely green
release gate. After disclosure, the user approved proceeding with publication
on 2026-09-04 ("делай"). The exception covers only the identical 75 baseline failures.
Deploy only the transfer patch: production has an unrelated overweight-package
warning fix in the same file which must remain intact. Keep an image/file backup;
validate patch applicability before changing the runtime. No schema migration.
Proposed PR target: `baseline/our-vm-production-20260827`, consistent with the
preceding WMSFF2207 release. Include the shared stock-service scope warning.
