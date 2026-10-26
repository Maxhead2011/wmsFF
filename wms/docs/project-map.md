Prepared Lamoda icon correction: shared 84px brand badge with the user-supplied la icon and official lowercase SVG wordmark. Five-file runtime overlay; local assets avoid external image requests. Only FBO tile presentation; API, schema, permissions and sold WMS unchanged. Source regression reproduced before fix; web503 passed/2 skipped; candidate browser11 passed. Runtime patch: `scripts/releases/lamoda-icon-20261026/`; browser: `scripts/tests/lamoda-icon-browser.cjs`.

Published PR691 / 2026-10-26: isolated Lamoda preparation workspace (FBO → Lamoda), encrypted OAuth, read-only sync, manual product links, Excel drafts and availability preview. Assembly/TSD, stock publication and shipment writes remain unimplemented. API3682/web502 passed;150/2 skipped; dedicated KIZ suites excluded. Real PostgreSQL migration,10 candidate DB scenarios, full isolated API health,10 candidate/public browser scenarios and read-only production checks passed. Nine API/four web delta, five additive tables, server-only encryption key. Baseline `2026-10-26-lamoda-preparation`, sourceParityVerified=false; sold WMS/APK unchanged. [Scope](lamoda-contour.md).

Modules / PR691: Lamoda preparation lives in `apps/api/src/modules/lamoda/`, five additive Prisma tables, `apps/web/src/components/lamoda/`, and the gated FBO workspace entry. Existing request service is exported only for scoped availability preview. Registry: `administration-internal-api.service.ts`. No marketplace stock/assembly workflow is enabled or completed by this stage. [Details](lamoda-contour.md).

Published PR689 / 2026-10-26: multi-shop WB/Ozon group drafts and canonical SKU assignments. External stock publication NOT enabled; existing writers and legacy pair editor retained. API3643/web497 passed;155/2 skipped; dedicated KIZ DB suite excluded. TypeScript,8 candidate API checks,15 candidate/public browser scenarios and read-only live reads passed. Exact5 API/4 web delta. Baseline `2026-10-26-multishop-groups`, sourceParityVerified=false. Rollback `logoff-api:before-multishop-groups-20261026` / `logoff-web:before-multishop-groups-20261026`. [Details](multishop-stock-groups.md).

Published PR687 / 2026-10-24: catalog sorting by article/color/physical stock, in-stock and confirmed WB/Ozon-pair filters, scoped pagination. API3617/web497 passed;155/2 skipped; dedicated KIZ DB suites excluded. TypeScript, eight compiled API checks and seven candidate/public-browser scenarios passed with isolated data. Four API/four web files only; stock, operational linking rules, APK, configuration and sold WMS unchanged. Baseline `2026-10-24-catalog-sorting`, sourceParityVerified=false. Rollback tags `logoff-api:before-catalog-sorting-20261024` / `logoff-web:before-catalog-sorting-20261024`. [Details](catalog-sorting.md).

Published PR685 / 2026-10-24: catalog WB/Ozon identities and separate barcodes, scoped administrator enablement and read-only consistency check. API3609/web496 passed;155/2 skipped; dedicated KIZ DB suites excluded. TypeScript, eight compiled API checks and six candidate/public-browser scenarios passed with isolated data. Four API/three web files only; stock, operational linking rules, APK, configuration and sold WMS unchanged. Baseline `2026-10-24-catalog-overview`, sourceParityVerified=false. Rollback tags `logoff-api:before-catalog-overview-20261024` / `logoff-web:before-catalog-overview-20261024`. [Details](catalog-marketplace-overview.md).

Published PR683 / 2026-10-24: removal accepts complete audited FBO returns/transfers without erasing historical scans. Current physical/print/delivery guards retained. API3604/web487 passed,150/2 skipped; dedicated KIZ DB suites excluded. TypeScript, exact two-file candidate delta, module graph and candidate/public read-only preview2367 passed (allowed=true). API sha256:6c684dd449ec2fed17aeece99b2d81d2af314cac3ee057103a0094f18556cd1c; web unchanged. Baseline `2026-10-24-returned-fbo-removal`, sourceParityVerified=false. Sold WMS and business records unchanged. [Details](request-removal.md).

Published PR681 / 2026-10-24: seven FBS tiles, penalties inside problem orders, large active-orders tile beside two rows of three. Existing stock hub, reports and permissions retained. Web487/API3590 passed; 2/155 skipped, dedicated KIZ DB suite excluded; TypeScript, candidate/public browser geometry and 8 baseline guard tests passed. Three-file web overlay; API/APK/config/business data/sold WMS unchanged. Baseline `2026-10-24-fbs-seven-menu`, sourceParityVerified=false. Rollback `logoff-web:before-fbs-seven-menu-20261024`. [Details](fbs-seven-menu.md).

Published PR679 / 2026-10-24: FBS menu reduced to 8 tiles; stock management, history, cost settings and problem orders grouped. Existing 5-section stock hub and read-only completed orders retained. Web485/API3590 passed; 2/155 skipped and dedicated KIZ DB suite excluded. Source/runtime/public browser checks and TypeScript passed. Exact three-file web overlay; API/APK/config/business records/sold WMS unchanged. Baseline `2026-10-24-fbs-compact-menu`, sourceParityVerified=false. Rollback `logoff-web:before-fbs-compact-menu-20261024`. [Details](fbs-compact-menu.md).

Published PR677 / 2026-10-24: administrative removal of untouched FBO/FBS requests for ADMIN/OWNER. Mandatory reason/number/confirmation, atomic audit, preserved composition and Ozon bindings, durable FBS recreation block. Own-image WMS_REQUEST_REMOVAL_ENABLED=true. API3590/web476, TypeScript, compiled-UI8, isolated PostgreSQL9 and module-graph2 passed;155/2 skipped, unconfigured dedicated KIZ DB suite excluded. Seven-module API/four-file web delta; physical stock, KIZs, other containers and sold WMS unchanged. Baseline `2026-10-24-request-removal`, sourceParityVerified=false. [Details](request-removal.md).

Published PR675 / 2026-10-24: only Gushcha CL-000015 hidden in our-company FBS; Noginsk and other 46 clients preserved. Our-image-only WMS_FBS_GUSHCHA_VISIBILITY_ENABLED. API3564/web476/runtime12/FBS33 passed;155/2 skipped, dedicated KIZ DB suites excluded. Three-module overlay, other containers and business records unchanged. Baseline `2026-10-24-fbs-gushcha`, sourceParityVerified=false. Rollback `logoff-api:before-fbs-gushcha-20261024`. [Details](fbs-gushcha-visibility.md).

Prepared / 2026-10-24: single-client FBS visibility exception for Gushcha CL-000015 in our company. Other clients and show-all semantics unchanged. Default-off WMS_FBS_GUSHCHA_VISIBILITY_ENABLED; Noginsk and sold installation unchanged. Exact overlay verified on fresh live API 027b57a6; older repository baseline is not a deployment base; not published. [Implementation and checks](fbs-gushcha-visibility.md).
Published PR673 / 2026-10-23: FBS WB table checkbox selects all current search/filter results across pages; shop-wide positive-free selection remains separate. Selected/hidden counts and bulk-stop confirmation. Web476/API3564 passed,2/155 skipped; existing dedicated KIZ DB suite unavailable. Nine candidate and public browser scenarios passed with educational API fixtures. Three-file web overlay; all old assets except index retained. API/APK/config/business data/sold WMS unchanged. Baseline `2026-10-23-fbs-filtered-selection`, sourceParityVerified=false. Rollback `logoff-web:before-fbs-filtered-selection-20261023`. [Scope and validation](fbs-filtered-selection.md).

