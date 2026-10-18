# Explicit first WB publication

An explicit enable command failed before sending stock when WB omitted a size from
its stock response, even though its exact barcode was present in the current catalog.

## Scope

`wb-first-publication.ts` validates unique exact barcode identity and orchestrates
zero initialization. The production overlay patches only
`MarketplaceConnectionsService.updateFbsStockPublicationFresh`,
`updateFbsStockPublicationBulkFresh`, `putWildberriesStocks`,
`putWildberriesStocksRaw`, and adds `initializeExplicitWbPublication`.
The source service predates the deployed stock safeguards; do not deploy its full
local build. `scripts/releases/wb-first-publication-20261018/patch.cjs` applies
asserted method edits to the pinned complete runtime, compiling the new helper.
Source parity remains false.

Initialization requires an explicit enable command, existing fine-stock deployment
flag and linked-client flag, no active allocation policy, an active matching WB
connection, connected CENTRAL/DIRECT route, enabled publication and a unique fresh
catalog match against physical SKU barcodes. Sold/legacy clients retain the old path.

Unknown before remains unknown in history. The service sends zero, verifies the
actual zero, then uses the unchanged normal publication plan (reserves, safety
buffer and limits). Existing account locks, stock-control gate, catalog blocks,
fresh-plan guard and immutable publication history remain active. Initialization
never authorizes a missing row for a positive write. A concurrently appearing
nonzero stock aborts initialization. There are no write retries after uncertain
responses. Failure after zero may leave a safe zero, requiring a new explicit action.

## Validation

- Regression on actual pre-fix production code fails with `Error: missing` before PUT.
- `wb-first-publication.spec.ts`: 10 unit cases, exact identity/ambiguity, read/audit/
  catalog failure, unknown or nonzero verification, malformed observations, no write retry.
- `smoke.cjs`: actual-image 11 cases, explicit zero then positive, automatic and
  legacy rejection, allocation guard, timeout, known amounts, ACK without verification,
  excluded route, both manual call sites, real catalog/physical identity path.
- Complete API and web tests, API TypeScript, exact two-file baseline delta required.

Base API `sha256:f91615a1ae1b64f6ee99a1595061463977eff193dc036f74263ccf105e1ca6de`,
web `sha256:17d48a4b29beb5f889db8aa0ae233e5ef8bc5b5c219024ac09d01c083c2ddefc`.
No schema, stock, reservations, web, APK or environment changes during deployment.
User-authorized Kubrin publication is a separate native service command after release.

Published PR637 on 2026-10-18. API sha256:cc67e61c67e7b91b57103ab2f7822d46acf6a9da7f340f80fdd20a70b7744b04.
Live WB read confirmed 41 positions (40 positive), 968 units; one order reserve and 121 safety units preserved.
