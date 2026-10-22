Prepared client turnover stock access: stock reading and Excel no longer depend on internal statistics rights. Existing stock:read, client, warehouse and receipt availability filters remain. API3551/web466 tests pass;155/2 skipped, dedicated KIZ integration suite excluded. TypeScript passed. Actual runtime regression fails before/pass after; candidate API scoped export proof passes. One API module and two web files over PR659; sold WMS unchanged.

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

Prepared: Ozon label explicit 429 regression (fails before fix); transport failure, HTTP500 and long cooldown runtime guards. See [scope](ozon-label-throttling.md).

Published PR629 / 2026-10-16: receipt series XLSX uses recorded product label barcodes instead of unordered GTIN aliases. Scoped accepted TSD scans, unambiguous legacy fallback. API3507/web445, source6, container7, TypeScript and exact two-file delta passed;155/2 skipped, dedicated KIZ DB suites excluded. Live 1310 export verified4474 units. Web/APK233/flags unchanged. Baseline `2026-10-16-receipt-scanned-barcode`, sourceParityVerified=false. [Details](receipt-scanned-barcode.md). [Evidence](releases/receipt-scanned-barcode.json).

Published PR627 / 2026-10-16: interrupted WB auto assembly now persists request ownership atomically, journals supply intents/IDs and recovers under locks with exact WB composition and routing checks. API3501/web445, source11, candidate/live8, PostgreSQL4, TypeScript and baseline8 passed;155/2 skipped, dedicated KIZ DB suites excluded. Four API modules, own-installation durable flag only. Web/APK233 unchanged. Baseline `2026-10-16-auto-assembly-interrupted`, sourceParityVerified=false. [Details](auto-assembly-interrupted.md). [Evidence](releases/auto-assembly-interrupted.json).

Published PR620/621 / 2026-10-15: durable bounded WB reconciliation queue and on-demand request readiness, exact lookup and assigned attention cases. API3487/web443, TypeScript, isolated PostgreSQL6, candidate/live browser7, actual API6, migration runner and baseline8 passed;155/2 skipped, dedicated KIZ DB suite excluded. Six API files, additive queue table and web graph; new flags enabled only on our WMS. PR618 monitoring retained; APK233, printing and sold WMS unchanged. Baseline `2026-10-15-reconciliation-tools`, sourceParityVerified=false. [Details](reconciliation-tools.md). [Evidence](releases/reconciliation-tools-20261015.json).

Published PR618 / 2026-10-15: WB monitoring uses current warehouse routing and exact reservation evidence. EXCLUDED routes are filtered before listing/ingestion/checking; WAITING_STOCK cannot confirm a reserve. API3475/web443, source/runtime13 and Docker6 passed;155/2 skipped, dedicated KIZ DB suites excluded. Four API modules only; WMS_FBS_MONITOR_ROUTING_ENABLED=true. Web/APK233 unchanged. Baseline `2026-10-15-monitor-routing`, sourceParityVerified=false. [Evidence](releases/wb-monitor-routing.json).

Published PR616 / 2026-10-15: bounded API request timing and compact TSD replay receipt reads. API3462/web443, TypeScript, actual-image7 and live read-only SQL verification passed;150/2 skipped, dedicated KIZ DB suites excluded. Three runtime files; two own-WMS flags enabled. Web/APK233/print agent/schema/stock/sold WMS unchanged. Baseline `2026-10-15-operation-reads`, sourceParityVerified=false. [Details](operation-read-diagnostics.md). [Evidence](releases/operation-reads-20261015.json).

Prepared: [request diagnostics and compact TSD replay reads](operation-read-diagnostics.md). Three API runtime files only; API3462/web443 and actual-image7 passed. Queue/schema excluded; sold WMS unchanged.

