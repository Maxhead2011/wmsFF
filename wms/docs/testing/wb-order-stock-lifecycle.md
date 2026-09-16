# WB: reservation, physical shipment and billing

## Contract

- Incoming active WB orders (`new`/`confirm`) reserve branch stock before a WMS request exists.
- A WB order and its linked active WMS request describe the same demand. Count it once, including the interval before the AUTO assembly is rebound to the request.
- Cancellation releases an untouched reservation. A concurrent physical scan must not be erased by cancellation.
- A proven physical pick removes AVAILABLE stock; PACKING is not free stock and must not reserve AVAILABLE again.
- The first successful SOS WB 2 print-agent acknowledgement records local shipment. Queueing, clicking Print, and print failure do not. Reverse WB shipment confirmation is another trigger for the same assembly.
- Stock consumption, KIZ shipment history and a durable shipment fact commit atomically. Request/task locks serialize concurrent shipment and manual request closing. A shortage rolls back the complete transaction.
- The shipment fact freezes request, branch, quantity, order snapshot, assembly evidence and shipment time. A later WB cancellation, return, disappearance or supply change cannot undo this work.
- Billing uses these facts, including during retry after an interruption. It creates drafts ready for issue; it does not automatically issue/send an invoice to the client.
- An explicitly created repeat assembly is NEW physical work. It gets its own shipment fact and processing identity and a separate invoice. Original shipment/charges stay intact. Reprinting the same assembly does not create work or another charge.
- No fabricated AVAILABLE stock: a WB shipment without local pick/history evidence is reported for reconciliation, not silently deducted from another physical source.

## Files / impact

| Area | Files and functions |
| --- | --- |
| Durable evidence | `prisma/schema.prisma`, migration `20260916010000_wb_order_stock_lifecycle`: reservation warehouse, `WbOrderShipment` |
| Shared calculation | `common/stock/wb-order-stock-lifecycle.ts`: `calculateWbFreeStock`, `wbReservationQuantities`, `finalizeWbOrderShipment` |
| Marketplace / print | `marketplace-connections.service.ts`: reservation sync, stock publication calculation, print acknowledgement, shipment reconciliation and billing inputs |
| Billing | `completed-fbs-billing.ts`: charge only shipped facts, independent identity for explicit repeats |
| Availability | `client-requests.service.ts`: preview stock/reservations; `stock-balances.service.ts`: separate physical `quantity` and `freeQuantity` |
| Whole request operations | `stock-operations.service.ts`, `fbs-picked-stock-proof.ts`: exclude already shipped quantities and sources; retain full package composition; no duplicate FBS fulfillment charge |
| Client UI / export | `api.ts`, `ClientCabinetPanel.tsx`, `clientCabinetStockExcelExport.ts`: use the same free stock and do not subtract active requests twice |
| Release adapter | `permanent-return-live-adapter.cjs` and test: update expected function hashes; unknown source versions are still rejected |
| Rollout | `.env.example`: `WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED=false` |

Sold WMS: flag is off by default. Existing branches remain covered by the full regression suite; schema changes are additive. Do not enable the flag in sold WMS. These changes do not deploy themselves or recalculate production data.

## Automated verification

Verified locally on 2026-09-16: API **2624/2624**, web **202/202**, API/web production builds passed. Vite reports existing static asset/chunk warnings; no new build error. No production data was modified.

New/extended tests contain `// TEST`; changed logic is marked `// FIX`.

- `wb-order-stock-lifecycle.spec.ts`: demand, deduplication, cancellation, picked/terminal orders, nonnegative free stock.
- `wb-order-stock-lifecycle.integration.spec.ts`: **30 cases on real local PostgreSQL**, incoming `new` orders, AUTO linking, branch isolation, SQL migration/backfill, concurrent acknowledgements, missing proof, transaction rollback, partial/whole request close, SHIPPING-stage stock, ordinary WMS picking, relabeling, stock preview/export consistency, immutable invoices and separately billed repeats.
- `completed-fbs-billing.spec.ts`: shipment before billing, shipment evidence survives task reset, repeat work gets another processing invoice exactly once.
- `clientCabinetStockExcelExport.spec.ts`: unified free stock, no PACKING stock, no double reserve, flag-off legacy behavior.
- `permanent-return-live-adapter.spec.ts`: adapter still validates exact supported source functions.