Published PR671 / 2026-10-22: FBO alternative source box validation, LOGOFF APK234. Existing client/warehouse/receipt/reservation/KIZ guards retained. Two API files and three download files over PR669; WMS_FBO_ALTERNATIVE_PICK_ENABLED=true in our image only. API3564/web470/Android265 per flavor passed,155/2 skipped; dedicated KIZ DB suite unavailable. Eight candidate runtime cases and public download hashes passed; published read-only request2284 confirms526/527/528 with unchanged730/747. Physical device scan remains to be checked after installing APK234. Baseline `2026-10-22-fbo-alternative`, sourceParityVerified=false. Rollback tags logoff-api:before-fbo-alternative-20261022 and logoff-web:before-fbo-alternative-20261022. Sold WMS unchanged. [Details](fbo-alternative-picking.md).

Published PR669 / 2026-10-22: FBO picking history retains rows and scroll during polling; no transient loading paragraph above populated table. Source regressions4, candidate/public runtime browser5, web470 passed/2 skipped, TypeScript passed. API3559 passed/155 skipped; existing KIZ integration suite cannot initialise without dedicated DB URL. Exact two-file web overlay on PR667; API/config/stock/sold unchanged. Web sha256:0c70ec6c971bc061ee516eace82da463570b06baf5b1998b5363f1410964d344; baseline `2026-10-22-history-refresh`, sourceParityVerified=false. Rollback `logoff-web:before-history-refresh-20261022`.

Published PR667 / 2026-10-22: modern service menu cards with colored icon backgrounds, compact responsive grid, keyboard focus and reduced motion. CSS-only two-file overlay; API, JavaScript, permissions and sold WMS unchanged. Web466 passed/2 skipped; TypeScript passed; six candidate/public-CSS browser scenarios at1440/768/390 light/dark passed. Actual navigation markup/click handlers retained; test fixture uses placeholder icon paths. Web sha256:dac4d0cbbd175917bac89a3a97b54417b2392d7186d5f3c70514b5363e397a33; API sha256:a44fc2fbb1641fb022ae3902495c3057393d3de737518b7d4cccb33e9ea0ee91. Baseline `2026-10-22-service-tiles`, sourceParityVerified=false. Rollback logoff-web:before-service-tiles-20261022.

Published PR665 / 2026-10-22: original-sticker replacement accepts WB complete/sorted; ordinary repeat still requires complete/waiting. Final/unknown states blocked, actual state shown in errors. API3559/web466, TypeScript, runtime11 passed;155/2 skipped, dedicated KIZ DB suite excluded. Live read-only preview6049802274 succeeded: BOX0205, original sticker59080109672. Exact two-module API overlay; no web/flags/schema/stock/sold changes. Baseline `2026-10-22-original-sorted`, sourceParityVerified=false; rollback logoff-api:before-original-sticker-sorted-20261022.


Published PR663 / 2026-10-22: Service original-sticker replacement for ADMIN/OWNER. HIGH priority, new unit/KIZ consumed once on physical picking, original PNG pinned, first attempt archived. Exact six API modules/two web files over PR661; own-image flags enabled, no schema or business data changes. API3558/web466, TypeScript, isolated PostgreSQL8, runtime8, candidate/public browser4 and live owner capability passed;155/2 skipped, dedicated KIZ DB suite excluded. Baseline `2026-10-22-original-sticker`, sourceParityVerified=false. Rollback tags logoff-api:before-original-sticker-20261022 and logoff-web:before-original-sticker-20261022. Sold WMS unchanged. [Details](fbs-original-sticker.md).

Published PR661 / 2026-10-22: CLIENT stock readers can open turnover Stock (minus requests) and export Excel for their permitted clients. Internal statistics and stock mutations remain restricted. One API module and two web files over PR659; no schema/config/business-data/sold changes. API3551/web466 passed,155/2 skipped; dedicated KIZ DB suite excluded. TypeScript, actual-runtime before/after regression, public runtime and candidate API own/foreign-client checks passed. API sha256:5c63b72b85fd416960409369cb3799d9e8bcb0998dcb73d7e5e8d825dceb95a3; web sha256:df00b7ec0382ab6e7e7c30aa04d4b20b24fa04a4105566c695170da43bb538d1. Baseline `2026-10-22-client-stock`, sourceParityVerified=false. Rollback tags logoff-api:before-client-turnover-stock-20261022 and logoff-web:before-client-turnover-stock-20261022.

Published PR659 / 2026-10-22: CLIENT managers may change receipt FBS/FBO directions within writable client scope; read-only stays disabled. API3550/web465, TypeScript, candidate API11 and candidate/public browser9 passed;155/2 skipped, dedicated KIZ DB suite excluded. Live Svetlana and manager capabilities true; Svetlana read-only client false. Two API modules and two web files; current receipt confirmation, invoice downloads and favorites retained. Baseline `2026-10-22-receipt-manager`, sourceParityVerified=false. No stock/config/schema/APK/sold changes. [Details](receipt-manager-directions.md).

Prepared / 2026-10-22: receipt FBS/FBO directions follow CLIENT writableClientIds for all client managers, not personal grants. API capability and branch checks; UI uses server capability. Read-only/foreign client/foreign branch/demo/disabled installation rejected. Files: receipt-direction-access.ts, receipt-channels.controller.ts, ReceiptDirectionsPanel.tsx; tests receipt-direction-access.spec.ts and receipt-direction-manager.spec.ts. Not published; sold WMS untouched.
Published PR657 / 2026-10-20: Panthera favorites and ordering synchronize per authenticated user. Existing local list imports only into an uninitialised account; explicit empty lists remain empty. Refresh on focus/online and every 30 seconds in visible tabs. Revision conflicts prevent stale overwrites. Three independent browser contexts passed on downloaded public JS, including account isolation and offline recovery; unauthenticated endpoint returns401. Disposable PostgreSQL concurrency proof passed. Web465 passed/2 skipped; API full3538 passed/155 skipped with two registry count failures fixed and targeted46 passed; dedicated KIZ DB suite excluded. API/web TypeScript passed. API sha256:bba911ad88300347e3290bd18af70db1d13e7c782c439175f30db19e06b74f65; web sha256:2c1a0164ba1d0883246d7d8c39d1430557bfd03956733986d3e76b0c5b2a4898. Exact four-module API/two-file web overlays; schema, config, other containers and sold WMS unchanged. Rollback tags logoff-api:before-panthera-sync-20261020 and logoff-web:before-panthera-sync-20261020. sourceParityVerified=false.

Published PR655 / 2026-10-20: receipt-batch list reuses one Moscow date formatter instead of constructing up to50000 in the API event loop. Exact two-module overlay; all other helper callers retain default behavior. Read-only repeatable-read comparison10339ms to2101ms with identical19 batches/50001 units; published handler2178ms. API3537 passed,155 skipped; dedicated KIZ integration suite unavailable (missing DB URL), TypeScript and actual-image1000-row regression passed. API sha256:3c5b5fb80636201167d0c80ce8f286bc6f14e12d76a2a0ca2abf7f38b918f459; web unchanged sha256:88566809fce505f160ef66bb109a5ae5f37b3aebc4b50610c6c8d857a8ba2cec. Rollback logoff-api:before-receipt-date-fast-20261020. No stock/schema/flags/sold changes; source parity false. This is a direct server-handler benchmark, not a full browser/network timing.

Published PR653 / 2026-10-20: scoped modern receipt panel refresh/filter/file buttons; active filter highlighted and modal descendants excluded. CSS-only two-file overlay, all prior assets/API/other containers preserved; sold WMS unchanged. Actual receipt closure browser regression fails before styling and passes seven scenarios; web462 passed,2 skipped. Public hashes verified. Web sha256:88566809fce505f160ef66bb109a5ae5f37b3aebc4b50610c6c8d857a8ba2cec; API sha256:1a961e8f56c6ad3ee53fb8caf0230841fd8e353954ef1bb5a75920e867770c85. Rollback logoff-web:before-receipt-panel-buttons-20261020. Source parity false.

Published PR651 / 2026-10-20: scoped modern FBO separate WB download/footer controls, wrapping and disabled/focus states. CSS-only two-file overlay; all prior assets and API preserved, sold WMS unchanged. Web462 passed,2 skipped; before-fix browser regression fails, candidate/public CSS pass desktop/mobile checks. Web sha256:7e3f764d8becf22773ed6972e3c4f43446ee753898be399de79db34eda808493; API sha256:1a961e8f56c6ad3ee53fb8caf0230841fd8e353954ef1bb5a75920e867770c85. Rollback logoff-web:before-fbo-download-buttons-20261020. Source parity false.