Published PR614 / 2026-10-15: [объединённый макет Ozon](ozon-combined-layout.md) — компактное создание, 4–6 плиток, выбранная сборка/грузоместа снизу. Web443/API3454, TypeScript, baseline8, candidate/public graph browser и legacy layout passed;2/150 skipped, dedicated KIZ DB suites excluded. Exact34-file web delta; 94 public graph files verified. API/APK233/config/business records/sold WMS unchanged. Baseline `2026-10-15-ozon-combined`, sourceParityVerified=false. [Evidence](releases/ozon-combined-20261015.json).

Published PR612 / 2026-10-15: Ozon FAILED cargo retry requires fresh terminal failure, confirmed empty remote cargo arrays, binding/composition checks and atomic claim with previous-operation audit. Object-form errors now shown. Six regression cases; API3454/web442, TypeScript and actual-image4 passed;150/2 skipped, dedicated KIZ DB suite excluded. One API module (upload/status); web/APK233/flags/stock/sold WMS unchanged. Request2058 retried only SPb and Novosibirsk; all8 directions SUCCESS, other6 submission IDs and labels preserved. Baseline `2026-10-15-ozon-retry`, sourceParityVerified=false.

Published PR610 / 2026-10-15: exact int64 Ozon cargo IDs retained on response parsing and label serialization. Two regressions fail before/pass after; API3448/web442, TypeScript and actual-image smoke passed;150/2 skipped, dedicated KIZ DB suite excluded. One API module, only call/labels methods; web/APK233/flags/stock/sold WMS unchanged. Request2059 cargo IDs restored through audited status check, existing submission preserved; labels generated with 3 correct pages. Baseline `2026-10-15-ozon-ids`, sourceParityVerified=false.

PR608: Ozon closed-carton reopen dispatcher/DTO runtime cases5; source tests9; Android263 per flavor. UI cancellation, ordinary packing after reopening, feature guards and durable replay verified.


Published PR606 / 2026-10-14: Winx welcome now assigned to actual login Eleonora (display name Elkapone), not separate Elya account. Sofia unchanged. Web442/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. TypeScript, baseline8 and six public-site browser cases passed with real network HTML/JS/CSS/video (only API mocked). One account-ID change plus cache-safe graph renaming; API/APK232/configuration/business data/sold WMS unchanged. Baseline `2026-10-14-eleonora-account`, sourceParityVerified=false. [Details](eleonora-account-welcome.md). [Evidence](releases/eleonora-account-20261014.json).

Published PR604 / 2026-10-14: personal welcome after successful login for verified Sofia/Eleonora IDs in all themes; supplied Disney/Winx animations, exact text, skip and completion. Web441/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. TypeScript, baseline8 and actual runtime login/appearance/Ozon tests passed. Exact33-file web delta over sidebar-contrast; API, APK232, configuration, business records and sold WMS unchanged. Baseline `2026-10-14-personal-login`, sourceParityVerified=false. [Details](personal-login-welcome.md). [Evidence](releases/personal-login-20261014.json).

PR601: `scripts/sidebar-count-contrast.browser.test.cjs` verifies actual Light/Dark badge contrast; WMS_TEST_CSS supports candidate and published styles.

Published PR598 / 2026-10-14: Winx and Disney styles in la_panthera, 33 supplied wallpapers, themed cursors and centered personal welcome. Web440/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. Candidate/live login, restoration and Ozon inline browser checks passed. Exact 74-file web delta; API, APK232, configuration, stock and sold WMS unchanged. Baseline `2026-10-14-panthera-magic`, sourceParityVerified=false. [Details](panthera-magic-themes.md). [Evidence](releases/panthera-magic-20261014.json).

Published PR599 / 2026-10-14: Ozon online execution embedded below the link-import form in the left column; right assembly list stays usable. Optional embedded mode preserves other modal callers. Web434/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. TypeScript, source/candidate/live browser checks passed. Only workspace and panel display properties changed in current runtime; API, APK232, flags, operations and sold WMS unchanged. Baseline `2026-10-14-ozon-inline`, sourceParityVerified=false. [Evidence](releases/ozon-inline-20261014.json).