Run from `wms/` (URLs deliberately point only at dedicated local databases):

```powershell
$env:WB_LIFECYCLE_TEST_DATABASE_URL='postgresql://codex_tests@127.0.0.1:55469/wb_lifecycle_tests'
$env:KIZ_DUPLICATE_TEST_DATABASE_URL='postgresql://codex_tests@127.0.0.1:55469/kiz_duplicate_tests'
pnpm --filter @logoff/wms-api exec vitest run --maxWorkers=4 --minWorkers=2
pnpm --filter @logoff/wms-web exec vitest run
pnpm -r build
```

The lifecycle integration suite rejects any other database URL. Migration verification uses an isolated temporary schema. Fixtures use random identities in the dedicated database, not live data.

## Release order

1. Review PR into the current deployment branch `fix/fbs-transfer-started-at`. Release only after user approval.
2. Back up the database; apply the additive migration and regenerate Prisma before starting the new API. Keep the flag disabled during migration.
3. Reconcile existing reservations without a warehouse (migration uses request warehouse, then physical/reserved box warehouse). Resolve missing WB warehouse routes rather than guessing a branch.
4. Review historical successful prints and shipped requests against physical movements. The reconciliation pass can finalize proven legacy work without another stock deduction, using shipped KIZ history or a fully shipped DONE request. Missing physical evidence requires investigation.
5. Enable only our WMS; refresh WB orders so `new` orders without assembly requests participate in the free balance. Validate one real order through reservation, pick, print ACK, shipment history and invoice draft. Validate that failed/queued printing does not ship stock.
6. Compare cabinet export and request preview for the same client/warehouse/SKU. Check cancellation before pick, cancellation after shipment and an explicit repeat request separately.

Once shipment facts have been written, rolling back must preserve their interpretation. Merely disabling the flag re-enables old request-closing behavior and is **not** a safe data rollback. Keep the compatible API/flag enabled while repairing a release; do not delete shipment facts or replay stock deductions.


## Approved live adaptation (2026-09-16)

The release retains PR150 KIZ identity changes and the existing live WB accounting module. `infra/releases/wb-order-stock-lifecycle/live.patch` contains the exact overlay; `manifest.json` verifies normalized source SHA256 before applying it. The sold installation must not use this live overlay or enable the flag.

- Legacy WB shipment and its migrated lifecycle fact credit a request exactly once. A PostgreSQL regression reproduces the double credit without the live compatibility filter.
- Terminal WB links do not retain unpicked stock demand; an explicit emergency repeat still reserves.
- A previous shipment does not hide an active repeat assembly during WB reconciliation.
- Work completed after its supply invoice is issued, paid or consolidated receives a separate invoice, using stable assembly identity. The issued invoice stays unchanged, and repeated acknowledgement does not duplicate the new invoice.
- Local builds and the complete PR suite pass. Live-source lifecycle/billing regression suite: 80/80; web baseline was rebuilt and verified byte-for-byte against the current running assets before generating the updated interface.
- Historical reconciliation is rehearsed on an isolated copy of the live database before activation. The database backup and rehearsal artifacts stay private in the server release directory; no client data is committed here.


Historical backfill uses `import-legacy.sql` / `import-legacy.cjs`. It imports only `LEGACY_WMS_SHIPMENT` facts from the rehearsal artifact after SHA256 verification, and requires unchanged task timestamp and exact existing shipped-KIZ history in the target database. It writes neither stock movements nor billing rows, and duplicate assembly imports do nothing. Changed rows remain for normal reconciliation. A real PostgreSQL test covers success, repeated import, altered history and changed task.

The deployment overlay uses zero-context hunks; apply only after checking `manifest.json`, with `git apply --unidiff-zero`.

Large-client regressions cover PostgreSQL bind limits (33,000/40,000 historical tasks), bounded shipment JSON pages, compact product/request evidence, and processing credits across old supply identities for turnkey clients. Splitting an invoice retains the physical processing identity and cannot duplicate a completed-work credit. The full API suite currently passes 2,634 tests; web suite: 202.

Migration never reprices imported `LEGACY_WMS_SHIPMENT` history. Existing calculator charges and invoices (including drafts) retain their original composition and prices; later work uses a separate assembly-based invoice identity. Prior processing and daily logistics are credited across old supply/date identities. A fresh production-data rehearsal must pass an unchanged-history and duplicate-charge audit before activation.