Published PR649 / 2026-10-20: receipt access confirmation renders before server preflight; confirmation remains disabled until validation succeeds and failed validation closes the dialog. Scoped modern buttons and visible checking/saving states. Seven browser scenarios pass on downloaded public JS; prior PR647 fails held-response regression. Web462 passed,2 skipped; TypeScript passed. Exact three-file overlay; API and other containers unchanged. Web sha256:fd0e9ebdcfccfbd32e389170b99bcf59f8a22cc77bfe63dede0283fb1d0db6c7; API sha256:1a961e8f56c6ad3ee53fb8caf0230841fd8e353954ef1bb5a75920e867770c85. Rollback logoff-web:before-receipt-dialog-fast-20261020. Source parity remains false. This improves time to display, not server validation duration; direction preview computation remains unchanged.

Published PR647 / 2026-10-20: final effective ReceiptDirections declaration now uses native modal dialogs. Both production declarations are executed in order in regression; previous public runtime fails, corrected public JS passes five browser scenarios. Web461 passed,2 skipped. Web sha256:bf71856d59e7cf4f1420f778475b7af0c100499307ea81aea86003e6219aebc0, API unchanged sha256:1a961e8f56c6ad3ee53fb8caf0230841fd8e353954ef1bb5a75920e867770c85. Two-file overlay, other containers unchanged. Rollback logoff-web:before-receipt-dialog-effective-20261020. Source parity false; PR643/645 did not patch the final overriding panel.

Published PR645 / 2026-10-20: fixes PR643 dialog helper React scope. Complete receipt closure browser regression fails before fix and passes after; five cases also passed on JS downloaded from public site. Web461 passed,2 skipped. Web sha256:48da1ab9f56461e1c66ff87ebc8055ccdd87a87ab25d7b0f4535a3fccfbe4118; API unchanged at sha256:1a961e8f56c6ad3ee53fb8caf0230841fd8e353954ef1bb5a75920e867770c85. Exact two-file overlay, old assets retained; rollback logoff-web:before-receipt-dialog-scope-20261020. Source parity remains false.

Published PR643 / 2026-10-20: receipt approval and direction confirmations open centered in the native modal top layer, with backdrop and busy-safe cancellation. Web461/browser5 and web TypeScript passed;2 skipped. Exact three-file web overlay over live invoice-purpose/billing-fbo-filter runtime; all old assets, API and other containers preserved. API sha256:1a961e8f56c6ad3ee53fb8caf0230841fd8e353954ef1bb5a75920e867770c85, web sha256:63354801a6b954ba25c89a5ec1c197dc6dcf5b1e0d0ace0da816259cd19df640. Source parity remains false; the older PR641 archive is NOT the current production baseline. [Pinned release evidence](releases/receipt-dialogs-20261020.json).

Published PR641 / 2026-10-19: separate receipt and unfinished sorting tiles in the common administration grid for ADMIN/OWNER. Lazy tool content removes the empty upper card. Web459/API3535/browser4 and web TypeScript passed;2/155 skipped, dedicated KIZ DB suite excluded. Web-only; API/schema/flags/APK unchanged. Baseline `2026-10-19-admin-tiles`, sourceParityVerified=false. [Details](administration-operational-tiles.md).

Published PR639 / 2026-10-19: ADMIN/OWNER empty sorting cancellation from administration; scoped, versioned, idempotent and audited without stock writes. API3535/web453, runtime13/browser5 and TypeScript passed;155/2 skipped, dedicated KIZ DB suite excluded. Two API files, web graph overlay with old assets retained. Schema/flags/APK unchanged. Baseline `2026-10-19-sorting-cancel`, sourceParityVerified=false. [Details](sorting-cancellation.md).

Published PR637 / 2026-10-18: explicit first WB publication verifies exact fresh barcode identity, initializes and confirms zero, then publishes the reserved-stock plan. API3522/web446/helper10/runtime11 and TypeScript passed;155/2 skipped, dedicated KIZ DB suite excluded. Two-file API overlay; automatic/allocation paths, web/APK/config unchanged. Kubrin warehouse2271741 verified41 positions,40 positive,968 units. Baseline `2026-10-18-wb-first-publication`, sourceParityVerified=false. [Details](wb-first-publication.md).

Published PR635 / 2026-10-18: Dark FBS/catalog/cabinet/scanner surfaces and standalone relabel layout fixed. Web446/API3512, TypeScript and production-CSS browser checks passed;2/155 skipped, dedicated KIZ integration DB suite excluded. Exact two-CSS overlay plus index, 3005 old assets retained. API/APK/config unchanged. Baseline `2026-10-18-dark-surfaces`, sourceParityVerified=false. [Details](dark-surfaces.md).

Published PR633 / 2026-10-16: bounded named timings for FBS KIZ scan, completion, preflight, reservation, response, request status, notifications, sticker and task load. Existing behavior preserved; this is diagnosis, not a latency fix. API3512/web445 and TypeScript passed;155/2 skipped, dedicated KIZ DB suite excluded. Three actual-image checks; one runtime module only. Web/APK233/flags unchanged. Baseline `2026-10-16-fbs-stage-timing`, sourceParityVerified=false. [Details](fbs-stage-timing.md).

Prepared: [FBS stage timing](fbs-stage-timing.md), preserves scan/completion behavior; latency cause still under investigation.

Published PR631 / 2026-10-16: Ozon label creation retries explicit HTTP429 with bounded delay. Ambiguous writes are not retried. API3509/web445 and TypeScript passed;155/2 skipped, dedicated KIZ DB suite excluded. Four actual-image checks; one runtime module only. Live client receipt visibility correction preserved. Web/APK233/flags unchanged. Baseline `2026-10-16-ozon-labels`, sourceParityVerified=false. [Details](ozon-label-throttling.md). FBS latency diagnosis remains open.

Prepared: [Ozon label throttling](ozon-label-throttling.md), bounded retry of explicit 429 only; FBS latency investigation remains open.

Published PR629 / 2026-10-16: receipt series XLSX uses recorded product label barcodes instead of unordered GTIN aliases. Scoped accepted TSD scans, unambiguous legacy fallback. API3507/web445, source6, container7, TypeScript and exact two-file delta passed;155/2 skipped, dedicated KIZ DB suites excluded. Live 1310 export verified4474 units. Web/APK233/flags unchanged. Baseline `2026-10-16-receipt-scanned-barcode`, sourceParityVerified=false. [Details](receipt-scanned-barcode.md). [Evidence](releases/receipt-scanned-barcode.json).

Published PR627 / 2026-10-16: interrupted WB auto assembly now persists request ownership atomically, journals supply intents/IDs and recovers under locks with exact WB composition and routing checks. API3501/web445, source11, candidate/live8, PostgreSQL4, TypeScript and baseline8 passed;155/2 skipped, dedicated KIZ DB suites excluded. Four API modules, own-installation durable flag only. Web/APK233 unchanged. Baseline `2026-10-16-auto-assembly-interrupted`, sourceParityVerified=false. [Details](auto-assembly-interrupted.md). [Evidence](releases/auto-assembly-interrupted.json).

Published PR625: [all-response shift latency summaries](shift-latency-summary.md). Two diagnostic API modules, WMS_OPERATION_HISTOGRAM_ENABLED=true only here. API3490/web445, TypeScript, actual-runtime4 and first live minute verified;155/2 skipped. Web/APK233/printing/backup settings/sold unchanged. Baseline `2026-10-16-shift-latency`, sourceParityVerified=false.

Published PR623: [FBS hidden-window polling](fbs-window-polling.md). Four recurring reads and two synchronization retries pause in hidden/minimized windows; refresh on restore. API3487/web445, TypeScript, candidate/live browser5 and exact33-file overlay passed;155/2 skipped. API/APK233/printing/sold unchanged. Baseline `2026-10-15-fbs-window-polling`, sourceParityVerified=false.

