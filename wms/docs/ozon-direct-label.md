Published PR701 / 2026-10-27: selected Ozon FBS labels avoid full marketplace/history reload. Exact2 API files; WMS_OZON_DIRECT_LABEL_ENABLED=true in our API image only. API3748/web510 passed,155/2 skipped; dedicated KIZ DB suite unavailable. TypeScript, candidate runtime/module graph, live health/hashes and read-only request2461 PDF passed (417ms,72205bytes). Baseline `2026-10-27-ozon-direct-label`; sourceParityVerified=false. Web/APK/schema/sold WMS/business records unchanged.

# Selected Ozon FBS label download

Published through PR701. Branch `fix/ozon-label-download`, target `feature/wb-print-check`.

Request 2461, posting 01998160-1562-1: a read-only live PDF request returned HTTP200, 72,205 bytes in191ms on2026-10-27. Existing `getFbsOrderStickersPdf` first called `resolveSelectedFbsOrders`, which reloads all active marketplace connections and full history, including billing synchronization. The probe demonstrates the PDF was ready; no end-to-end latency of the earlier user's request is claimed.

`ozon-direct-label.ts` skips this full load only when all selected connections are Ozon and `WMS_OZON_DIRECT_LABEL_ENABLED=true`. Client access remains checked first. Active cabinet ownership is verified in DB, current posting identity/status is read directly from Ozon, only selected postings are downloaded. Unique selection, batches of20, 20-second status/30-second PDF timeouts. WB/mixed selections retain original behavior. No inventory, status, billing or shipping mutations. Sold WMS keeps the flag absent/disabled.

Regression `ozon-direct-label.spec.ts` failed before fix due to full reload;8 scenarios pass afterward: PDF, cabinet scope, cancelled/not assembled states, identity mismatch, disabled/mixed fallback, dedup/timeouts and access before lookup. API3748 passed/155 skipped; web510/2; TypeScript API passed. Dedicated KIZ integration excluded: database unavailable.

Release scripts patch only one live service method plus new helper; remaining methods are byte-preserved. `patch.cjs` asserts exact method delta. `runtime.cjs` exercises actual candidate with isolated fake transport, valid PDF and no DB/network writes. Published baseline:2026-10-27-ozon-direct-label.