Published PR596 / 2026-10-14: compact Ozon customer forms/cards; full assembly list uses page scrolling instead of the 585px inner viewport; themed native file/template controls. Web433/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. Five-row source/candidate/live browser checks, five widths, three appearances and native file chooser passed. CSS + index only; application JS, API, APK232, print agent, configuration, stock and sold WMS unchanged. Baseline `2026-10-14-ozon-compact`, sourceParityVerified=false. [Evidence](releases/ozon-compact-20261014.json).

Published PR594 / 2026-10-14: approved Ozon customer workspace 65/35 layout, responsive import and supply panels, named accounts. Web433/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. Source/candidate/live browser checks at five widths and three appearances, both import entry points and eight baseline tests passed. Exact 34-file web overlay; API, APK232, print agent, configuration, stock and sold WMS unchanged. Baseline `2026-10-14-ozon-layout`, sourceParityVerified=false. [Details](ozon-workspace-layout.md).

PR592: FboTwoStageScreenTest covers restored loose-picking checkpoint without stock mutation, plus prior marking and pending-operation regressions. 260 tests per Android flavor passed.

PR590: `ozon-link-import.spec.ts`, `OzonLinkImport.spec.tsx`, `api.ozon-link-warehouse.spec.ts`; actual runtime browser and read-only smoke in `scripts/releases/ozon-client-access-20261014`. API3437/web431 passed,150/2 skipped; dedicated KIZ DB suites excluded. Both managed clients, named accounts and branch isolation verified.

PR588: FboTwoStageScreenTest covers unmarked manual top-up and definitive rejection in both acknowledgement protocols. 260 tests per Android flavor passed.

PR586: `fbo-unplaced-confirmed.spec.ts` verifies receipt-gated routes and picking, reserves and disabled capability. `wms-stock-availability.service.spec.ts` preserves client pallet-sort filtering. Six compiled runtime checks: `scripts/releases/fbo-unplaced-20261013/smoke.cjs`. API3431/web427 passed.

PR584: Ozon cargo throttling regression tests in `ozon-assembly-supply.spec.ts`; compiled transport/recovery and read-only request2000 proof in `scripts/releases/ozon-rate-20261013/smoke.cjs`. API3423/web427 passed;155/2 skipped.

PR561/562: manual FBS helper/service/PostgreSQL tests; `scripts/tests/fbs-manual-runtime-browser.cjs`; live staging and published preview are rolled back. Source and candidate PostgreSQL scenarios pass; read paging preserves uint64 WB cursor.

PR555: `wb-barcode-identity.spec.ts` and `scripts/tests/wb-barcode-runtime.cjs`; real catalog synchronization and guarded SKU update tested against the pinned candidate.

PR553: `marketplace-product-links.spec.ts`, `marketplace-product-links.integration.spec.ts`, `api.product-links.spec.ts`, `marketplace-product-links-runtime.cjs`, `marketplace-links-browser.cjs`.

PR539 marketplace isolation: `fboRequestScope.spec.ts`, `client-requests.service.spec.ts`; actual runtime `scripts/tests/fbo-marketplace-runtime.cjs` and read-only `scripts/releases/fbo-marketplace-20261009/smoke.cjs`. API3266/web414 passed, 144/2 skipped; runtime2 passed.

LOGOFF223 / PR535: [found-KIZ route](kiz-found-tsd-route.md); `KizFoundRouteTest` verifies actual Retrofit paths for all five actions.

Found KIZ: `kiz-found-review.spec.ts`, `kiz-location.service.spec.ts`, `KizFoundPanel.test.tsx`, `KizFoundPolicyTest`; actual candidates: `scripts/tests/kiz-found-postgres.cjs`, `kiz-found-browser.cjs`, `kiz-found-runtime.cjs`. PostgreSQL uses only localhost:55469 and its own kiz_found_review schema.

