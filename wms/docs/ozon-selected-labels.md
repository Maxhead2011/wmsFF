# Selected Ozon label reads

Prepared 25.11.2026 for our WMS. PR/publication proof is recorded after verification.

Printing a selected Ozon posting previously fell through the WB-only reader into
`resolveSelectedFbsOrders` / `loadFbsOrders`, loading all client marketplace orders,
history and operational synchronization before obtaining the requested label.

`ozonLabelOrders` now validates the selected active cabinets under `clientId`,
deduplicates cabinet/posting pairs and reads only `/v3/posting/fbs/get` for those
postings. Identity and printable live status are mandatory. Existing paired-label
generation still validates product/barcode/marking and fetches official Ozon PDFs.
Request-local snapshots are reused; ribbon evidence and printer ACK logic remain.

The existing `WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED` gate preserves the disabled
path. WB continues through its selected reader; mixed/other selections retain the
existing fallback. Sold WMS is not deployed. No warehouse, picking, billing or
marketplace status writes are added by this optimization.

Source: `ozon-label-orders.ts`, `MarketplaceConnectionsService.resolveFbsLabelOrders`.
Tests: `test/ozon-label-orders.spec.ts` (selected-only fetch, duplicates, foreign
cabinet, current identity/status, feature-off), `wb-label-read-path.spec.ts`.
`scripts/releases/ozon-selected-labels/build.cjs` performs a guarded two-file API
overlay on the current runtime; source parity remains false. Web is unchanged.
`runtime-test.cjs` exercises the complete compiled handler for3299 and3290 while
prohibiting full refresh and business writes. Candidate results:3299 three pages
in1393ms;3290 eleven pages in1186ms, no warnings. These are observed timings, not
a guarantee of Ozon/CDN latency. No physical print jobs are submitted by tests.