Published PR620/621 / 2026-10-15: durable bounded WB reconciliation queue and on-demand request readiness, exact lookup and assigned attention cases. API3487/web443, TypeScript, isolated PostgreSQL6, candidate/live browser7, actual API6, migration runner and baseline8 passed;155/2 skipped, dedicated KIZ DB suite excluded. Six API files, additive queue table and web graph; new flags enabled only on our WMS. PR618 monitoring retained; APK233, printing and sold WMS unchanged. Baseline `2026-10-15-reconciliation-tools`, sourceParityVerified=false. [Details](reconciliation-tools.md). [Evidence](releases/reconciliation-tools-20261015.json).

Published PR618 / 2026-10-15: WB monitoring uses current warehouse routing and exact reservation evidence. EXCLUDED routes are filtered before listing/ingestion/checking; WAITING_STOCK cannot confirm a reserve. API3475/web443, source/runtime13 and Docker6 passed;155/2 skipped, dedicated KIZ DB suites excluded. Four API modules only; WMS_FBS_MONITOR_ROUTING_ENABLED=true. Web/APK233 unchanged. Baseline `2026-10-15-monitor-routing`, sourceParityVerified=false. [Evidence](releases/wb-monitor-routing.json).

Published PR616 / 2026-10-15: bounded API request timing and compact TSD replay receipt reads. API3462/web443, TypeScript, actual-image7 and live read-only SQL verification passed;150/2 skipped, dedicated KIZ DB suites excluded. Three runtime files; two own-WMS flags enabled. Web/APK233/print agent/schema/stock/sold WMS unchanged. Baseline `2026-10-15-operation-reads`, sourceParityVerified=false. [Details](operation-read-diagnostics.md). [Evidence](releases/operation-reads-20261015.json).

Prepared: [request diagnostics and compact TSD replay reads](operation-read-diagnostics.md). Three API runtime files only; API3462/web443 and actual-image7 passed. Queue/schema excluded; sold WMS unchanged.

Published PR614 / 2026-10-15: [объединённый макет Ozon](ozon-combined-layout.md) — компактное создание, 4–6 плиток, выбранная сборка/грузоместа снизу. Web443/API3454, TypeScript, baseline8, candidate/public graph browser и legacy layout passed;2/150 skipped, dedicated KIZ DB suites excluded. Exact34-file web delta; 94 public graph files verified. API/APK233/config/business records/sold WMS unchanged. Baseline `2026-10-15-ozon-combined`, sourceParityVerified=false. [Evidence](releases/ozon-combined-20261015.json).

Published PR612 / 2026-10-15: Ozon FAILED cargo retry requires fresh terminal failure, confirmed empty remote cargo arrays, binding/composition checks and atomic claim with previous-operation audit. Object-form errors now shown. Six regression cases; API3454/web442, TypeScript and actual-image4 passed;150/2 skipped, dedicated KIZ DB suite excluded. One API module (upload/status); web/APK233/flags/stock/sold WMS unchanged. Request2058 retried only SPb and Novosibirsk; all8 directions SUCCESS, other6 submission IDs and labels preserved. Baseline `2026-10-15-ozon-retry`, sourceParityVerified=false.

Published PR610 / 2026-10-15: exact int64 Ozon cargo IDs retained on response parsing and label serialization. Two regressions fail before/pass after; API3448/web442, TypeScript and actual-image smoke passed;150/2 skipped, dedicated KIZ DB suite excluded. One API module, only call/labels methods; web/APK233/flags/stock/sold WMS unchanged. Request2059 cargo IDs restored through audited status check, existing submission preserved; labels generated with 3 correct pages. Baseline `2026-10-15-ozon-ids`, sourceParityVerified=false.

Published PR608 / 2026-10-15: Ozon TSD closed-carton top-up before cargo submission. LOGOFF APK233, explicit REOPEN_BOX, existing destination/quota/KIZ guards and idempotent audit. API3446/web442/Android263 per flavor passed;155/2 skipped; five actual-runtime cases and public file hashes verified. Three API modules and three download files only; WMS_OZON_REOPEN_BOX_ENABLED=true. Baseline `2026-10-15-ozon-reopen-233`, sourceParityVerified=false. [Evidence](releases/ozon-reopen-233.json).


Published PR606 / 2026-10-14: Winx welcome now assigned to actual login Eleonora (display name Elkapone), not separate Elya account. Sofia unchanged. Web442/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. TypeScript, baseline8 and six public-site browser cases passed with real network HTML/JS/CSS/video (only API mocked). One account-ID change plus cache-safe graph renaming; API/APK232/configuration/business data/sold WMS unchanged. Baseline `2026-10-14-eleonora-account`, sourceParityVerified=false. [Details](eleonora-account-welcome.md). [Evidence](releases/eleonora-account-20261014.json).

Published PR604 / 2026-10-14: personal welcome after successful login for verified Sofia/Eleonora IDs in all themes; supplied Disney/Winx animations, exact text, skip and completion. Web441/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. TypeScript, baseline8 and actual runtime login/appearance/Ozon tests passed. Exact33-file web delta over sidebar-contrast; API, APK232, configuration, business records and sold WMS unchanged. Baseline `2026-10-14-personal-login`, sourceParityVerified=false. [Details](personal-login-welcome.md). [Evidence](releases/personal-login-20261014.json).

Published PR601 / 2026-10-14: readable section count in la_panthera Light. White badge text, contrast12.19 (was1.20); Dark6.01 unchanged. Web431 passed,2 skipped; source/candidate/published CSS browser checks passed. Only index.html and one hashed CSS asset changed over current live web; API/APK232 unchanged. Baseline `2026-10-14-sidebar-contrast`, sourceParityVerified=false. [Evidence](releases/sidebar-contrast-20261014.json).

Published PR598 / 2026-10-14: Winx and Disney styles in la_panthera, 33 supplied wallpapers, themed cursors and centered personal welcome. Web440/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. Candidate/live login, restoration and Ozon inline browser checks passed. Exact 74-file web delta; API, APK232, configuration, stock and sold WMS unchanged. Baseline `2026-10-14-panthera-magic`, sourceParityVerified=false. [Details](panthera-magic-themes.md). [Evidence](releases/panthera-magic-20261014.json).

Published PR599 / 2026-10-14: Ozon online execution embedded below the link-import form in the left column; right assembly list stays usable. Optional embedded mode preserves other modal callers. Web434/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. TypeScript, source/candidate/live browser checks passed. Only workspace and panel display properties changed in current runtime; API, APK232, flags, operations and sold WMS unchanged. Baseline `2026-10-14-ozon-inline`, sourceParityVerified=false. [Evidence](releases/ozon-inline-20261014.json).

Published PR596 / 2026-10-14: compact Ozon customer forms/cards; full assembly list uses page scrolling instead of the 585px inner viewport; themed native file/template controls. Web433/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. Five-row source/candidate/live browser checks, five widths, three appearances and native file chooser passed. CSS + index only; application JS, API, APK232, print agent, configuration, stock and sold WMS unchanged. Baseline `2026-10-14-ozon-compact`, sourceParityVerified=false. [Evidence](releases/ozon-compact-20261014.json).

Published PR594 / 2026-10-14: approved Ozon customer workspace 65/35 layout, responsive import and supply panels, named accounts. Web433/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. Source/candidate/live browser checks at five widths and three appearances, both import entry points and eight baseline tests passed. Exact 34-file web overlay; API, APK232, print agent, configuration, stock and sold WMS unchanged. Baseline `2026-10-14-ozon-layout`, sourceParityVerified=false. [Details](ozon-workspace-layout.md).

Published PR592 / 2026-10-14: LOGOFF APK232 clears restored unmarked FBO picking checkpoints after upgrade. Marked products and uncertain commands preserved. Android261 tests per flavor (783 total), release build, signature and public hashes passed. Only three APK download files changed over live October14 web; API853c97df unchanged. Baseline `2026-10-14-fbo-restore-232`, sourceParityVerified=false. Physical scanner requires APK232 installation. [Evidence](releases/fbo-restore-232.json).