Ozon supply link: `ozon-supply-policy.spec.ts`, `ozon-assembly-supply.spec.ts`, `ozon-supply.integration.spec.ts`, `scripts/tests/ozon-supply-browser.cjs`.

## Онлайн-выполнение / PR525

`online-plan-view.spec.ts`, `menu-read-catalog-parallel.spec.ts`; готовый API: `online-window-runtime.cjs`; браузер: `online-window-browser.cjs`, `ozon-customer-browser.cjs`, `ozon-entry-browser.cjs`. Старый граф воспроизводит 251 строку закрытой истории; новый проверяет 100-строчные страницы, ошибку/повтор, сворачивание и восстановление. API3230/web411,142/2 пропущены; KIZ integration требует отдельной БД.

PR520: `OzonCustomerWorkspace.spec.tsx`, проверка scope в `ozon-customer-import.spec.ts`, готовый браузерный граф `scripts/tests/ozon-entry-browser.cjs`.

## ФБО Ozon / PR516

`ozon-customer-import.spec.ts`, `ozon-customer-directions.spec.ts`, `fbo-two-stage.integration.spec.ts`; runtime: `scripts/tests/ozon-customer-runtime.cjs`, браузер: `scripts/tests/ozon-customer-browser.cjs`.

# Индекс проверок

Подготовленный режим [счёта по сданным заявкам](billing-done-requests.md):
API `src/modules/billing/billing-done-requests.spec.ts` и `billing-period.spec.ts`,
web `BillingPeriodGenerationDialog.spec.tsx`; выключенный флаг, права, дата сдачи,
прежние даты услуг, общий черновик, смешанные/оплаченные документы, повтор и устаревший расчёт.

При изменении общей точки входа проверять все связанные строки, а не только новый
экран. Наличие имени в коде не заменяет вызов сценария. Production-данные не использовать
для тестовых записей/списаний. Интеграционные БД — отдельные, пропуски явно указывать.

