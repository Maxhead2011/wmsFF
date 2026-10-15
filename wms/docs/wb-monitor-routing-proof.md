# WB monitoring: routed warehouse and reservation proof

Prepared 2026-10-15; **not published**. Branch `fix/wb-monitor-routing-proof`, proposed PR target `feature/wb-print-check`.

## Problem and change

Monitoring used the connection's default WMS branch for every WB warehouse, including BRANCH and EXCLUDED routes. A WAITING_STOCK assembly counted as an exact reservation. Aggregate decreases from unrelated orders could also mask the missing reservation.

With `WMS_FBS_MONITOR_ROUTING_ENABLED=true`, monitoring resolves the warehouse from current routing. EXCLUDED/unrouted warehouses are filtered before pagination, totals, ingestion and worker claims. An explicit BRANCH route uses its own warehouse. Exact reservation confirmation requires matching SKU, sufficient quantity, reservation timestamp, a reserving status, and the same stock warehouse. RETURN_REQUIRED is not proof of a released reservation. Historical SUCCESS is re-evaluated on an explicit recheck; historical records are not bulk rewritten.

The flag defaults off. No publication algorithm, stock balance, warehouse route or order reservation is changed by this patch. Existing installations without the flag retain their policy.

Files/functions:

- `fbs-monitor-routing.ts`: route resolution, exact reservation proof, SQL scope.
- `marketplace-connections.service.ts`: `probeFbsStockMonitoring`.
- `fbs-stock-monitoring.service.ts`: `ingestOrders`, `list`, `runChecks`.
- `fbs-stock-monitoring.rules.ts`: `evaluateFbsStockMonitorWms`.
- `test/fbs-monitor-routing-proof.spec.ts`: source and actual runtime regressions.

## Read-only stock audit

Audit performed approximately 22:04–22:14 MSK on October 15. WMS quantities were read in read-only repeatable-read transactions; WB quantities were fetched uncached. A missing WB response is **unknown**, never assumed to be zero. Snapshots are not atomic across WMS and WB.

| Cabinet | Scope and result |
| --- | --- |
| Lukin CL-000001 | 2,409 matched sizes returned on each of seven actively allocated warehouses. Aggregate WB stock 2,641 units. No SKU exceeded free WMS stock, including the configured safety reserve: 3 units, replaced by 1 unit when free stock is below 5. |
| Balandin | WB returned 3 of 8 matched sizes. Two managed publications: 71 and 46 units, matching free WMS. A third, unmanaged SKU had WB 3 / WMS 0. |
| Vitkovsky | WB returned 7 of 20 matched sizes, 23 units total. No returned stock exceeded free WMS. |
| Kubrin | WB returned 3 of 1,438 matched sizes, 113 units total. No returned stock exceeded free WMS. |

Lukin's seven allocation warehouses: 1693195, 1954119, 1935300, 1935327, 1954106, 1935331, 1935323. Two DBS routes returned only one zero row each; coverage is incomplete. Routes 2251779 and 2271741 return HTTP404 with the Lukin connection; these IDs are valid under Vitkovsky and Kubrin respectively. They are not included in Lukin's allocation shares and were not changed. Novosibirsk4 is a separate BRANCH route; Krasnodar is EXCLUDED. Their stocks must not be compared to Moscow or changed through Moscow's allocation.

259 stored publication errors correspond to **37 distinct missing-catalog SKUs × 7 warehouses**, all `WB_CATALOG_MISSING`. They are outside the 2,409 successfully checked matched sizes. Current catalogue reconciliation of these 37 SKUs remains a separate unresolved item; this audit does not certify them or re-enable them.

## Explicitly approved production correction

User approved zeroing and stopping Balandin barcode `2054125345018`, SKU `1a64f76b-d9ea-4a42-b3c7-d605be39868c`, chrtId `1947049894`, warehouse `2023080`.

At 22:16:31 MSK the existing `updateFbsStockPublication` service recorded `enabled=false` and published zero. An uncached WB reread confirmed **3 → 0**. Publication ID `7a95fe0b-0008-487d-b0c0-95cb6cf5c2c5`, no lastError. The ordinary audit log and publication verification were retained. WMS balances and reservations were not changed. The explicit stop remains until manually re-enabled.

## Verification and release preparation

Four regression tests failed before the fix (WAITING_STOCK, BRANCH, EXCLUDED, wrong-branch reservation). All 13 new scenarios pass on source and the fresh production candidate, including historical SUCCESS recheck. Full API: 3,459 passed / 155 skipped (two dedicated KIZ DB suites excluded); web: 442 passed / 2 skipped. API TypeScript and baseline verification passed.

Fresh production captured during this work: API `sha256:c1f2ad806419a71c1cdc51393804705eaa6afdde6e5268dec42cda36a675c078`, web `sha256:80a153ed4e09f7d6dc00310aac8bcc85910ca8d4974fd37239d62fa8d607c5ee`, APK233. Source parity remains false.

`scripts/releases/wb-monitor-routing/patch.cjs` asserts unchanged live methods before applying exactly four API-module changes. It preserves production BigInt adapters and all unrelated code. [Prepared delta](releases/wb-monitor-routing-prepared.json). This script does not deploy. Before publication: combine through a reviewed PR, recapture the latest production, rerun assertions/runtime tests, enable the flag only in our API image, and recheck selected historical monitor events. No full local API replacement is permitted.