Published PR590 / 2026-10-14: Ozon link import uses authorized customer warehouse selection and shows client owner beside account number. Both managed Korolev clients verified read-only. API3437/web431 and both actual browser entry points passed;150/2 skipped, dedicated KIZ DB suites excluded. API/web TypeScript passed. One API module and Ozon import UI; APK231, stock, configuration and sold WMS unchanged. Baseline `2026-10-14-ozon-client-access`, sourceParityVerified=false. [Details](ozon-client-link-access.md).

Published PR588 / 2026-10-14: LOGOFF APK231 fixes unmarked FBO manual top-up and stale barcode after definitive picking rejection. Marked products and uncertain commands preserved. Android260 tests per flavor (780 total), release build, signature and public hashes passed. Only three APK download files changed over live October14 web; API89534e60 unchanged. Baseline `2026-10-14-fbo-unmarked-231`, sourceParityVerified=false. Physical scanner requires APK231 installation. [Evidence](releases/fbo-unmarked-231.json).

Published PR586 / 2026-10-13: warehouse FBO picking from confirmed receipt boxes without pallet-sort placement, any receipt age. Shared route/command evidence guard; reservations, KIZ and client visibility preserved. WMS_FBO_UNPLACED_PICKING_ENABLED=true only in our API image. API3431/web427 passed,155/2 skipped; dedicated KIZ DB suite excluded. Six actual-runtime cases and Lukin PALLET_SORT read-only proof passed. Two API modules; web/APK230/stock unchanged. Baseline `2026-10-13-fbo-confirmed-unplaced`, sourceParityVerified=false. [Evidence](releases/fbo-unplaced-20261013.json).

Published PR584 / 2026-10-13: Ozon cargo HTTP429 bounded retry and verified empty-cargo recovery. Ambiguous writes remain blocked. One API module only; API3423/web427 passed,155/2 skipped; dedicated KIZ DB suite excluded. Three candidate/live runtime cases and request2000 read-only proof:5 confirmed directions,9 cargoes. APK230/web/flags/stock unchanged. Baseline `2026-10-13-ozon-rate`, sourceParityVerified=false. [Evidence](releases/ozon-rate-20261013.json).

Published PR582 / 2026-10-13: explicit administrator physical-KIZ reuse despite disputed historical WB sale. Per-task/unit/evidence approval; former binding archived, shipment history preserved. Active FBS/FBO, duplicate marks, stale evidence and confirmed retirement blocked. Flag WMS_KIZ_SOLD_PHYSICAL_REUSE_ENABLED only on our WMS. API3417/web427, KIZ runtime24/FBS runtime33, actual browser and PostgreSQL approval/scan with mandatory rollback passed;155/2 skipped, dedicated KIZ DB suites excluded. Two API modules and review UI only; APK230 and stock preserved. Baseline `2026-10-13-kiz-physical`, sourceParityVerified=false. [Evidence](releases/kiz-physical-20261013.json).

Published PR580 / 2026-10-13: LOGOFF APK230 restores picking after a saved Ozon product-packing mode. Pending commands preserved; regression reproduced before fix. 258 tests per flavor, release build, APK certificate and public hashes verified. Lint:11 existing errors in unchanged files. Three APK download files only; API/flags/business data unchanged. Baseline `2026-10-13-ozon-picking-230`, sourceParityVerified=false. [Evidence](releases/ozon-picking-230.json).

Published PR578 / 2026-10-13: confirmed Ozon-to-WMS composition sync beside stock adjustment. Preserves picked/packed units, exact registered barcode identity, reopens picking for added demand, and rejects stale previews or unsafe reductions. Four API modules and existing web panel only. API3416/web426 passed,155/2 skipped; dedicated KIZ DB suite excluded. Candidate browser and three runtime cases passed; live request2000 read-only preview205/205. APK229, flags and business records unchanged. Baseline `2026-10-13-ozon-sync`, sourceParityVerified=false. [Evidence](releases/ozon-sync-20261013.json).

Published PR576 / 2026-10-13: FBO registered SKU barcode aliases accepted during picking and packing; LOGOFF APK229. Request2000 Greta receipt barcode4610389218703 and request barcode4630584392961 retained as one SKU. KIZ/state/direction checks retained. API3404/web424/Android256 per flavor passed;155/2 skipped, dedicated KIZ duplicate DB suite excluded. Six actual runtime packing cases and live read-only request2000 plan passed. Two API modules and three APK download files only; PR574 Ozon adjustment retained, flags unchanged. Baseline `2026-10-13-fbo-aliases`, sourceParityVerified=false. [Evidence](releases/fbo-aliases-20261013.json).

Published PR574 / 2026-10-13: Ozon FBO actual-stock adjustment preview and explicit WMS/Ozon confirmation; picked + available minus other reservations, including accepted unplaced stock. Original box locations are shown. Durable external intents, no ambiguous retries, packing/cargo guard, atomic WMS commit after confirmed fresh Ozon composition. API3398/web424 passed,155/2 skipped; dedicated KIZ duplicate DB suite excluded. API/web TypeScript and actual runtime browser passed. Live request2000 read-only proof:206 planned,185 available,7 pending boxes; business quantities unchanged. Eight API modules overlay verified PR572; Ozon panel source parity checked. Web base flattened offline with preserved image configuration and files to resolve Docker mount-layer limit. APK228/flags/sold unchanged. Baseline `2026-10-13-ozon-adjustment`, sourceParityVerified=false. [Evidence](releases/ozon-adjustment-20261013.json). [Behavior](ozon-stock-adjustment.md).

Published PR572 / 2026-10-13: Ozon assembly workspace defaults to active requests with a separate Completed list for DONE/CANCELLED/REJECTED. Server filters before take100; completed packing remains active until handover. History and cargo access retained, completed assembly opens read-only. API3372/web424 passed,155/2 skipped; dedicated KIZ duplicate integration excluded. Web TypeScript and source/candidate browser tests passed. Two source-parity API modules and one workspace overlay the pinned runtime. Live scoped list smoke passed without writes. APK228/flags unchanged. Baseline `2026-10-13-ozon-completed`, sourceParityVerified=false. [Evidence](releases/ozon-completed-20261013.json).

Published PR570 / 2026-10-12: client Telegram notifications support persisted forum topic IDs. Automatic and test messages include message_thread_id; legacy forms preserve it for the same group and clear it when the group changes. Six regression tests, API3370/web423 passed,155/2 skipped; dedicated KIZ duplicate integration excluded. One parity-verified runtime module, equivalent decorator metadata normalized; candidate/live mock-network smoke passed. Web/APK228/flags unchanged. Baseline `2026-10-12-telegram-topic`, sourceParityVerified=false. [Evidence](releases/telegram-topic-20261012.json).

Published PR568 / 2026-10-12: Ozon client workbook import now resolves the only active client warehouse or requires an explicit scoped choice. Preview, commit and list use the same warehouse. Template download/link import retained. Candidate and live read-only Koroleva preview/list passed; mocked commit and actual-runtime browser passed. API3364/web423 passed,155/2 skipped; dedicated KIZ duplicate integration excluded. Web TypeScript passed; API source typing retains existing local Prisma drift. Four API runtime modules and scoped web functions over the pinned current graph. APK228 and flags unchanged. Baseline `2026-10-12-ozon-client-warehouse`, sourceParityVerified=false. [Evidence](releases/ozon-warehouse-20261012.json).

Published PR565 / 2026-10-12: FBO Ozon workbook download beside upload, plus existing supply-link import below it. Client/account/warehouse-scoped read-only preview, destination quotas, explicit atomic creation and duplicate/order-overlap protection. Live preview of 134006772 returns 50 units / 5 destinations / existing request 1951 without writes. API 3358 / web 422 passed, 150/2 skipped; dedicated KIZ DB suites excluded. Runtime changes: 6 API modules, 2 import functions in preserved web graph, 1 XLSX. APK228 and flags unchanged. Baseline `2026-10-12-ozon-link-import`, sourceParityVerified=false. [Evidence](releases/ozon-template-20261012.json).