| Изменяемая область | Проверки API (`apps/api/test/`) | Android / другие проверки |
| --- | --- | --- |
| Меню и онлайн, PR514 | menu-read-performance.spec.ts, receipt-report-evidence.spec.ts, shared-read.spec.ts | menu-read-runtime.cjs, menu-read-browser.cjs; сравнение снимка с откатом |
| Компактная упаковка, PR512 | fbo-packing-receipt.spec.ts, fbo-compact-packing-runtime.cjs | FboPackingReceiptTest, FboCompactPackingScreenTest; все6 Android variants по232 теста |
| Индекс приёмок, PR509/510 | receipt-stock-index.spec.ts, fbo-remaining-plan.spec.ts | receipt-stock-index.sql, receipt-stock-index-runtime.cjs, test_receipt_index_backfill.py; отдельный PostgreSQL и сверка production с откатом |
| Серия и телефон, PR505 | `print-series.spec.ts`, также на готовом runtime | `printSeries.spec.ts`, `print-series.test.cjs`, `phone-layout.browser-test.cjs`, `scripts/print-phone-runtime.browser-test.cjs`, `scripts/build-print-series-agent.test.py` |
| FBS экран, capability, контроллер | `tsd-fbs-capability.spec.ts`, `fbs-tsd-sticker-number.spec.ts` — также на реальном runtime | `FbsAssemblyUiTest`, `OzonLabelSafetyTest` |
| Переклейка и её печать | `tsd-relabel-print.spec.ts`, `tsd-relabel-label.spec.ts`, `fbs-physical-kiz-relabel.spec.ts`, `pick-instruction-relabel-barcode.spec.ts` + предыдущая строка | `FbsRelabelExternalPrintActivityTest`, `FbsRelabelPrintUiTest`, `RelabelPrintGateTest`, `FbsKizRelabelTest` |
| Несколько единиц и последовательная сборка | `tsd-fbs-capability.spec.ts` с runtime-путями, `fbs-online-remaining-progress.spec.ts`, `fbs-box-scan-route-consistency.spec.ts` | `FbsSequentialPickTest`, восстановление после повторного ответа |
| Очередь заявок и роли | `fbs-lukin-batch.spec.ts`, `fbs-terminal-queue.service.spec.ts` | Owner/admin без лимита; сборщики — закреплённая пятёрка Лукина, другие клиенты без этого лимита |
| Остатки/резерв/маршрут | `fbs-stock-allocation.spec.ts`, `fbs-stale-rescan-reservation.spec.ts`, `fbs-picked-stock-proof.spec.ts`, `fbs-stock-transfer.spec.ts` | Сверить API и таблицу заявки; включить сценарий исходный/целевой SKU |
| Печать/подтверждение/списание | `fbs-print-order-scope.spec.ts`, `fbs-print-stale-kiz.spec.ts`, `fbs-print-ack-billing.spec.ts`, `print-job.service.spec.ts` | Повтор запроса не печатает/не списывает ещё раз; тестовый принтер только с разрешением |
| Автостатусы и уведомления | `fbs-request-auto-status.integration.spec.ts` на изолированной БД и candidate runtime | Сохранить ручной статус и поведение выключенного флага |
| FBO | `fbo-two-stage.integration.spec.ts`, `fbo-picked-reservation.spec.ts`, `fbo-archived-shipping.spec.ts` | `FboTwoStageScreenTest`, `FboPackingProgressTest`, `FboScanStateTest` |
| Палет-сортировка | `pallet-sorting-session.spec.ts`, `pallet-sorting-stock.spec.ts`, `pallet-sorting-terminal-route.spec.ts`, `pallet-sorting-admin-access.spec.ts`, `pallet-sorting-policy.spec.ts` | `PalletSortingRestoreConsentTest`, `PalletSortingAutoSubmitTest`; web `workspaces.admin-sorting.spec.ts`, `PalletSortingPanel.spec.tsx`; `owner-sorting-web-overlay.test.cjs` checks OWNER/ADMIN in actual menu and screen |
| Состав выпуска | `python -m unittest discover -s scripts/tests -p test_release_baseline.py` из `wms/` | verify → materialize → check-candidate; свежий image ID обязателен |

Android-тесты находятся в
`apps/android-tsd/app/src/test/java/pro/logoff/wms/tsd/`.
Для Python-тестов задать `BASELINE_TEST_TMP` каталогом внутри рабочей `work/`.

## Команды

Из `wms/apps/api/`: `node node_modules/vitest/vitest.mjs run --maxWorkers=1 --minWorkers=1`.
Некоторые интеграции требуют переменные тестовых БД; без них полный зелёный отчёт
не означает прохождение этих интеграций. Из `wms/apps/web/` — та же команда Vitest.
Из `wms/apps/android-tsd/` — `gradle :app:testLogoffDebugUnitTest`.
При затрагивании общего Android-кода добавить тесты других затронутых flavors.

Для проверки **собранного** API выставить абсолютные пути:

```text
FBS_RUNTIME_CONTROLLER=<candidate>/modules/tsd/tsd-device.controller.js
FBS_RUNTIME_ENTRY=<candidate>/modules/marketplace-connections/marketplace-connections.service.js
```

Запустить `tsd-fbs-capability.spec.ts`, `fbs-tsd-sticker-number.spec.ts`,
`tsd-relabel-print.spec.ts`, `tsd-relabel-routes.spec.ts` и `fbs-lukin-batch.spec.ts`.
Кандидату нужны совместимые зависимости; не подменять его файлы локальными
ради успешного импорта. В PR фиксировать источник зависимостей и пропущенные проверки.

