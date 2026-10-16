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