Published PR563 / 2026-10-12: LOGOFF APK228 supports FBO WB/Ozon picking directly from unboxed client stock in the selected warehouse. Shared reservations, physical KIZ and idempotency preserved; packing by destination unchanged. New WMS_FBO_UNBOXED_PICK_ENABLED=true only on our WMS. API3349/web421/Android253 per flavor passed;150/2 skipped, dedicated KIZ DB suites excluded. Real PostgreSQL concurrency, replay and packing rollback passed. Four API modules overlay fresh PR562 runtime; three APK downloads only. Baseline `2026-10-12-fbo-unboxed`, sourceParityVerified=false. Request1951 created separately:50 units,5 directions,zero shortage; confirmed physical stock restored and reserved atomically,1 free unit remains. Existing five Ozon cargoes were read only. Physical scanner verification pending APK228 installation. [Evidence](releases/fbo-unboxed-20261012.json).

Published PR561 + PR562 / 2026-10-11: «Сервис → Сборка ФБС по номерам». ADMIN/OWNER, выбор филиала и короба, одна обычная заявка с сохранением поставок WB, повтор без дублей. Точный uint64-курсор WB; WMS_FBS_MANUAL_ASSEMBLY_ENABLED=true только в нашей WMS. API3344/web421 passed,145/2 skipped; два специализированных KIZ DB suite исключены. PostgreSQL5 на исходниках и5 на кандидате, браузерный граф31, live preview с откатом и блокировкой дубля №1921 прошли. Baseline `2026-10-11-fbs-manual`, sourceParityVerified=false. APK227, прочие флаги и проданная WMS сохранены. [Evidence](releases/fbs-manual-20261011.json).

Published PR559 / 2026-10-10: Excel mapping of WMS boxes to confirmed Ozon cargo IDs, directions and supply/order numbers. Download available after all directions succeed; exact text identifiers and scoped read-only export. Request1861 verified:27 boxes/11 directions. API3313/web417 passed,145/2 skipped; dedicated KIZ DB suites excluded. TypeScript, candidate runtime, live controller and browser download passed. Baseline `2026-10-10-ozon-cargo-export`, sourceParityVerified=false. APK227, print agent, flags, sold WMS and business records preserved. [Evidence](releases/ozon-cargo-export-20261010.json).

Published PR557 / 2026-10-10: Windows print agent2026.10.10.1 restores duplicate KIZ station heartbeat/polling and includes KizDuplicate.ps1 in package/installation. Only agent download changed. API/APK227/configuration/sold WMS unchanged; physical printer update required. 31 source and31 packaged agent tests, API3303/web416 passed;145/2 skipped, dedicated KIZ DB suites excluded. Baseline `2026-10-10-kiz-agent`, sourceParityVerified=false. [Details](kiz-duplicate-agent-station.md).

PR555: `wb-barcode-identity.ts` indexes account/client barcode uniqueness and grants scoped description updates; runtime integration uses `build-wb-barcode-identity.cjs`.

PR553: `marketplace-product-links.ts` owns account identity matching; `MarketplaceProductLinks.tsx` owns catalog review. Client allowlist isolates the feature. Shared SKU reservations remain authoritative.

Published PR551 / 2026-10-10: LOGOFF APK227 adds last-unit packing undo and immediate Ozon destination barcode checks. Exact-unit receipt, atomic stock/KIZ return and audited idempotent undo; closed/stale/intervening operations rejected. WMS_FBO_PACK_UNDO_ENABLED=true only on our WMS. Three API modules and three APK download files changed; sold WMS, routing/schema and business records untouched by deployment. API3287/web414, Android252 per flavor (756), runtime7 and real PostgreSQL concurrency/rollback/KIZ return passed;139/2 skipped, dedicated KIZ integration excluded. Read-only production snapshot1861 verified capability; route allocation excluded. Physical scanner check pending APK installation. Baseline `2026-10-10-fbo-packing-undo`, sourceParityVerified=false.

Published PR549 / 2026-10-10: LOGOFF APK226 adds Ozon packing by product alongside packing by destination. Barcode/KIZ → suggested direction → carton scan; atomic packing, durable replay, quota checks. WMS_OZON_PACK_BY_PRODUCT_ENABLED=true only on our WMS. Three API modules and three APK download files changed; sold WMS, routing and business records untouched. API3283/web414, Android249 per flavor (747), runtime7 and real PostgreSQL concurrency/rollback passed;139/2 skipped, dedicated KIZ integration excluded. Read-only production snapshot1861 verified capability and18 suggestions; route allocation excluded. Physical scanner check pending APK installation. Baseline `2026-10-10-ozon-packing-product`, sourceParityVerified=false.

Published PR547 / 2026-10-10: LOGOFF APK225 displays barcode, product, size, destination quantity and packed/remaining counts for the selected Ozon destination. Existing response only; no added requests. 245 Android tests per flavor (735 total), release/lint and signed package checks passed. Regression reproduced before fix. Physical scanner verification pending installation. Only three APK download files changed; API, print agent, flags, sold WMS and stock unchanged. Baseline `2026-10-10-ozon-direction-items`, sourceParityVerified=false.

Published PR545 / 2026-10-10: Ozon packing command now counts loaded units for unoptimized progress. Existing parallel-packing flag required; final phase and direction guards preserved. API3276/web414 and four runtime guard tests passed; API139/web2 skipped, dedicated KIZ integration excluded. Tests stop before physical mutation; production snapshot is read-only and excludes route allocation. APK224, web, sold WMS and business records unchanged. Baseline `2026-10-10-ozon-packing-command`, sourceParityVerified=false.

Current verified release: PR543, Ozon parallel packing capability; APK224 unchanged. [Production](current-production.md).

Current verified release: PR541, LOGOFF APK224; WB/Ozon selection in both picking and packing, optional marketplace query in TSD lists. [Production](current-production.md). Sold WMS unchanged.

PR539: `ClientRequestsService.list` selects `ozonShipment.requestId` behind the existing Ozon import flag; `isWbFboRequest` excludes this relation. General requests remain combined, dedicated WB active/archive lists exclude Ozon. Ozon import is hidden in WB.

Current verified release: PR537, print agent **2026.10.09.2**. [Production](current-production.md), [evidence](releases/print-agent-ack-conflict-20261009.json). Only agent download changed.

Ozon supply link: `ozon-assembly-supply.service/controller.ts`, `ozon-supply-policy.ts`, `OzonAssemblySupply.tsx`. See [workflow](ozon-assembly-supply-link.md).

## Онлайн-выполнение / PR525

`online-plan-view.ts` — компактная проекция и страницы истории; `FboHistory.tsx` — загрузка по раскрытию; `visiblePolling.ts` — видимость конкретного окна; `menu-read-catalog.ts` — параллельные независимые чтения. Направления Ozon и права сохранены. База `2026-10-09-online-window`, sourceParityVerified=false.

Found KIZ: [scenario](kiz-found-review.md). `inventory/kiz-found-review.ts` owns independent FOUND cases, separate physical return and UNIT permission. KizLocationScreen/KizFoundPanel expose it without a box. LOGOFF opt-in; no sold release.

Receipt review: ADMIN/OWNER operational panel, server hold before receipt, transactional decision. FBO access uses persisted selected writable branch in `administration/fbo-problems-warehouse.ts`; runtime wrapper preserves existing recovery actions. LOGOFF only.

PR520: вход `OzonFboPanel` выбирает `OzonCustomerWorkspace` или прежний API-режим. `GET /ozon-fbo-import/requests` возвращает сборки клиента активного филиала.

## ФБО Ozon / PR516

Импорт: `ozon-fbo-import.service/controller.ts`; квоты: `ozon-fbo-directions.ts`; одна ClientRequest + OzonFboShipment, короба с direction. Web: OzonCustomerImport/FboTwoStagePanel; Android: FboTwoStageScreen/FboScanState. [Сценарий](ozon-fbo-customer-file.md).