При каждой правке: тест воспроизводит проблему до исправления → проходит после →
общие тесты → сверка артефакта → PR → проверка опубликованного контейнера.
Физический результат на ТСД/принтере отмечать отдельно от автоматических тестов.


la_panthera full coverage: web/test/build-la-panthera-coverage.cjs --check (47 component stylesheet inventory), la-panthera-contrast.browser.cjs (26 representative views; optional RUNTIME_CSS), la-panthera-hover.browser.cjs (scale/red gradient, stable neighbour, reduced motion, classic isolation). Browser fixtures do not substitute for an authenticated full-screen walkthrough.


## PR396: заявки и la_panthera

- `apps/api/test/client-requests.service.spec.ts`: архив DONE/CANCELLED/REJECTED, явный статус и доступные клиенты.
- `apps/web/src/components/client-requests/requestBatch.test.ts`: источники хранения, noBox только без источника, упаковка, частичные результаты.
- `apps/web/test/request-release.browser.cjs`: фактический runtime; архив, массовая сдача, сортировка, Excel, WB-статус, пантера при сетевой загрузке. Запуск с `RUNTIME_CANDIDATE` на проверенном каталоге кандидата.
- `apps/web/test/sidebar-groups.browser.cjs`, `sidebar-favorites.browser.cjs`: независимые группы и пользовательские быстрые ссылки.
- `apps/web/src/lib/networkLoading.test.ts`: параллельные fetch, чтение тела и ошибки.
- `apps/web/src/components/client-requests/requestZoneTones.test.ts`: большинство активных заказов, границы 12/19 часов, срочные равенства.

Публикация PR396: Web 328, API 2893, 8 baseline-тестов пройдены; пропуски 2/113, отдельная DB-серия KIZ исключена. Снимок `2026-09-29-request-batch-theme`, source parity false.


## PR400: форма, статусы и безопасная массовая сдача

- `apps/web/test/request-release.browser.cjs`: сворачивание всей формы в трёх темах, сохранение ввода, конкретный статус, цвета таймеров 1/15/20 часов и большинства shipped-заказов.
- `apps/web/src/components/client-requests/requestBatch.test.ts`: БЕЗ КОРОБА, единственный достаточный источник, неоднозначный/недостаточный остаток и сохранение выбора.
- `apps/api/test/request-stock-source.runtime.cjs`: фактический упакованный API; недостаточный остаток и незавершённая сборка запрещены без корректировок; достаточный источник разрешён; DTO сохраняет флаг.
- `apps/api/test/stock-operations.service.spec.ts`: те же ограничения на уровне исходников.

Web334/API2895 прошли; 2/113 пропущены, отдельная KIZ DB-серия исключена. TypeScript, браузерные сценарии и runtime-проверки прошли. Снимок `2026-09-29-request-polish`, source parity false.


## PR402: сверка и быстрые ссылки

`apps/web/test/reconciliation-theme.browser.cjs`: графитовый контейнер, заголовок/дата, пустое и заполненное состояния, другие темы и печать. `sidebar-favorites.browser.cjs`: переход без раскрытия группы, drag в обе стороны, клавиатура, сохранение порядка и изоляция пользователей; NAV_RUNTIME позволяет проверить фактический опубликованный адаптер. Web334/API2895 passed, 2/113 skipped; отдельная KIZ DB-серия исключена.


PR404: `apps/web/test/fbs-zone-colors.browser.cjs` — реальные CSS, три цвета кнопок/таймеров, hover, изоляция тем и печати, верхняя строка выбора и нижняя строка действий, компактная высота и перенос на 390px.

## PR406: ordinary picking, reviews and notifications