# Карта проекта

Актуализировано 09.10.2026 по опубликованному PR525. Начинать с
[индекса](README.md), [паспорта](current-production.md) и
[baseline 2026-10-09-menu-reads](../baselines/our-wms/2026-10-09-menu-reads/manifest.json).
`sourceParityVerified=false`; исходники и исполняемый runtime сверять отдельно.
Пути ниже относительны `wms/`. Изменения публикуются только в нашей WMS.

## Актуальные связи

| Сценарий | Точки входа и поток | Границы поведения |
| --- | --- | --- |
| Меню приёмок и онлайн, PR514 | menu-read-catalog / receipt-report-evidence / getDeviceRequestPlan / shared-read | Только чтения; WMS_MENU_READS_ENABLED, без длительного кэша |
| Упаковка ФБО, PR512 | ACK/status → fbo-packing-receipt → FboPackingReceipt / FboTwoStageScreen | Абсолютные счётчики без КИЗ-истории; LOGOFF219; fallback на полную сверку |
| Доступность приёмки, PR509/510 | receiptRules / pendingReceiptBoxIds → receipt-stock-index → ReceiptStockIdentity | История агрегируется при записи; подтверждение читается актуальным; флаг только нашей ВМС |
| Серия Windows, PR505 | `lib/printSeries.ts` → `/print/series` → `PrintSeriesService` → `PrintSeries.ps1` | Один PrintJob/PrintDocument; UUID, права филиала/клиента; потеря ACK не печатает повторно. Нужен новый агент |
| Телефон, PR505 | `lib/phoneLayout.ts`, `components/layout/phone-layout.css`; runtime bridge | До 900 px: карточки, меню, прокрутка и zoom; только наша ВМС |
| Клиентский склад, PR496 | `apps/web/src/lib/workspaces.ts`: `canOpenWorkspace` → `components/warehouse/WarehouseOpsPanel.tsx` → `GoodsArrivalPanel.tsx`, `ShipmentHistoryPanel.tsx`, `ReceiptDirectionsPanel.tsx`; API `modules/warehouse/warehouse.controller.ts`: `shipmentHistoryList` | CLIENT видит ровно четыре раздела и свои данные. Онлайн-приёмка сохраняет `onlineReceiptVisibleToClient`. Флаги `WMS_CLIENT_WAREHOUSE_ENABLED` / `VITE_CLIENT_WAREHOUSE_ENABLED`; права записи склада не выдаются |
| Подтверждение приёмки, PR494 | `apps/web/src/components/warehouse/ReceiptDirectionsPanel.tsx` → `apps/api/src/modules/warehouse/receipt-channels.controller.ts` → `receipt-channel-policy.ts`: `receiptApprovalEntries`, `changeReceiptApproval` | Клиент подтверждает свою приёмку; имя и время серверные. Отключение только ADMIN/OWNER без активного резерва. Флаг и scope клиента/склада, сейчас Лукин / ФФ Москва |
| Доступность товара | `receipt-channel-policy.ts`: `pendingReceiptBoxIds`, `assertReceiptStockAvailable` → остатки, публикация WB, планирование и отбор ФБС/ФБО | Несогласованные короба недоступны для отбора и перемещения в обход проверки; физический учёт и хранение сохраняются. Направления ФБС/ФБО независимы от согласования |
| Excel кабинета, PR492 | `apps/api/src/modules/stock/stock.controller.ts`: POST `/stock/cabinet-export-audit` → `CLIENT_STOCK_EXPORT_PREPARED` | Точные строки, фильтры, пользователь, серверное время и IP; подготовка файла не доказывает сохранение на устройстве |
| Отбор и размещение ФБО, PR485/492 | `apps/api/src/modules/client-requests/`, `modules/stock/pick-instruction.service.ts`, `modules/tsd/fbo-request-route.ts`; Android `MainActivity.java` | Целые короба / частичный отбор используют один план. Подтверждённый приход за 7 суток может ожидать размещения; до размещения короб не доступен прямому отбору |
| Исправления ФОТ, PR488 | `apps/web/src/components/expenses/PayrollManagement.tsx`, `PayrollHistory.tsx` → `apps/api/src/modules/expenses/payroll.service.ts` → `PayrollAudit` | Снимки до/после, причина, транзакция; оплата или более позднее изменение блокируют откат. Старые неполные события не имеют универсальной отмены |
| React и навигация, PR498 | `scripts/single-react-graph.cjs`, `scripts/single-react-graph.test.cjs`, `scripts/releases/single-react-20261008/navigation.test.cjs` | Все достижимые lazy chunks используют один React. После переименования entry проверять граф и реальные переходы во всех затронутых темах |

В этой таблице сокращённые `components/` относятся к `apps/web/src/`,
`modules/` — к `apps/api/src/`. Подробности:
[клиентский склад](client-warehouse-menu.md), [приёмки](receipt-stock-approval.md),
[выгрузки и размещение](cabinet-export-and-fbo-placement.md),
[ФОТ](payroll-corrections.md), [ФБО](fbo-two-stage-picking.md),
[инцидент React](single-react-incident-20261008.md).

## Биллинг: связи ранее опубликованных изменений

Указанные ниже runtime-пути — исторические снимки соответствующих выпусков,
а не текущая база для публикации.

Опубликовано PR472 04.10.2026: [закрытие расчётных периодов](billing-period-close.md).
`BillingPeriodClosingPanel` → `/billing/period-close` → `BillingPeriodCloseService` →
отдельные `BillingPeriodClose` и `BillingInvoiceCorrection`; `billing-correction-balance.ts`
рассчитывает итоговый долг без изменения исходной суммы/приходов.
Отдельный флаг только нашей WMS. Runtime `baselines/our-wms-runtime-period-close-20261004`;
API569/web1744. Исходные счета/строки/приходы/начисления сохранены, новых бизнес-документов0.

Опубликовано PR469: `buildSettlements` → `visibleRows` после расчёта денежных сумм.
Строки без долга и незавершённых расчётов скрыты, независимо от архивности клиента.
`BillingSettlementsPanel` объясняет пустой отфильтрованный реестр.
Исторический runtime: `C:/WMSFF2207/baselines/our-wms-runtime-settlements-visible-20261003`.
[Запись выпуска](releases/billing-settlements-visible-20261003.json).

Опубликовано PR467: [частичный приход и загрузка расчётов](billing-partial-receipt-fix.md).
`BillingSettlementsService.list` → отдельные `charges` за период и исторические
`coverageCharges` → `buildSettlements`. `BillingCashReceiptPanel.toggleInvoice`
сохраняет введённую сумму; `receiptHistory` читает оплаты всех счетов клиента.
Исторический runtime: `C:/WMSFF2207/baselines/our-wms-runtime-partial-receipt-20261003`.

Опубликовано PR465: [фильтр статуса счетов](billing-invoice-status-filter.md).
`BillingPanel.invoiceStatusFilter` → server register query + `filterBillingRegisterInvoices`
и `invoiceKindTiles`. Оба представления используют один выбор статуса; API не менялся.
Исторический runtime: `C:/WMSFF2207/baselines/our-wms-runtime-invoice-status-20261003`.

Опубликовано PR463: [черновик по сданным заявкам](billing-done-requests.md).
`BillingPanel` → `BillingPeriodGenerationDialog(doneRequests)` → прежние period
preview/generate routes → `BillingPeriodService.loadDoneRequests` →
`billing-done-requests.policy.ts` → существующий `writePeriodDraft`.
Отбор по событиям сдачи; отдельный флаг нашей WMS, без складских изменений.

## Биллинг: клиенты, суммы и проверки — PR455