- `apps/api/test/ordinary-unmarked-pick.spec.ts`: new flag, complete/unmarked/SOS/source guards and found/packed labels.
- `fbs-request-auto-status.integration.spec.ts`: isolated PostgreSQL concurrent retry and all-or-nothing stock shipment; `FBS_RUNTIME_AUTO_STATUS_ENTRY` and `FBS_RUNTIME_ENTRY` repeat against published JS.
- `ordinary-pick.runtime.cjs`: image module loading and disabled-flag isolation; `tsd-fbs-capability.spec.ts` with `FBS_RUNTIME_CONTROLLER` passed all 11 tests on this runtime.
- `KizReviewQueuePanel.test.tsx`, `markAllNotifications.test.ts`: collapsed cases, seven days, complete pagination, new arrivals and partial failures.
- `reviews-notifications.browser.cjs`, `monitoring-notifications.browser.cjs`: actual adapter interactions and CSS; favorites regression also passed.
- Production public page: HTTP200 and zero JavaScript errors. Full hashes, health, APK216 and all preexisting flags verified.


## Compact request columns / all themes

- `apps/web/src/components/client-requests/ClientRequestColumns.test.tsx`: request identity/supply grouping and client above composition.
- `apps/web/test/compact-request-columns.browser.cjs`: actual release runtime; 11 themes, two request columns, combined due/status and actions/process, existing navigation/status callbacks, 390px mobile overflow. Set `RELEASE_ROOT` to the candidate release directory.
- Web/API general suites, TypeScript, baseline verify/materialize/check-candidate and exact web image hash delta before publication. API is unchanged.


## la_panthera Light

- `apps/web/src/components/layout/themeStyle.test.ts`: Dark default, user-isolated Light persistence, invalid/denied storage.
- `apps/web/test/la-panthera-light.browser.cjs`: 30 operational views, text contrast >=4.5:1, exact zone colours, Dark restoration and print exclusion.
- `apps/web/test/theme-style-runtime.browser.cjs`: actual packaged App, adjacent selector, persistence on reload, theme/user switches and selector fitting narrow header. Set RELEASE_ROOT to the release directory.
- `apps/web/test/build-la-panthera-light.cjs --check`: generated colour-only coverage remains current; images and print styles excluded. Palette tuning in la-panthera-light-tuning.css.

## Request action menus (our modern fulfillment contour)

- `RequestActionMenus.test.tsx`: FBO/FBS grouping, unique route, separate orders navigation, administrator-only recovery, legacy opt-out. Three regression assertions failed before the change.
- `test/request-action-menus.browser.cjs`: source and actual runtime React table (RELEASE_ROOT), 13 distinct callbacks with the same request ID, keyboard disclosures, 11 themes including la_panthera Dark/Light, terminal status and administrator restrictions.
- Enabled by existing `VITE_FBO_WORKSPACE_ENABLED`; no server workflow changes. Sold/legacy contour retains its original layout with the flag disabled.
- Web 347 passed / 2 skipped; API 2929 passed / 115 skipped. `kiz-duplicate.integration.spec.ts` requires a dedicated local database and was excluded after its missing-configuration failure. Web TypeScript passed.
- Published as PR414 after actual runtime browser checks, exact public/image hashes and health checks. API PR412 retained. Source/runtime parity remains false; use the surgical runtime release workflow.


## Request label wrapping and simplified menus

- `request-action-menus.browser.cjs`: long Novosibirsk title in a narrow column, no clipped title or overflowing action labels, 12 retained callbacks, 11 themes plus Light; source and actual runtime.
- `RequestActionMenus.test.tsx`: modern menu excludes manual stages and emergency controls even for administrators; legacy opt-out unchanged. Regression failed before the fix.
- CSS and existing runtime adapter only; no API changes.


## Approved request list and online menus

- `RequestActionMenus.test.tsx`: Online replaces Route; composition downloads move into Documents; manual, emergency, source-selection and standalone instruction actions removed from modern list.
- `onlineRequestToolbar.test.tsx`: original download callbacks, optional edit/cancel, unchanged status predicates, assembly body retained.
- `request-action-menus.browser.cjs`: source and actual runtime; 11 themes plus Light; eight retained list callbacks, online documents/WMS boxes/edit/cancel/refresh/close, denied actions absent, no clipped labels.
- Web351 passed/2 skipped; TypeScript passed. API unchanged.