`apps/web/src/components/billing/BillingPanel.tsx` → `BillingSettlementsPanel.tsx` →
`apps/web/src/lib/billing-settlements-api.ts` → GET `/billing/settlements` →
`apps/api/src/modules/billing/billing-settlements.controller.ts` →
`billing-settlements.service.ts` (права, клиент/склад, READ ONLY) →
`billing-settlements.policy.ts` (копейки, покрытие FBS, расшифровка и проверки).
Существующие начисления/счета/оплаты сохраняют прежние обработчики.
Флаг включать только в нашей WMS; отсутствие начислений проверяется для
подтверждённой FBS-обработки WB/Ozon. [Подробности](billing-settlements.md).

Пути относительны `wms/`. Сначала прочитать [паспорт](current-production.md):
исходники в этой ветке ещё не полностью соответствуют runtime.
Исполняемый путь соответствует `apps/api/src/X.ts` → `X.js` в `api-runtime.tar.gz`.
Файлы, отмеченные «снимок», искать в архиве runtime и source-reference; их нельзя
считать отсутствующей функциональностью только потому, что их нет в `apps/api/src`.

| Сценарий | Точки входа | Связи, которые нельзя потерять |
| --- | --- | --- |
| Сборка FBS WB/Ozon | `apps/api/src/modules/tsd/tsd-device.controller.ts`; `marketplace-connections.service.ts`: `getNextFbsTsdAssembly`, `scanFbsTsdBarcode`, `formatFbsTsdAssembly`, `completeFbsTsdAssembly` | Резерв, фактический короб, КИЗ, количество, завершение, статусы заявки |
| Экран без наклейки заказа | `modules/tsd/tsd-fbs-user.decorator.ts`; снимок `modules/marketplace-connections/fbs-physical-pick.js` | Заголовок `X-TSD-FBS-Capability` → пользователь запроса → `physicalPickConfirmation`; не менять права пользователя |
| Счётчик Ozon | Снимок `modules/marketplace-connections/ozon-tsd-picking.js`; `scannedItemCount`, `requireOzonItemsScanned` | Каждый скан, повтор запроса, undo/release, запрет завершить неполный заказ; несколько КИЗ/переклейка требуют отдельного сценария |
| Последовательный отбор WB | Снимок `modules/marketplace-connections/fbs-sequential-route.js`; Android `FbsSequentialPick.java` | Разные заказы одного короба, подтверждение единицы, восстановление счётчика, отсутствие двойного списания |
| Переклейка при FBS | `modules/tsd/tsd-relabel-print.service.ts`; `modules/marketplace-connections/marketplace-connections.service.ts`; `fbs-physical-kiz-relabel` | Исходный SKU → целевой ШК → два товарных стикера → проверочный скан; прежний КИЗ для того же товара/размера |
| Печать заказа / тихий агент | `modules/print/`; `modules/marketplace-connections/marketplace-connections.service.ts`; `modules/service/` | Товарный ШК при переклейке и стикер заказа WB — разные операции; очередь, идемпотентность, связь станции, права |
| Редактор этикеток | `apps/web/src/components/print/{StickerSetPanel,BoxLabelForm,PalletLabelForm,SkuLabelForm,LabelTemplatePanel}.tsx` | Физические размеры, поля, перенос/масштаб текста, выбранный принтер, локальный диалог печати |
| Доли WB/Ozon и дубли | `apps/web/src/components/fbs/FbsStockAllocationView.tsx`; снимок `modules/marketplace-connections/{marketplace-allocation,duplicate-stock-groups,duplicate-stock-plan,wb-stock-reserve}.*` | Единый физический остаток, резервы заказов/страховой резерв, соответствия размеров и переклейка; не удваивать остаток |
| Автосборка | Снимок `modules/administration/auto-assembly.*`, `modules/marketplace-connections/auto-assembly-*.js` | Клиент, филиал, кабинеты, расписание, маршрут; параллельная ручная сборка и защита от дублей |
| FBO | `modules/tsd/tsd-assembly.service.ts`, `modules/client-requests/`, `modules/stock/pick-instruction.service.ts`; снимок `modules/tsd/fbo-local-route.js` | Раздельные этапы отбора/упаковки, резервы, частичная сборка, фактическая отгрузка |
| Остатки и маршруты | `modules/stock/`, `modules/warehouse/`, `modules/inventory/`; `apps/web/src/components/client-requests/` | Историческая инструкция не равна текущему резерву; отгруженный товар не возвращать в доступные остатки по устаревшему снимку |
| Палет-сортировка | `modules/inventory/`, `modules/warehouse/`; Android `MainActivity.java` | Текущее размещение, постоянные короба, актуальные КИЗ и ledger |
| Клиенты/филиалы/права | `modules/auth/`, `modules/clients/`, `modules/branches/`, `modules/skus/` | Проверять clientId + connectionId + склад исполнения; один номер заказа не уникален между кабинетами |

Все пути `modules/` в таблице начинаются с `apps/api/src/`, кроме явно помеченных
путей снимка `.js`. Основные входы: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`,
`apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/api/prisma/schema.prisma`.
Android в этой базе **Java**, не Kotlin:
`apps/android-tsd/app/src/main/java/pro/logoff/wms/tsd/MainActivity.java`,
`network/WmsApi.java`, `network/WmsApiFactory.java`.

## Связь экранов сборки и печати

```text
Android WmsApiFactory (physical-pick-v1)
  → TsdDeviceController / CurrentFbsTsdUser
  → MarketplaceConnectionsService.formatFbsTsdAssembly
      → orderSticker = null, physicalPickConfirmation = true
      → MainActivity / FbsAssemblyUi: номер стикера + «Товар отобран»

Кнопка печати при переклейке
  → TsdRelabelPrintService.fbsCreate
  → задание тихому агенту: два стикера целевого SKU
  → проверочный скан целевого ШК
```

Общий контроллер связывает операции технически, но включение печати целевого SKU
не должно включать экран стикера заказа. Именно эту границу проверять при обеих доработках.

## Данные для диагностики

Проверять цепочку `ClientMarketplaceConnection` → `FbsOrderRequestLink` →
`ClientRequest`/`ClientRequestItem` → `FbsTsdAssembly` → `StockBalance`/`StockMovement`
→ `ProductMark` → `Box`/`StoragePalletBox`. Показания интерфейса, плановые allocations,
фактические сканы, печать и отгрузка — разные источники доказательств.
Не исправлять остатки исключительно ради совпадения с сохранённой инструкцией.

## FBS box scan latency (PR317)

`marketplace-connections.service.ts`: `scanFbsTsdBox` / `performFbsTsdBoxScan`, `switchFbsTsdAssemblyToBox`; `fbs-box-scan-search.ts` narrows candidates, batches search reservations and shares pending scans. Flag default off; transactional revalidation remains authoritative. See [release checks](releases/fbs-box-scan-latency/README.md).

## OpenClaw — ИИ нашей WMS

API: `modules/wms-ai/wms-openclaw.service.ts`, `wms-ai.controller.ts`,
`dto/wms-openclaw-job.dto.ts`; web: `components/wms-ai/OpenClawPanel.tsx`,
`lib/openclaw-api.ts`. Настройка — `infra/openclaw/`, паспорт — `docs/openclaw-wms.md`.
Выпуск: `scripts/openclaw-release.cjs`, `deploy-openclaw.py`,
`openclaw-candidate-smoke.cjs`; тесты рядом и `scripts/tests/test_deploy_openclaw.py`.
Правило firewall ограничено внутренней сетью нашей WMS. При неизвестном результате
задание не повторяется автоматически. В проданном окружении флаг не включать.

## Постоянная станция Windows

Setup-Agent → AgentLifecycle (сохранённый stationId, задача пользователя) → основной агент → JobJournal → существующие FBS/generic/series API. Рендер этикеток и PrintDocument серии сохранены. [Проверки и установка](print-agent-lifecycle.md).


PR604: personal login welcome correction published; see [details and tests](personal-login-welcome.md).


Published PR606 Eleonora account correction: legacy Elya ID differed from actual login. [Details and regression](eleonora-account-welcome.md).


Prepared 2026-10-24: [request removal](request-removal.md). Additive ADMIN/OWNER API, shared ownership guards, request/Ozon buttons; default-off own-WMS flag; no schema or physical stock changes.