## Four equal request menu rows

- Browser regression checks four vertically sequential controls, equal width/56px height, identical background/text colour, horizontal and vertical centering for FBS/FBO and all themes. Failed against PR416 before CSS fix. Existing keyboard and callback tests retained.
- CSS-only release; JavaScript/API/APK unchanged.

PR447: `fbo-plan-timeout.spec.ts` and `fbo-plan-timeout.runtime.cjs` cover concurrent plan reads, caller denial, retry/freshness, context isolation and bounded shipped-order lookup.

PR449: `fbo-route-decision-cache.spec.ts` / `.runtime.cjs`: snapshot-local decisions, all contained SKU demands, flag isolation and12 compiled ordering comparisons.

PR451: fbo-recovery-transaction-retry.spec.ts / .runtime.cjs cover external transaction ownership, unchanged ordinary retry and single outer receipt.

PR453: fbo-recovery-route.runtime.cjs verifies no route within recovery, unchanged ordinary route and409after bounded retries; real1568rollback smoke passed after publication.

kiz-unfinished-cancelled.runtime.cjs: cancelled never-shipped binding, physical proof, negative cases; previous kiz-released-review.runtime.cjs unchanged.


PR492: API3109/141 skipped, web390/2 skipped, Android454; exact runtime tests и браузерный smoke в scripts/releases/cabinet-fbo-20261007. [Ограничения](cabinet-export-and-fbo-placement.md).


PR494: API3118/141 skipped, web391/2 skipped, runtime5, actual browser и PostgreSQL rollback; kiz-duplicate.integration требует отдельной тестовой БД.


## Подозрительные ШК приёмки (09.10.2026, не опубликовано)

[Поведение, влияние и ограничения](receipt-barcode-review.md).
API: `receipt-barcode-review.spec.ts`, `receipt-barcode-workflow.spec.ts`, `receipt-barcode-legacy.spec.ts`, `receipt-barcode-box-reuse.spec.ts`, `tsd-receipt-close.spec.ts`.
Web: `workspaces.admin-problems.spec.ts`, `test/receipt-barcode-browser.cjs` (mock HTTP, реальный headless Edge).
Android: `ReceiptBarcodeRescanTest`, `ReceiptCloseSyncTest`, LOGOFF и ФФУЛЛ-ХАБ.
Общий прогон: API 3204 passed / 141 skipped, web 408 passed / 2 skipped, Android по 238 passed в двух flavor. PostgreSQL integration не подтверждён: тестовая БД отсутствует; старый kiz-duplicate.integration.spec.ts исключён из повторного общего прогона из-за ошибки создания клиента без URL.
Receipt review: API `receipt-barcode-*.spec.ts`, `tsd-receipt-close.spec.ts`; scoped administrator FBO access `fbo-problems-admin-access.spec.ts`; actual runtime/browser tests `scripts/tests/receipt-*.cjs`. Live role checks run in a READ ONLY transaction (`releases/receipt-barcode-20261009/smoke-admin.cjs`).


## Агент Windows 2026.10.09.1

`apps/windows-print-agent/ack-regression.test.cjs`, `lifecycle.test.cjs`, `agent.test.cjs`, `print-series.test.cjs`: реальный PowerShell5, имитация HTTP/spooler, потеря ACK, перезапуск, mutex, сохранение ID и task settings. Запуск с AGENT_TEST_ROOT на распакованном архиве; AGENT_OLD_SOURCE воспроизводит старую ошибку. [Ограничения](print-agent-lifecycle.md).


PR604: personal login welcome correction published; see [details and tests](personal-login-welcome.md).


Published PR606 Eleonora account correction: legacy Elya ID differed from actual login. [Details and regression](eleonora-account-welcome.md).
