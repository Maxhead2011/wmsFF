Prepared FBS startup repair (2026-11-09): exact editor bundle uses classic JSX and lazy shared-React forwarding; no private React JSX runtime is bundled. Actual published FBS graph import reproduced ReactCurrentDispatcher failure before fix; candidate graph and FBS navigation/reload pass. Immutable editor/FBS asset URLs prevent reuse of the failed module. API, stock/reserve settings, sold WMS unchanged. Regression: scripts/releases/inline-product-reserve-20261109/fbs-startup.browser.cjs. Full web619 passed/2 skipped, TypeScript passed.

Published PR949 / guard PR950 (2026-11-09): fabric tile and page now reuse the existing own-installation host scope, including alternate configured addresses. Exact web2 overlay on PR947; inline product safety reserves, API container, environment, business data and other containers retained. Web619 passed/2 skipped, typecheck, runtime host-scope2 RED/GREEN and guard environment1 passed. Actual public startup/reload and synthetic fabric workflow passed on alternate address and domain; controls24 and request header/disclosures12 before/after. CI passed. Baseline `2026-11-09-fabric-host`; sourceParityVerified=false. No physical TSD or printer change.

Prepared 2026-11-09: fix/fabric-warehouse-host. Fabric tile and page reuse the existing own-installation host scope in the published artifact; direct IP access no longer hides the workspace. Source deployment hosts use VITE_OUR_WMS_HOSTS (comma-separated, default own domain); arbitrary/sold hosts stay excluded. Exact web2 overlay on the fresh PR947 runtime, preserving inline FBS reserves, API/environment/other containers. Tests: web619 passed/2 skipped, typecheck, runtime host-scope2 RED/GREEN, actual application startup/reload and synthetic color/receipt/binding workflow on alternate host, controls24. Release: scripts/releases/fabric-catalog-20261109/host-*. No warehouse writes or schema changes.
Prepared: per-product safety reserve in the FBS product cell (2026-11-09). FbsPanel/FbsProductReserve show the existing reserve override below each name/article, with inheritance, NONE, units/percent and low-stock replacement. Existing versioned SKU rule API, blocked flag preserved; one metadata read on open, no automatic publication, preserve table page. Own-WMS compact-menu gate; sold path unchanged. Web618/2 skipped after merging PR945, TypeScript, SSR/validation2, actual browser two-row save/reload/conflict, exact runtime product-cell3 and candidate full startup/reload passed.
Published PR947 (2026-11-09): individual safety reserve restored below each FBS product name/article. Existing versioned SKU rule supports client inheritance, no reserve, units/percent and low-stock replacement; publication block preserved, no automatic stock increase. Current table page retained after save. Web4 exact overlay; API and other containers/environment unchanged. Web618 passed/2 skipped, TypeScript, browser two-row save/reload/conflict, runtime/public product-cell3, full startup/reload singleton and public controls24 passed. Seven baseline web hashes verified. Baseline `2026-11-09-inline-product-reserve`, sourceParityVerified=false; sold WMS unchanged.

Published PR945 (2026-11-09): Warehouse fabrics workspace, client/material color creation before SKU mapping, and immutable exact-length bindings to existing marketplace-linked WMS SKUs. Current printing and fabric auto assembly retained. Exact API9/web4; all API/web hashes, environment and other containers verified. API4643/web616 passed; dedicated database suites excluded. Isolated PostgreSQL receipt/binding/metre workflow, full Nest startup, public startup/reload and synthetic fabric workflow passed. Controls24 and request header/disclosures12 passed before/after. Live Bushkova catalog/roll reads passed without business writes. No schema changes; physical TSD/printer untested. Baseline `2026-11-09-warehouse-fabric`; sourceParityVerified=false. [Proof](releases/warehouse-fabric-20261109.json).

## Подготовлено: ткани в складе, новые цвета и привязки

Ветка `feature/warehouse-fabric-colors`; не опубликовано. [Описание и проверки](warehouse-fabric-catalog.md). Пункт «Склад → Ткани: хранение и учёт», новый цвет до привязки SKU, точный метраж отреза и сохранение привязки при синхронизации. Кандидат только для нашей WMS; production и проданная WMS не изменены.
Published PR943 (2026-11-09): WB fabric auto assembly accepts FABRIC_ON_DEMAND display metadata only with no task and freshly verified fabric settings/SKUs, rechecked under the order lock. Existing-task picking guards retained. Exact API2 overlay on the independently inspected current server (source/runtime parity=false), inverse/helper parity verified; all other API bytes/web/environment/container IDs retained. API4620 passed/9 skipped, regression6 RED/GREEN, actual runtime preview5 before/after, isolated API/PostgreSQL and CI passed; public startup/reload passed. No stock adjustments or manual order creation. Bushkova schedule stays enabled at09/12/15/18 Moscow. [Proof](releases/fabric-auto-20261109.json).

Published PR941 (2026-11-08): WB supply sticker matches the user reference layout on 58x40 media: large QR with supply number, quantity and destination, rotated artwork and zero PDF page rotation. Renderer-only API1, all761 hashes verified; no delivery transition. API4619/12 focused, runtime6, isolated API/PostgreSQL and CI passed; web614 retained, public controls24/startup/reload checked. QR203dpi monochrome/global threshold verified; physical print untested. Other containers/environment/web/agent/sold WMS unchanged. Baseline `2026-11-08-wb-supply-label-layout`; sourceParityVerified=false.

Published PR939 (2026-11-08): WB FBS supply sticker is generated before delivery and included in Download all / Print all. Verified full WB membership and destination; vector QR58x40. Exact API2 overlay; all761 runtime hashes verified. API4618/web614, focused11, runtime6, isolated API/PostgreSQL, CI and public controls24/startup/reload passed. Live request2823 read-only PDF/QR checked; no physical printing. Web, agent, environment, other containers and sold WMS unchanged. Baseline `2026-11-08-wb-supply-label`; sourceParityVerified=false.

Published PR936 (2026-11-08): SOS request printing lists only active WMS requests; DONE/CANCELLED/REJECTED are excluded both from the list and direct scans. API4618/web614 passed (9/2 skipped; dedicated DB integration excluded), RED/GREEN regression, runtime6, isolated full API/PostgreSQL and CI passed. Exact API1 predicate overlay; all760 published API hashes verified. Web document actions PR932, selected WB reads PR934, APK9, environment, other containers, stock/billing and sold WMS preserved. Live list read-only verification passed. Refresh SOS list; no APK reinstall. Baseline `2026-11-08-sos-active-only`; sourceParityVerified=false. API sha256:4a6ce5af2b330a7ffa8d3832b94d5f98753bc18cd7e12240732861d361420781; web sha256:5cd37f77e3726cc5e481724a43c864a80b7e445f4642085de9244c644f6a83ab.

Published PR932 (2026-11-08): WB FBS document panel retains Download all, Print all with printer selection, Download individual and Pick list. Separate PVZ/SC/cargo QR shortcuts removed; ribbon contents and PR929 printing retained. Exact web2 overlay from PR934; API, environment, other containers, agent, warehouse and sold WMS unchanged. Web614/API4602 passed (2/9 skipped; DB integration excluded), types, runtime7, controls24, startup/reload before and after. No physical print job sent. Baseline 2026-11-08-wb-document-actions; sourceParityVerified=false.

Published PR934 (2026-11-08): selected WB sticker reads replace the full operational client refresh and reuse one request-local snapshot for SC/PVZ/pairs. [Scope and validation](wb-label-selected-read.md). Actual published full-handler read-only timings: 2817 1286ms/3 pages, 2818 1303ms/5 pages, 2781 1164ms/8 pages; browser transport/physical print excluded. API4613/web613 passed (9/2 skipped; dedicated DB suites excluded), focused40, exact runtime6, baseline8, isolated API/PostgreSQL and CI passed. Existing two Yandex type errors remain. Exact API2; all760 API hashes verified. Web, environment, other containers, SOS9, TSD258 and sold WMS unchanged. Baseline 2026-11-08-wb-label-selected-read; sourceParityVerified=false. API sha256:9d9cc419a8adfa851aaaedc6ad0bd501a38ebc8e87ba5e96a42fa04f46c733f4; web sha256:79a1d9a4ef78c04a77c8efa933b58045f461d5a59e8130c148988ee8137d535c.

Published PR931 (2026-11-08): SOS WB2 APK9 post-pick WB/Ozon printing, routed by client KIZ policy, no repeated stock/billing/shipment. API4605/web613 and Android16 passed (9/2 skipped; dedicated DB suites excluded), runtime8, RED/GREEN ACK, isolated API/PostgreSQL and CI passed. Live client/request list read-only; physical printing unverified. Exact API4 and download-assets3; all759 API hashes and public APK/metadata verified. Environment/other containers/sold WMS unchanged. Baseline `2026-11-08-sos-post-pick`; sourceParityVerified=false. API sha256:48595b98f735dbef559cbe9d45917bcce50b63f037e897cb210b660b685181ab; web sha256:79a1d9a4ef78c04a77c8efa933b58045f461d5a59e8130c148988ee8137d535c.

Published PR929 (2026-11-08): WB FBS whole-ribbon printer selection, one existing series job, retry UUID and missing-label warnings. API4583/web613 passed (9/2 skipped, DB integration excluded), exact runtime6/handler7/dialog4, isolated full API/PostgreSQL, controls24, web types, startup/reload before and after. Actual five-page PDF render278ms; real WB PDF assembly610–922ms excludes browser network/list loading. Physical print untested. API4/web3 exact overlay from PR927/928; other files, environment, containers, warehouse data, TSD, agent and sold WMS unchanged. Baseline2026-11-08-wb-ribbon-print; sourceParityVerified=false. API sha256:34bd30539b3efc3e9bf4c1899422f26ce3c1f6f25637e2d741fedbf3621d3e83; web sha256:96deed3e13820ce90900e2a3fcde39b54780f54c667bcaa50f15b06d3028cd06.

Prepared 2026-11-08: WB FBS ribbon printer selection via existing series queue, one job and retry UUID. API4583/web613; runtime6, handler7, dialog4. See docs/wb-all-labels.md and scripts/releases/wb-ribbon-print-20261108. Based on PR927/928; not yet published; physical printer untested.

Published PR927 (2026-11-08): all FBO Ozon cargo labels in one verified agent job; printer selection, complete-set validation, expired URL refresh and retry UUID. API4575/web612 passed (9/2 skipped; dedicated DB suites excluded), runtime8 with official PDF, browser8 before/after, isolated full API/PostgreSQL, controls24 and startup/reload passed. Request header passed. Web types pass; source API types retain known Yandex/local stale Prisma issues. Exact API4/web4 from PR925; environment, other containers, warehouse records, TSD, agent and sold WMS unchanged. Full batch was not physically printed. Baseline `2026-11-08-ozon-print-all`, sourceParityVerified=false. API sha256:ff392ebd923456f207d382133721f73f0874693dd56b0c3f1de66222dd76d8d3; web sha256:4be167dea06e01e3b24c3331ca0f4718cfb7397cb47867edbdd2cfd6921cd0fe.

Prepared 2026-11-08: FBO Ozon print-all cargo labels, complete-set verification and existing idempotent agent queue. API4575/web612, runtime8/browser8, isolated full API/PostgreSQL, controls24 and startup/reload passed. See wms/docs/ozon-print-all.md (docs/ozon-print-all.md from wms); release scripts scripts/releases/ozon-print-all-20261108. Own WMS only; not yet published.

Published PR925 (2026-11-08): scoped Yandex FBY active counter; API1/web2 exact overlay from PR922, PR924 preserved. API4568/web608 passed, 9/2 skipped; dedicated DB integration excluded. Runtime API6/browser4, full isolated API/PostgreSQL boot, controls24, request header and startup/reload passed; public counter4 passed. Web build passes; two pre-existing API nullable-SKU type errors remain. Business data, environment, other containers and sold WMS unchanged. Baseline `2026-11-08-yandex-counter`; sourceParityVerified=false. API sha256:6a1c602f6766a3609f175e9b380c3a083f655b670ad38cde28f622fdc78faff7; web sha256:1d09014b4aa7defdff0db3100a9a6d52af3ff283248a2363e88ccd510866b32a.

## Подготовлено: счётчик активных заявок Яндекс FBY

Ветка `fix/yandex-fby-counter`, цель PR — `feature/la_panthera`. `ClientRequestsService.activeFboCounts` возвращает отдельное поле `yandex` по связи `yandexFbyShipment`; `FboWorkspace` показывает стандартный счётчик на карточке Яндекса. Сохраняются область клиента/филиала, исключение DONE/CANCELLED/REJECTED, состояния загрузки/ошибки и флаг WMS_MARKETPLACE_WORKSPACES_ENABLED. Изменений складских данных и проданной WMS нет. Не опубликовано.

Published PR922 (2026-11-08): station media presets/custom dimensions, including 70 x 120 mm; uniform agent fit/rotation within printable margins. Current billing-period r2 and WB ribbon preserved. API4557/web607/agent33 passed; 9/2 skipped, dedicated DB integration excluded. Exact runtime API12/browser3, isolated API boot, candidate controls24/header12 and public controls24 passed. Public main module loads once without page errors. Read-only live station confirms 70 x 120. Web types/build pass; two pre-existing Yandex API type errors remain. API3/web3 exact overlay; environment and other containers unchanged. Sold WMS unchanged. Updated agent ZIP published, but ZavSklad installation and physical printing pending. PDF downloads still use viewer fit/auto-rotate. Baseline `2026-11-08-ozon-media`; sourceParityVerified=false. API sha256:c0b0fcebfa6b5661b4e6aefd8cadc303e77117ed4901bbd5dc6475849e97b824; web sha256:1647a9345997216183063e7ecfb137ec85f2d74f9dd7aee970c94719d1b8a7a0.

## 2026-11-08: startup regression and verified recovery

PR919 changed root import aliases but left the direct module script on the old root URL. Import maps do not rewrite script `src`, so two React applications mounted the same root; a full authenticated startup reproduced `removeChild` errors. Extracted button tests did not cover application startup.

The later PR922 runtime already aligns the entry and aliases to `ozon-media-core-20261108.js`. Verified current public startup AND reload using the real modules with synthetic session/API responses: no page errors, one root resource and one session restore per load. No business requests were sent. Observed web `sha256:1647a9345997216183063e7ecfb137ec85f2d74f9dd7aee970c94719d1b8a7a0`, API `sha256:c0b0fcebfa6b5661b4e6aefd8cadc303e77117ed4901bbd5dc6475849e97b824`. The guarded older candidate was stopped when the newer release appeared; it was NOT deployed over PR922. Billing PR918 and printing PR922 retained.

Prevention: `scripts/releases/wb-all-labels-20261108/prepare.cjs` now rewrites the direct entry too; `entry-fix.test.cjs` runs in compact-controls CI. `startup.browser.cjs` tests full current runtime before/after publication (`PUBLIC_URL`, `PLAYWRIGHT_MODULE`; optional `CANDIDATE_HTML` for historical candidate). These checks do not claim a real authenticated warehouse workflow or physical printing. Sold WMS unchanged; source/runtime parity remains false.

## In progress: Ozon station media 70 × 120 (2026-11-08)

Branch `fix/ozon-label-proportions`, merged through PR920; exact runtime candidate based on the current billing-period r2 release. Not published.
`PrintStationFormatPanel.tsx` exposes station paper width/length presets and custom size; `PrintSeriesService.formats/setFormat` enforces the existing own-WMS feature gate and branch binding, validates dimensions and audits changes. Agent `LabelLayout.ps1` preserves proportions, rotates to fit and respects printable margins. Heartbeat refreshes media before queue processing; installer includes the helper. Downloaded Ozon PDFs still use the PDF viewer, not the image agent; physical FBO/FBS output is not yet verified. Second station host access remains pending.
Tests: agent geometry/lifecycle/queue 33 passed; API station/series 12 passed both source and compiled candidate; UI selector/save/error 2 passed. Full web 607 passed, 2 skipped; full API 4557 passed, 9 skipped (DB integration excluded). Web build passed. Changed print modules compile with an isolated client generated from current schema. Full API type-check still has existing Yandex FBY nullable-SKU errors; no unrelated refactor. Source/runtime parity remains false; do not replace full runtime. Exact runtime API12 and browser3 passed; isolated full API boot passed. Stage preserves all files except API3/web3, including the current billing release. Main HTML entry points directly to the new module to prevent duplicate main execution. The preserved published-agent candidate is staged; not installed and physical output unverified. Existing Ozon FBO PDF inspected: ~120 × 75 mm; fitting to 70 × 120 needs rotation and uniform reduction, not actual-size printing.

## Подготовлено: WB FBS — лента доступных этикеток

Published PR919 (2026-11-08): WB FBS available-label ribbon for order, supply group and selected orders. SC → PVZ → existing product/order pairs; partial downloads explain missing sections, access failures remain fatal. Existing individual printing retained; no delivery, cargo creation or metre debit initiated. API4565/web605 passed (9/2 skipped; dedicated DB integration excluded), helper8, runtime6/browser6, baseline8, isolated full API/PostgreSQL boot and CI passed. Public browser6, compact-controls24 and request-header12 before/after; all755 API hashes and web3 public files match candidate. Environment, other containers, TSD258 and sold WMS preserved. Full API typecheck retains two existing Yandex nullable-SKU errors; web passes. Physical printer/real-supply ribbon unverified. Baseline `2026-11-08-wb-all-labels`; sourceParityVerified=false. API sha256:747f21e5b2bfc269ea7e642a2ca73d8851ee41850c42c412b8b836aade1c3d62; web sha256:56bf0c10efdc9f55db12314152fff0abf34a0465d06960629cd86b4a9155091b.

## Опубликовано PR919: WB FBS — лента доступных этикеток

[Скачать все ШК](wb-all-labels.md): СЦ → ПВЗ → пары товара/заказа; частичный PDF с предупреждениями, прежняя печать сохранена. API4/web3, без передачи поставок и списаний.

Published PR916 (2026-11-08): cold/merged saved WB FBS orders now receive the cut-on-demand display mode after scoping. Exact blue fabric articles supported across availability, receipt and shipment accounting. Four actual saved orders verified read-only before/after release without WB calls. API4557/web605 passed (9/2 skipped; dedicated DB suites excluded), source7, runtime9/public9, baseline8, isolated full API/PostgreSQL boot, stock-cell browser2, compact-controls24 and request-header12 before/after; CI passed. Existing two Yandex nullable-SKU type errors remain; no new type errors. Exact API7 overlay, all754 published API hashes match candidate and all3277 web hashes unchanged. Environment, other containers, business data, TSD258 and sold WMS preserved. Physical TSD/printer untested. Baseline `2026-11-08-fabric-snapshot`; sourceParityVerified=false. API sha256:c8ff070ccf544028bde64b233201c24a56fb64b8b12c5d5498d52bed307c7371; web sha256:4ac996970b1b0130bace4e03187a1afc806250b972447c6e4a2e7fe3f176092d.

## Published: PR914 fabric reservation display (2026-11-08)

[fbs-fabric-reservation-display.md](fbs-fabric-reservation-display.md): cut-on-demand WB display and finished-box allocation exclusion; metre accounting and sold WMS retained. API4550/web605, runtime7/browser2, compact-controls24/request-header12 candidate and public, isolated full API boot, read-only20 samples. Exact API2/web2, all754 API files and public hashes verified. Baseline `2026-11-08-fabric-display`, sourceParityVerified=false; TSD258 unchanged.

## Защита оформления заявок и Ozon

[Постоянная проверка 2×2 и переключателей Ozon](compact-controls-release-guard.md): `scripts/check_compact_controls.cjs`, три отрицательных теста и workflow `compact-controls.yml` для каждого PR нашей WMS. Перед выпуском проверять точный web-кандидат, после — публичный сайт. Проверка исходников не заменяет проверку runtime.

Дополнено: настоящий экран заявок — шапка и три раскрывающихся блока, 12 сценариев оформления и 3 намеренные поломки. `request-fold-layout.browser-test.cjs` включён в тот же CI; перед/после выпуска запускать также с `PUBLIC_URL` кандидата/сайта.

Published PR910 (2026-11-08): Ozon FBS paired PDFs use product-first order and shared set/page numbering on58x40mm media. Official vector artwork is fitted above a separate footer, with crop/rotation preserved; no barcode overlay. Multiple products/pages remain one set. Existing own-WMS unmarked-printing flag; WB, marked-only, legacy mode, fabric accounting and sold WMS unchanged. API4545/web603 passed (9/2 skipped; dedicated DB suites excluded), helper24 including3 new (two RED), compiled handler3, baseline8, targeted TypeScript and isolated full API/PostgreSQL boot. Synthetic sample visually checked and four barcodes decoded at203dpi. Live Ozon package-label still returns429: real Ozon label and physical printer unverified. All753 runtime hashes match API1 candidate; public health, environment and other-container guards passed. PR905 web and TSD258 unchanged. Baseline `2026-11-08-ozon-label-numbering`; sourceParityVerified=false. API sha256:520834afbbbd6e4e339ae4d675ccb5803354e8e75aa2d23cb4493a0859cc3d78; web sha256:ee124855d31819a08ea87ec78c14a1e155f4d9d0d4faf10f6eb3525308dee17e.

## Prepared: numbered Ozon FBS label sets (2026-11-08)

[fbs-paired-labels.md](fbs-paired-labels.md): product barcode labels first, then official Ozon pages, with a common set number and page position. All paired pages58x40mm; vector official artwork fits above a separate footer without cropping. Existing own-WMS unmarked-printing flag; WB/legacy/marked-only formats and accounting unchanged. Helper `fabricPairedLabels/numberedOzonLabels/buildFbsProductLabel`, spec24 including3 new; two regressions reproduced before fix. Compiled handler3, synthetic barcode decode4 at203dpi, visual review, targeted TypeScript and isolated full API/PostgreSQL boot. Real Ozon package-label still returns429; real label/physical printer unverified. Exact API1 overlay on PR907 API with PR905 web preserved; scripts/releases/ozon-label-numbering-20261108/. PR target feature/la_panthera.

Published PR905 (2026-11-08): request warehouse actions stay in a strict 2x2 grid at all tested widths; open disclosures span the row. Existing Ozon mode buttons now have a modern segmented light/dark selected style. The earlier auto-fit 8.7em threshold collapsed the grid at larger fonts/narrow columns. Workspace-gated CSS only; no JavaScript, status, stock, schema, TSD or sold WMS changes. RED/GREEN browser24 and public24 on both domain/IP passed; web603 passed/2 skipped, web TypeScript, baseline8. Prior API4521 passed/9 skipped with DB integration excluded; deployment preserves the newer PR907 API unchanged. Exact web2 overlay, all other assets/container IDs/environment retained. Baseline `2026-11-08-compact-controls`; sourceParityVerified=false. API sha256:9ba7837c197ebe2a79943fcd02801f6dbc40d6d7117f2eb5ace0edb8ba3b7315; web sha256:ee124855d31819a08ea87ec78c14a1e155f4d9d0d4faf10f6eb3525308dee17e. Scripts: scripts/releases/compact-controls-20261108/.

Published PR907 (2026-11-08): paired FBS product/official labels for all unmarked WB/Ozon goods independently of fabric enablement. New WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED=true only on our WMS; all other environment entries and containers unchanged. Per-line marking guards retain official stickers for marked goods; exact Ozon SKU/offer/barcode lookup supports WB-origin warehouse cards without DB changes. API4542/web603 passed (9/2 skipped; dedicated DB integration excluded), helper21 including10 new, compiled runtime4, environment guard3, baseline8, targeted TypeScript and isolated full API/PostgreSQL health passed. Full TypeScript retains previous yandex-fby.service.ts nullable-SKU errors. Live Bushkova/Balandin identity checks passed read-only; official Ozon PDF still returns HTTP429, successful live Ozon paired download is not claimed. Physical printer untested. All753 API runtime hashes match candidate, exact API1 overlay; public health passed. Web/TSD258/agent/stock/fabric accounting/sold WMS unchanged. Baseline `2026-11-08-fbs-unmarked-labels`, sourceParityVerified=false. API sha256:9ba7837c197ebe2a79943fcd02801f6dbc40d6d7117f2eb5ace0edb8ba3b7315; web sha256:675d2be1b1f649a0bd2347c23bf56db03f667f425ec18fa32088256a49447e46.

## Подготовлено: парная печать всех немаркированных товаров (08.11.2026)

[fbs-paired-labels.md](fbs-paired-labels.md): новый `WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED` отделяет пары WB/Ozon от учёта ткани и opt-in клиента. `fabricPairedLabels`, `printingOzonCandidates/printingOzonSku`: проверка маркировки каждой позиции и точное сопоставление Ozon через SKU/offer/ШК, в том числе для складской карточки из WB. Только чтение; смешанные заказы сохраняют официальные этикетки маркированных позиций. Выключенный флаг сохраняет PR904. Helper/spec и `scripts/releases/fbs-unmarked-labels-20261108/`; API1 overlay, web/ТСД/проданная ВМС без изменений. Новые10 регрессов (всего21), runtime4, проверка среды3. На реальных заказах Бушковой и Баландина идентичность товара проверена read-only; официальный PDF Ozon пока блокируется HTTP429, успешное скачивание пары Ozon не заявляется. PR в `feature/la_panthera`.

Published PR904 (2026-11-08): fabric-opt-in FBS PDF downloads now pair each product barcode label with the official WB/Ozon order label. Actual request2781 verified read-only before and after publication: four orders/eight pages; all codes decoded at203dpi and long names visually checked. No order shipping, fabric debit or stock mutation by the new helper. Existing deployment/client flags, web, TSD258, Windows agent, environment, other containers and sold WMS unchanged. API4532/web603 passed (9/2 skipped, dedicated DB integration excluded), new11, runtime3, baseline8, targeted TypeScript and isolated full API/PostgreSQL health passed. Full TypeScript retains two existing nullable-SKU errors in yandex-fby.service.ts:46,54. All753 runtime files match the exact API2 candidate; public health passed. Physical printer not tested. Baseline `2026-11-08-fbs-paired-labels`, sourceParityVerified=false. API sha256:9ab7e83ff22cb7f0a79de7316a301bc52ff726ed003187c75c93d7177066c297; web sha256:675d2be1b1f649a0bd2347c23bf56db03f667f425ec18fa32088256a49447e46.

## Подготовлено: парные стикеры FBS ткани (08.11.2026)

[Поведение, ограничения и проверки](fbs-paired-labels.md). В существующий PDF добавлена этикетка товара перед официальным стикером WB/Ozon; отдельный opt-in клиента и флаг нашей ВМС. Новый helper fbs-paired-labels.ts и hook getFbsOrderStickersPdf; runtime overlay API2, web/ТСД/данные/проданная ВМС без изменений. API4532/web603, новые11 и compiled runtime3 проходят; полная проверка типов ограничена двумя прежними ошибками Яндекса.

Published PR902 (2026-11-07): FBY downloads the supplied four-column Yandex VRC workbook from verified packed units, with exact catalogue identities and no stock/status mutations. API4521/web603 passed (9/2 skipped, dedicated DB integration suites excluded), TypeScript, exact runtime API9/browser9, published browser9 with synthetic HTTP, isolated PostgreSQL/full API health, baseline8/deployment3. All752 published API files and web3 match the tested candidate. Live seller-cabinet upload remains untested. Baseline `2026-11-07-fby-export`; sourceParityVerified=false. API sha256:f2b868f7080e84d49a95d500edbb8cfc3283342984ef6defd3ad133fbeb9ef67; web sha256:675d2be1b1f649a0bd2347c23bf56db03f667f425ec18fa32088256a49447e46. Environment, other containers, sold WMS and TSD258 unchanged.

## Prepared: FBY actual packed export (2026-11-07)

The FBY card downloads the supplied Yandex VRC workbook after PACKED/DONE and COMPLETED, with every active unit packed and every box closed/confirmed. RETURNED units are excluded. Counts come from physical units, not demand. A fresh repeatable-read snapshot rechecks readiness after the catalogue request. Export never changes stock, request status or the marketplace supply.

The original four columns and explanation sheet are preserved. Offer ID/name come from the complete catalogue of the selected campaign business; each physical barcode must match. Missing/ambiguous mappings fail with a readable error. Requires offers-and-cards-management:read-only. This is the provided VRC format, not a universal set of documents for all shipment types/marking requirements. The client uploads the file and selects the destination in Yandex.

Files/functions: yandex-fby-export.ts, yandex-fby-template.ts, YandexFbyClient.offers, YandexFbyService.actualContext/exportActual, controller GET export, FbyActualExportButton.tsx, YandexFbyPanel and API route registry. Tests: export/client/service, registry and export button; exact-runtime API9/browser9. Release scripts: scripts/releases/fby-export-20261107/. Existing WMS_YANDEX_FBY_ENABLED gate; no schema/TSD/sold WMS changes. PR target feature/la_panthera.

Published PR900 (2026-11-07): FBY saves successful marketplace status/check time and displays them in the assembly card. Conditional persistence guards newer checks and binding changes. Manual refresh, no WMS stage or stock mutations. API4512/web602 passed (9/2 skipped; dedicated DB suites excluded), TypeScript, runtime API6/browser6, public browser6, isolated PostgreSQL/full API health, baseline8/deployment guard3. Exact API1/web3, all750 live API files and public web hashes verified. Baseline `2026-11-07-fby-status`; sourceParityVerified=false. API sha256:6807feaae610d194d832a09ddf1cc7890199b4f31388296fc3c7718a52ff6edd; web sha256:81b01648062befc2393bfdc97cf4b34b68160702b108dee2dd9c59b8dcaa2ba1. Environment, other containers, TSD258 and sold WMS preserved.

Published PR898 (2026-11-07): asynchronous Ozon ERROR/FAILED now displays a terminal rejection, destination and readable capacity message; partial/unknown operations show NEEDS_ATTENTION. Confirmed directions and retry/cancel guards retained. Exact API2/web5 overlay; all750 API files and five public web hashes verified. API4509 passed/9 skipped plus final targeted51; web600 passed/2 skipped; TypeScript; runtime API9/browser33; published browser33; isolated PostgreSQL/full API boot; deployment guard3. General DB integration suites excluded. Production status-only refresh for2656 verified23 boxes and636 packed units unchanged; zero outbound Ozon mutations. Rostov remains rejected by Ozon (INBOUND_NO_CAPACITY). Environment, other containers, sold WMS and TSD258 unchanged. Baseline `2026-11-07-ozon-errors`, sourceParityVerified=false. API sha256:e80686759f57b72a9b8c5672a3e3d050edac5de6e2dfbd46e2556b4b482dfbe2; web sha256:53d9d0cb42bdc6d0b0a0912c6ddc287119714d01cfce79af9a192b6afcc48ff7.
## Подготовлено: отказ корректировки Ozon (07.11.2026)

`ERROR` и `FAILED` в ответе `/content/update/status` теперь считаются окончательным отказом. `OzonStockAdjustmentService.resume` сохраняет исходный статус и детали ответа; `view` возвращает состояние `NEEDS_ATTENTION`, название направления и понятное сообщение `INBOUND_NO_CAPACITY`. Внутренняя блокировка незавершённой сверки сохраняется. Успешные и отклонённые операции повторно не отправляются, частично успешная корректировка не отменяется вслепую. Короба, единицы, остатки и состав не изменяются при отказе.

Модули: `ozon-adjustment-result.ts`, методы `view/resume` в `ozon-stock-adjustment.service.ts`, `OzonStockAdjustment.tsx`, API-типы. Тесты: регресс ERROR/FAILED, сохранение упаковки, частичный успех и запрет повторной отправки/отмены; браузер показывает направление и отказ. Точный runtime overlay API2/web5 от PR895; другие методы и существующие web-файлы сохранены. Схема БД, флаги, ТСД258 и проданная ВМС не меняются. Выпуск `fix/ozon-adjustment-errors` → `feature/la_panthera`. Скрипты: `scripts/releases/ozon-errors-20261107/`.
Published PR895 (2026-11-07): permanent Ozon physical reconciliation and inbound composition controls in online assembly. AVAILABLE/PICKED bases; CONTROL uses closed packed boxes. Saved scans, boxes, stock movements and sold WMS preserved. Exact API3/web6 overlay; all749 published API files match tested candidate, six public file hashes and API health verified. API4507/web600 passed (9/2 skipped; DB integration suites excluded), isolated PostgreSQL/full API boot passed, runtime API8/browser30, published browser30 plus inbound-list regression8 passed with synthetic API. Deployment environment comparison normalized in PR896 (three tests); initial guard rollback verified before successful publication. Environment, other containers and TSD258 unchanged. Baseline `2026-11-07-ozon-physical`; sourceParityVerified=false. API sha256:2f27603ad251273472c4219ec1ac65f2b8b80519a50afd84166a644acc7bda55; web sha256:9a371a8d27e959e88e8915f53fee4e7c4333840c11599816c30f9ec30df2f5c9.
Проверка выпуска PR895: сравнение окружения Docker нормализовано по порядку записей (release.py::env_hash); значения и дубли ключей проверяются строго. Три автоматических теста test_release.py. Бизнес-код и проданная ВМС не изменены.

## Подготовлено: постоянная сверка состава Ozon (07.11.2026)

В онлайн-сборке две отдельные кнопки: «Скорректировать Ozon по факту» (ВМС → Ozon) и «Обновить состав из Ozon» (Ozon → ВМС). Первая предлагает наличие или фактический отбор; на контроле берёт упакованные единицы закрытых коробов. Сравнение включает товары, оставшиеся только в Ozon. Отсутствующее сопоставление требует проверки карточки того же кабинета. Подтверждение закрепляет локальный состав, короба и свежий состав Ozon; неизвестный результат отправки не повторяется автоматически. Короба, сканы и движения не переписываются. Пустое направление и уже переданные грузоместа требуют отдельного решения.

Модули: `ozon-physical-reconciliation.ts`, `OzonStockAdjustmentService` (preview/start/resume/cancel), контроллер, `OzonStockAdjustment.tsx` и его scoped CSS/API типы. Новый серверный контракт включается явным mode; старый контракт сохранён. Схема БД, ТСД и проданная ВМС не меняются. Точный overlay: три API-файла и шесть web-файлов поверх опубликованной базы PR893; полная локальная сборка не заменяет runtime.

Проверки: API 4507 passed / 9 skipped (DB integration suites исключены); web 600 passed / 2 skipped; TypeScript API/web; целевые API57; runtime API8; браузер10 на исходниках и 30 на трёх действующих модулях; регресс PR893 browser8. Полный API с обеими Prisma-схемами запущен на отдельном PostgreSQL, health успешен. Бизнес-операции проверялись на синтетических данных, рабочие заявки не изменялись. Выпуск через `feature/ozon-physical-reconciliation` → `feature/la_panthera`; sourceParityVerified=false. Детали: [корректировка Ozon](ozon-stock-adjustment.md); скрипты `scripts/releases/ozon-physical-20261107/`.
Published PR893 (2026-11-07): active FBO Ozon requests have an explicit inbound composition button. Preview and confirmed apply use existing server guards; no outbound Ozon change. Exact current-runtime web3 overlay; original assets, IPv4 hosts, API, TSD258, environment, business data, other containers and sold WMS preserved. Web600/2 skipped, API4491/9 skipped (DB integration excluded), targeted38, source browser8, exact-runtime browser8 and published browser8 passed; public hashes verified. Browser requests were intercepted synthetic fixtures, not production writes. Baseline `2026-11-07-ozon-inbound`; sourceParityVerified=false. Web sha256:05e100b3bdb2a08d9d2053d2beab0d34bc752b053ebd351b13ef7d38799d40c6.

## Опубликовано PR893: состав заявки из Ozon перед сборкой (07.11.2026)

В списке активных сборок нашей ВМС добавлена кнопка «Обновить состав из Ozon» для этапов NOT_STARTED/PICKING и статусов SUBMITTED/APPROVED/IN_WORK. `OzonAssemblyList` передаёт действие в `OzonCustomerWorkspace`, который открывает отдельный `FboWorkspaceModal` с `OzonCompositionSync`. Доступ соответствует существующим правам контроллера/сервиса: system:admin либо client-requests:write совместно с CLIENT/stock:write.

Используется существующий серверный `sync-preview`/`sync-apply`: Ozon → ВМС, без изменения Ozon. До сохранения показаны количества и направления, требуется явное подтверждение; заново проверяются привязка, состав, отбор и упаковка. При совпадении количеств можно подтвердить обновление данных поставки. Ошибка применения сбрасывает предпросмотр, повтор требует свежей сверки; поздний ответ закрытого окна игнорируется. После успеха список обновляется. Старый экран корректировки по физическим остаткам и проданный интерфейс не изменены; сервер, БД и ТСД не изменены.

PR893 объединён в `feature/la_panthera` и опубликован точечным web overlay от актуального runtime. Подготовка/проверки/публикация: `scripts/releases/ozon-inbound-20261107/`. База `2026-11-07-ozon-inbound`; sourceParityVerified=false.

Published PR891 (2026-11-06): linked receipt XLSX shows final box/SKU quantities, without signed movement rows. Live list and download verified: 961 units, 27 boxes, 66 positive data rows. No stock or KIZ writes. API4480/9 skipped, web595/2 skipped, targeted11, TypeScript and runtime3 passed; DB integration excluded. Exact two-file overlay; all 748 live files match candidate. TSD258, barcode resolution, recovery and latest assembly change retained; web/environment/other containers/sold unchanged. Baseline `2026-11-06-receipt-final`; sourceParityVerified=false.

Published PR889 (2026-11-06): LOGOFF TSD258 shows WMS request number and total units on FBO cards. API4488 passed/9 skipped; Android346 passed; exact runtime5 passed. Live read-only request2656:636 units/53 rows. Both signed APK channels verified; physical TSD not tested; DB integration excluded. One API module changed, environment/web/other containers and sold WMS unchanged. Baseline: 2026-11-06-tsd-request-summary; sourceParityVerified=false.

## Prepared: TSD request identity and units (2026-11-06)

`tsd-assembly.service.ts::listActiveRequests` selects the WMS number and sums request item quantities into `totalQuantity`, preserving row-count fields. `TsdAssemblyRequestSummary.wmsSummary` and `MainActivity.requestButton` prepend WMS number and units only for LOGOFF; legacy server fields remain nullable. No stock, reservation or workflow mutation. API regression failed before fix; API4488 passed/9 skipped (integration suites excluded), LOGOFF Android346 passed; exact runtime5 passed with baseline regression reproduced. New tests: `tsd-request-summary.spec.ts`, `AssemblyRequestSummaryTest.java`. Branch `fix/tsd-fbo-request-summary`; not published. Reconciled PR885/887; signed APK258 ordinary and servers channels retain idle-session257. One-module API delta verified against latest runtime; source parity remains false.

Final receipt export projection: `receipt-final-quantities.ts` groups linked receipt rows by box/SKU; `ReceiptChannelsController.file` exports only positive final quantities. Default-off and unlinked paths unchanged. See [validation](receipt-final-quantities.md).

Published PR887 (2026-11-06): explicitly linked signed inventory corrections appear in receipt totals and XLSX without another stock receipt. Own-WMS flag WMS_RECEIPT_LINKED_ADJUSTMENTS_ENABLED=true; exact three-file overlay, 747 live API files verified against candidate. API4475/9 skipped, web595/2 skipped, targeted10, TypeScript and runtime3 passed; DB integration excluded. Web/APK257 and other containers preserved. Baseline `2026-11-06-receipt-linked`; sourceParityVerified=false.

Published PR885 (2026-11-06): TSD257 login expires after 15 minutes without operator input; active scanning continues beyond eight hours, background polling does not renew login. Own API flag WMS_TSD_IDLE_SESSION_ENABLED=true; both ordinary and servers APK257 feeds published with matching existing signing certificate and public download hashes verified. API4479/9 skipped, LOGOFF Android343, PostgreSQL4 on source/runtime, isolated full Nest HTTP12 passed; additional suite limitations are documented in tsd-idle-session.md. Exact API8 overlay; all746 captured live files match verified candidate. API sha256:037a1fea30d6cbb89f499d1bfeb8297634568dee1bcf076431d0c955c9791351. Web, business data, other containers and sold WMS preserved. Baseline `2026-11-06-tsd-idle-session`; sourceParityVerified=false. Physical terminal installation/test pending: install257 and log in again.

Published PR883 (2026-11-06): Lukin stock export selects an unambiguous product barcode instead of marking GTIN. Full mode includes reservations but preserves pallet-sort visibility; no data changes. API4461/web595 tests passed,9/2 skipped; DB integration excluded. Browser3 checks verify single bootstrap and search. Exact API2/web2 deployment; all 745 API files match candidate, live barcode2056223748500 verified read-only. API sha256:f883125b2406f813cc5f4c61d3c21d0e7c179faf061c28ca63f5f8f8b50bdff2; web sha256:285752ab966bb220e4b98232677616cec6ae790064d6246854cd18155fb8dee0. Environment, APK, other containers and sold WMS preserved. Baseline `2026-11-06-stock-export`; sourceParityVerified=false.

Prepared stock export correction (2026-11-06): Lukin full export retains placement visibility and does not subtract active reservations. Product-label selection prefers an unambiguous 13-digit SKU barcode over marking GTIN for Lukin only; other clients are unchanged. UI explains full/reserved mode. API4461 passed/9 skipped (DB integration excluded); web595 passed/2 skipped; exact browser initial/reload/search checks3 passed with one bootstrap. Runtime delta is API2/web2, no stock or card writes.

Published PR881 (2026-11-06): WB fabric reassignment restores the virtual source; validated rescan restores barcode proof without a second debit. API4455 passed/9 skipped (DB integration excluded), targeted TypeScript and exact runtime checks passed. All 744 live files match candidate; API sha256:919ffad45bba3ca5f996d91009f9fb6be9b4f8d30f76a21d03af93bc604a2f27. Read-only order6204727939 proof retains one confirmed5m operation. Web/APK/environment/sold WMS and business records unchanged. Physical TSD retry pending. Baseline `2026-11-06-fabric-reassigned-source`; sourceParityVerified=false.

## Prepared: fabric task source after reassignment (2026-11-06)

`fbs-fabric-queue.ts::tryAssignFabricTask` restores the virtual no-box source for existing WB fabric tasks without resetting scan evidence. `fabric-fbs-scan.ts::scanWbFabric` restores barcode proof on a validated rescan of an already produced piece without invoking production again. Product, counter, lease and transaction checks remain mandatory. API 4455 passed / 9 skipped; database integration suites excluded. Regression tests reproduced three failures before the fix; invalid barcode/counter tests also pass. Only these two runtime modules are intended for our WMS; sold deployment, APK, web and business records are unchanged. Not yet published.

Published PR879 (2026-11-06): later fabric receipts can cover new FBS orders while historic pending shipment consumption remains unchanged. Strict latest verified shipment cutoff scoped to client/warehouse; missing proof blocks assignment. Business conflicts shown to picker. Exact API5 overlay; all 744 live files match candidate. API sha256:c7dd6be32995f78be2ee031def2954ed38cc02866089fda8ee8632512463a5b6. API4450/9 skipped (integration excluded), targeted TypeScript, runtime and read-only live2744 probe passed. Completed white task and pending264m preserved; no business writes. Web/APK/environment/other containers/sold unchanged. Baseline `2026-11-06-fabric-later-receipts`; sourceParityVerified=false. Physical TSD scan not tested.

Published PR877 (2026-11-06): untouched WAITING_STOCK fabric tasks can be assigned from raw rolls. Exact API1 overlay; all 744 live files match verified candidate. Existing physical evidence and atomic claim guards retained. API4439 passed/9 skipped (integration excluded), focused14, targeted TypeScript and built-runtime checks passed. Full TypeScript remains blocked by pre-existing generated Prisma Lamoda fields. Web, APK, environment, other containers and sold WMS unchanged. Baseline `2026-11-06-fabric-waiting`; sourceParityVerified=false. Physical TSD workflow not tested.

Published PR875 (2026-11-06): separate pro.logoff.wms.tsd.servers channel updated254->256 on new WMS. The UPDATE_APP command reached a254-network terminal, but its feed previously offered254. APK signed with matching70715af4 certificate, Android328 and feed4 tests passed; public HTTPS metadata/package/hash verified. Ordinary256 feed, API, data and all containers unchanged. Android installation confirmation may still be required; physical terminal install not verified. This supersedes the previous note that servers254 feed is retained.

## Servers-package update feed256 (candidate)

The live terminal receiving UPDATE_APP on2026-11-06 reports0.1.254-network. Its separate `pro.logoff.wms.tsd.servers` channel still offers254, so ordinary package256 cannot update it. Build LOGOFF servers256 from the already merged source;328 tests passed, package/version and certificate70715af4 verified. Add versioned download and update only server-choice JSON; ordinary256 and API unchanged. Four feed isolation/drift tests passed. Android may require installation confirmation; command delivery does not prove silent-install privileges.

Published PR873 (2026-11-06): new WMS HTTPS `77.37.144.211/downloads/logoff-tsd.json` advertises signed256 for package pro.logoff.wms.tsd; versioned APK and logoff-tsd.apk aliases installed. Public TLS, metadata and APK SHA256 verified; separate servers254 feed unchanged. Nginx syntax valid, Docker containers unchanged. Existing API/web baseline remains PR870/PR868. Two route-scope tests passed. Physical TSD update pending. Old domain wms.logoff.pro was unreachable from this workstation; its HTTP upstream config was not changed.

## New WMS TSD256 update feed (release preparation)

The installed255 updater reads `/downloads/logoff-tsd.json` from the selected server. On the new WMS `https://77.37.144.211/`, expose version256 metadata and the matching signed APK through exact HTTPS Nginx locations. Old HTTP routing, video and separate `.servers` feed are preserved. No API/container/data changes. `scripts/releases/tsd256-update-feed/test_config.py`:2 tests passed; publication script validates APK hash, merged PR and nginx with config rollback. Physical terminal confirmation remains pending.

Published PR870 (2026-11-05): FBS fabric metres reserved on assignment, consumed on accepted product scan; no separate cutting step. Own API `sha256:9e0fe0a4bc4a56d0ced35ce6b5d0a8eed139c8b8d309938f2a5b3a6692dbb994`, exact13 overlay; all744 live files equal candidate. Web PR868, other containers and sold WMS unchanged. WMS_FBS_FABRIC_CUT_ENABLED=true; audited client opt-in for Bushkova/Khrupova, no stock edits. API4433/9 skipped, web595/2 skipped, sequential integration60/107 skipped, runtime Ozon16/regression30/PostgreSQL8, isolated full Nest health and staged-container checks passed. Android328 passed. LOGOFF256 separate signed-255-compatible APK published and public hash verified; old249 and servers254 feeds unchanged. Physical device update untested. Baseline `2026-11-05-fabric-scans`, sourceParityVerified=false.

Operational limits: Bushkova retains32 historical shipmentPending records (red/ivory); affected material remains blocked pending reconciliation. Khrupova has no recorded rolls. Client enablement does not fabricate receipt or clear historic consumption. Existing Ffullhab receipt tests2 fail on base as well; excluded from LOGOFF release.

## Уточнение процесса 05.11.2026: списание по скану — кандидат, не опубликован

По решению Катерины отдельный этап CUT_FABRIC и кнопка «Нарезано» отменены.
Резерв создаётся при выдаче задания из рулонов; один успешный скан товара
подтверждает один готовый отрез и списывает его длину. Неверный ШК не списывает
ткань. Абсолютный счётчик защищает от повторного списания при повторе запроса.
`fabric-fbs-scan.ts` сохраняет производство и скан в одной транзакции. Для Ozon
сохраняется поштучный состав, включая смешанные заказы. Старый отдельный endpoint
confirm-fabric-cut отклоняет обращения без изменения данных. Неопубликованные
экран и кнопки Android удалены; используется обычный экран сканирования.

Проверено после подключения отмены: API 4433 passed / 9 skipped; TypeScript прошёл.
Целевые проверки — 40 passed, включая 8 PostgreSQL-сценариев. Отмена после паузы
освобождает ненарезанный резерв; повтор не возвращает списанные метры. Освобождение
подключено к отмене клиентской заявки и подтверждённой отмене WB/Ozon; ошибка
транзакции отменяет и смену статуса, и освобождение резерва. LOGOFF Android прошёл.

Release preparation update 2026-11-05 (not published): exact runtime overlay prepared,
13 changed/added modules; runtime Ozon 16, regression 30 and PostgreSQL 8 passed.
Full sequential integration: 60 passed / 107 skipped. LOGOFF unit tests and
unsigned release 253 build succeeded. Token patch helper: 3 tests passed after
correcting the test dependency root. No production changes made by this work.

Signing backup verified as PrivateKeyEntry, alias logoff-tsd-servers; secrets
remain outside Git. Certificate SHA256:
70715AF4C2EA269D393F9CFB15806AEEE920445A22AAC16248E76D621BEDE5DA.
This is distinct from the historic main-app certificate 52916D77... .
Verified user-supplied APK255 at /video/static/downloads/logoff-tsd-receipt-255.apk:
package pro.logoff.wms.tsd, 0.1.255-receipt-time, SHA256
5cc40334f3559932d36510dae9200895fd0fe8419bea3802cb295907cc000a19.
Its certificate matches the supplied backup. Server source254 was preserved and
the released ReceiptScanSnapshot changes reconstructed in an isolated copy.
All 4607 classes match after normalizing dex offsets, pool indices and debug
line numbers; non-code ZIP payload including manifest/resources matches byte
for byte (signature files excluded). Raw strings compared losslessly.

The candidate now preserves source255 server selection, per-server database/session
isolation, shared network client and receipt scan evidence. LOGOFF256 adds only
the fabric capability on this Android base. 328 Android tests passed, release
build succeeded, signed APK verified against the APK255 certificate. The old
certificate installation is not claimed upgrade-compatible. Physical TSD update
has not been tested. Keys/passwords are not tracked. PR target feature/la_panthera.
Full candidate service boot and release checks are still required; not published.
Опубликован PR868 (05.11.2026): поиск выбранного товара в товародвижении по SKU без составной подписи в search. Точный web2 overlay; API, данные, остальные контейнеры и проданная WMS сохранены. Web595 passed/2 skipped, TypeScript; браузер3 и bootstrap5 проверены до и после публикации. База 2026-11-05-turnover-search; sourceParityVerified=false.

Исправление поиска выбранного товара: TurnoverPanel.tsx хранит идентификатор выбранной подсказки отдельно от её подписи и передаёт skuId без search. Ручное изменение текста или смена клиента отключает этот фильтр. Сервер, остатки и проданная WMS не изменены; опубликовано в PR868.

Опубликован PR866 (05.11.2026): отключённая серверная основа FBS из рулонов. WMS_FBS_FABRIC_CUT_ENABLED=false; выдача заданий и Android ещё не подключены, проблема готовых отрезов этим выпуском не закрыта. API sha256:451665ebbe686df5fb0ed19596cf68db06d58d7e538a74fe3a20d3f4f2621b04. Точный overlay12; runtime18, disabled-container, baseline8, health и хеши проверены. Остальные флаги, web, APK, данные и контейнеры сохранены; sold не менялся. База 2026-11-05-fabric-foundation-disabled; sourceParityVerified=false.

PR866: [серверная основа FBS из рулонов](fbs-fabric-cut-flow.md), выпуск с WMS_FBS_FABRIC_CUT_ENABLED=false. Очередь и Android ещё не подключены, рабочая нарезка не включается. API4408, integration57, focused105; точный runtime12, capability/переклейка18, baseline8 и disabled-runtime проверены. Факт публикации — в current-production.

Опубликован PR864 (05.11.2026): сохранение паузы WB ФБО по Retry-After и X-Ratelimit в БД. WMS_WB_FBO_REQUEST_PAUSE=true только нашей WMS. Проверены health, точная замена двух модулей свежего runtime, сохранение остальных контейнеров. API4314/web594, PostgreSQL53, TypeScript и кандидат runtime прошли. Source parity остаётся false. База: 2026-11-05-wb-fbo-pause.



FBO stock availability: gated exact blocked-mark returns in completed FBS requests. Regression: apps/api/test/fbo-fbs-reservations.spec.ts.

Request action menus follow the selected font and collapse to one column when narrow. Edge regression: apps/web/test/request-menu-font-wrap.ps1.

Опубликован PR860 (04.11.2026): автоматический опрос WB по номерам заказов незакрытых FBS-заявок. WMS_WB_LINKED_STATUS_REFRESH=true только в нашей WMS. Проверены работающий API и точная замена двух модулей относительно PR858; остальные контейнеры сохранены. База: 2026-11-04-wb-linked-status.

PR831. WB request rows use LegacyWbBi. Its header now opens supply binding. Browser verification starts from the Requests list on published assets with actual request 2565 plan and fixture API responses. Web 593 passed/2 skipped, TypeScript passed. Baseline 2026-11-01-wb-request-entry.

PR829. Both Ozon import methods are collapsed inside Excel assembly in Requests. Verified the live request panel and retained link draft across toggles. Web593/2 skipped, TypeScript and Edge passed. Exact web2 overlay on PR820. Baseline 2026-11-01-ozon-under-excel.

PR826, feature/la_panthera. Request list sorts by Russian client names in either direction. Batch status check has a blue button. Both WB FBO assembly entry points open supply binding from the header. Web 593 passed, 2 skipped. API 4295 passed, 156 skipped, plus 3 KIZ tests on dedicated PostgreSQL. Web TypeScript and candidate/public Edge scenarios passed. Web image changed three files; API image and schema retained. Baseline 2026-11-01-request-client-controls.

Published PR824 in feature/la_panthera. Requests header first, three independent disclosures, compact request number and distinct active search mode. Web592 passed/2 skipped, TypeScript passed, candidate/public Edge16 each including mobile layout and existing marketplace buttons. Exact web3 overlay, other containers unchanged. Baseline 2026-11-01-compact-request-tools; source parity false.

Published PR821 in `feature/la_panthera`: [marketplace checks and WB supply binding](request-market-status.md). One button beside batch handover checks scoped open marketplace requests; the FBO WB header opens binding during picking. API4295/web592/typecheck, PostgreSQL12/full health and candidate/public Edge10 passed. Exact API5/web2; source parity false. Baseline `2026-11-01-panthera-market-buttons`.

ReceiptBatchesPanel places the client picker immediately below the header and before receipt review/date filters. File refresh stays with files. Fixed-client access retains its existing scope. Regression: ReceiptBatchesPanel.spec.tsx.

FBO Ozon import decision audit for file and link creation. The request event and audit row retain the selected action and displayed SKU shortages in the creation transaction. Existing requests keep their original history. Correction submission, failure, unknown result and successful application have separate history entries. Own-image WMS_OZON_STOCK_DECISION_AUDIT_ENABLED. API4287/web588, candidate browser10/bootstrap5, isolated PostgreSQL6/full health.

Online request indicator: match the deployed online control and verify its green background, hidden activity icon, pulsing dot and reduced motion in the browser. Web tests 588 passed/2 skipped.

Request actions in a compact two-column grid with a reduced-motion-aware online indicator. Full-width open menus and wrapped status notes. Browser regression in scripts/releases/request-grid-20261101/browser.cjs.

Compact request places: ClientRequestsTable.packagesSummary shows the number of packages and sum of their item quantities. The existing Online action provides details. Web regression suite 588 passed/2 skipped; deployed-module fixtures 0/1/159 places. Own-WMS web-only release.

Published PR813 / 2026-10-31: [Cargo pickup invoices](cargo-pickup-invoices.md). Separate dated cargo invoice alongside independent PRR billing; delivery selection/cost, audited correction, transactional source links, concurrency and cancellation guards. API4280/web587 (156/2 skipped), focused18, TypeScript, isolated PostgreSQL8/full health, browser6/bootstrap5/public5 passed. Exact API5/web2; own-image flag enabled. Live routes/flag verified, no production cargo charges created. Schema/APK/sold unchanged. Baseline2026-10-31-cargo-pickup, sourceParityVerified=false.

Published PR811 / 2026-10-31: [Background FBO delivery](fbo-background-delivery.md). Browser-independent Ozon/WB confirmation with durable leases/backoff and locked idempotent shipment. API4262/web587 (156/2 skipped), TypeScript, baseline8/exact API4, isolated PostgreSQL9/full health. Own-WMS flag enabled; web/APK/schema/sold unchanged. Live Ozon2601/2602 and WB2494 DONE, one confirmation audit each, SHIP totals20/12/578 exactly. Baseline2026-10-31-fbo-background-delivery; sourceParityVerified=false.

Published PR809: client required KIZ at receipt/inventory, including new SKU; adjacent responsive switch; REJECT validation and unresolved review badge. API4233/web587, TypeScript, isolated PostgreSQL/runtime15/full health, browser6/bootstrap5/public5 and live3 passed. Exact API14/web3, flags/schema/APK249/sold unchanged. Lukin/Kubrin/Eletskaya enabled; 3 newly unmarked Eletskaya cards aligned after publication, audit retained, no quantity changes. Baseline sourceParityVerified=false. [Details](client-required-kiz.md).

Release candidate on PR807/808: required KIZ per client plus review REJECT validation/attention badge. Exact API14/web3 overlay; responsive adjacent display/KIZ settings, existing flags and single main entry retained. API4233/web587, both TypeScript checks, browser6/bootstrap5 and baseline8 passed. See client-required-kiz.md; sourceParityVerified=false.

Prepared, not deployed: [Client required KIZ](client-required-kiz.md). Client cabinet switch, server receipt/inventory enforcement, new-card marking and audit. Own-WMS flag plus explicit client setting; stock unchanged. Authorized settings and 97 card flags applied for Lukin/Kubrin/Eletskaya. See document for release boundary and tests.

Prepared, not published: [KIZ review rejection and attention badge](kiz-review-reject-counter.md). Scoped OPEN review count, REJECT DTO, successful-decision refresh; no stock mutations.

Published PR807 / 2026-10-31: [FBO completion reliability](fbo-completion-reliability.md). Batched exact box checks and selections, safe same-token recovery after connection failures, busy/check-result UI and stage diagnostics. API4217/web586 (151/2 skipped), TypeScript, baseline8, PostgreSQL10/full health and browser6. Exact API3/web2; own-image WMS_FBO_COMPLETION_RELIABILITY_ENABLED=true. APK249/schema/business records/sold unchanged. Baseline2026-10-31-fbo-completion-reliability, sourceParityVerified=false.

Published PR805 / 2026-10-31: [FBO shipment prefix lookup](fbo-shipment-prefix.md). Request2565 KIZ read47.940s ->4.513s,1710 identities/evidence unchanged. API4206/web582 (151/2 skipped), TypeScript, baseline8, PostgreSQL10/full health;1710-unit/159-box synthetic finish16s and retry passed. Exact2 API overlay, own-image WMS_KIZ_SHIPMENT_PREFIX_ENABLED=true. Web/APK/schema/stock/sold unchanged. Baseline2026-10-31-fbo-shipment-prefix, sourceParityVerified=false.

Published PR800: Ozon FBO shop labels after client/branch scope; separate FBO picking/packing productivity by actor and Moscow day. API4198/web582/TypeScript, PostgreSQL11/full health, artifact browser6/bootstrap5/public5 and baseline8 passed. Exact API3/web3; own-image WMS_FBO_PICKER_STATISTICS_ENABLED=true, sold/schema/APK249 unchanged. Audited Ozon-only directory configured for CL-000016; shared stock and KIZ untouched, strict receipt flag off. Live2529/2530 Monlarti,2531 Braibo verified; WB shop bindings pending separate verification. Baseline sourceParityVerified=false. [Details](fbo-stores-productivity.md).

Подготовлено: [магазины ФБО Ozon и производительность ФБО](fbo-stores-productivity.md). Ozon labels after scope; отдельные picked/packed по исполнителю и дню. API4198/web582/PostgreSQL11/browser6/bootstrap5; own-WMS flag, общий склад сохранён.

Published PR802: [Ozon packed auto-completion](ozon-packed-auto-done.md). PACKED -> DONE after all postings are delivering/delivered, status/history only. Independent own-WMS flag enabled; WB rule preserved. API4194/web579/TypeScript, PostgreSQL8/full health, candidate/public runtime passed. Exact two API modules; web/APK249/schema/stock/sold unchanged. Baseline `2026-10-30-ozon-packed-auto-done`, sourceParityVerified=false.

Published PR799: [WB packed auto-completion](wb-packed-auto-done.md). PACKED -> DONE after all linked WB orders are accepted, status/history only. Own-WMS flag enabled; stock/web/APK249/schema/sold unchanged. API4175/web579/TypeScript, PostgreSQL8/full health, candidate/public runtime and exact two-module verification passed. Baseline `2026-10-30-wb-packed-auto-done`, sourceParityVerified=false.

Published PR797: [FBO counted stock rebind](fbo-rebind-counted-stock.md). Existing counted quantity consumed without extra +1; duplicate/history guards retained. API4155/web579/TypeScript, runtime4/repair4/PostgreSQL9/full health. Exact2 API modules, other700/web/LOGOFF249/schema/flags/sold unchanged. Baseline `2026-10-30-fbo-rebind-stock`, sourceParityVerified=false. Box519 AVAILABLE0,9 units in2565 unchanged.

Published PR795 / 2026-10-30: [WB FBO supply tracking and dispatch](wb-fbo-supply-tracking.md). Scoped binding, six process options, manual vehicle loading, confirmed WB delivery through guarded stock shipment. API4155/web579/TypeScript, PostgreSQL12/full health, browser9/navigation9; own WMS only.

Published PR793 (feature PR787), LOGOFF249: client stores and shared SKU permissions, request/billing/TSD context. Single application entry; Ozon label control and sidebar counts retained. API4149/web578/Android933, TypeScript, runtime12, PostgreSQL15/full Nest health, browser8/sidebar9/bootstrap5 and public bootstrap5 passed. API156/web2 skipped; dedicated KIZ integration suite excluded without URL. WMS_CLIENT_STORES_ENABLED=true only in own API image; strict store receipts disabled. Production store bindings, stock, KIZs, schema and sold WMS unchanged. Source parity false. [Details](client-store-separation.md).

Published PR791 / 2026-10-30: [sidebar request counts](sidebar-request-counts.md), unfinished total (IN_WORK) beside Requests/FBS/FBO and favorites. Scoped WMS requests, full counts, loading/error distinct from zero. API4119/web571/TypeScript, PostgreSQL6/full health, candidate/public browser9 and import10, baseline8. Exact API3/web2; flags/schema/APK248/data/sold unchanged. Baseline `2026-10-30-sidebar-counts`, sourceParityVerified=false.

Published PR789 / 2026-10-30: [single application entry repair](ozon-single-web-entry.md). Exact index.html correction prevents duplicate React roots/blank screen; other3204 web files and API/APK248/schema/data/sold unchanged. Cold entry RED/GREEN6 and public6; API4116/web569/TypeScript, baseline8. Ozon control/history retained. Baseline `2026-10-30-single-web-entry`, sourceParityVerified=false.

Published PR786 / 2026-10-30: packing -> Ozon cargo export -> attach labels -> scan WMS carton/Ozon sticker pair -> finish. Download-click history retained. LOGOFF248; API4116/web569/Android924, PostgreSQL12, candidate/public browser6+10; API156/web2 skipped, dedicated unconfigured KIZ DB suite excluded. Own WMS only, WMS_OZON_LABEL_CONTROL_ENABLED=true; prior flags, PR784 index, schema and sold WMS retained. Baseline `2026-10-30-ozon-label-control`, sourceParityVerified=false. [Control](ozon-label-box-control.md), [download history](ozon-label-click-history.md).

Prepared, not deployed: [FBO batch KIZ shipment verification](fbo-kiz-shipment-batch.md). Same client-scoped decisions, transaction-local bounded reads under identity locks. API4108/web563, TypeScript, PostgreSQL9/full health, baseline8; request2494 read-only check15.7s, synthetic578/57 completion7.45s with both WB exports. Exact2 API modules; web/APK247/schema/sold unchanged.
Published PR784: additive `KizReviewCase_client_identity_idx`, valid/ready, live query uses index. API/web images, containers and duplicate guard unchanged. PostgreSQL RED/GREEN concurrency5/replay2, API4108/web563 passed (156/2 skipped). №2494 completed normally:578 units/57 boxes, both Excel totals verified; guard enabled. [Details](fbo-kiz-shipment-batch.md).

Published PR783 / 2026-10-30: final FBO KIZ reads batched under the existing client identity locks; all per-KIZ duplicate/history/admin/context/binding checks retained. API4108/web563/TypeScript, PostgreSQL9/full health and baseline8 passed; API156/web2 skipped, unconfigured dedicated KIZ suite excluded. Exact2 API modules; other690 files, web/APK247/schema/environment/sold unchanged. Baseline `2026-10-30-fbo-kiz-shipment`, sourceParityVerified=false. [Details](fbo-kiz-shipment-batch.md).


Published PR781 / 2026-10-30: LOGOFF247 permits whole remainder in partial FBO picking, preserving previously picked loose units and pending-operation mode. Android915/API4096/web563, PostgreSQL9/full health, baseline8, signed APK/audio/public hashes passed; API156/web2 skipped, dedicated unconfigured KIZ suite excluded. Exact3 download files; other3199 web files, API/schema/stock/sold unchanged. Baseline `2026-10-30-fbo-partial-whole`, sourceParityVerified=false. Terminal update required. [Details](fbo-partial-whole-remainder.md).


Published PR779 / 2026-10-30: local receipt KIZ reports before first upload, explicit unconfirmed-duplicate notice, durable LOGOFF246 receipt progress/document and scanner focus. API4095/web563/Android912, TypeScript, runtime9, isolated PostgreSQL9/full API health, browser5, APK signature/audio and public hashes passed; API156/web2 skipped, dedicated unconfigured KIZ suite excluded. Exact1 API/2web/3 APK download files; schema/configuration/stock/sold unchanged. Baseline `2026-10-30-receipt-progress`, sourceParityVerified=false. Terminal update required. [Details](receipt-local-kiz-progress.md).

Prepared PR775, not yet deployed: [FBO automatic progress](fbo-progress-status.md). PR776 baseline; API4090/web562, runtime12, PostgreSQL9/full health, browser11, baseline8 passed. Own-WMS flag only.
Published PR775 / 2026-10-30: FBO physical picking restores IN_WORK and exact completion advances to PACKING; WB/Ozon/Lamoda show packed-pending-control without granting shipment permissions. Own-image WMS_FBO_PROGRESS_STATUS_ENABLED=true. API4090/web562 (151/2 skipped), TypeScript, runtime12, disposable PostgreSQL9/full Nest health, candidate/public browser11 and baseline8 passed. Exact5 API/4web on PR776; schema/APK245/stock/sold unchanged. Request2494:578 picked,518 packed; stale SUBMITTED corrected to IN_WORK, packing retained, system audit, no stock movement. Baseline `2026-10-30-fbo-progress`, sourceParityVerified=false. [Details](fbo-progress-status.md).

Published PR776 / 2026-10-30: Ozon file/link imports show aggregated SKU stock and deficits, with full demand or confirmed WMS/Ozon correction. Customer-scoped permissions and file binding retained. API4072/web560 (151/2 skipped), TypeScript, source browser8, candidate/public browser10, runtime11 and baseline8 passed. Exact3 API/2web; schema/APK245/environment/sold unchanged. Baseline `2026-10-30-ozon-import-stock`, sourceParityVerified=false. [Details](ozon-import-stock-review.md).

Published PR773 / 2026-10-30: explicit ADMIN/OWNER found-unit confirmation, unknown FBO KIZ guard and BOX_CHECK review preservation. API4070/web557 passed (155/2 skipped; unconfigured dedicated KIZ DB suite excluded), TypeScript, runtime10, browser7, targeted26 and isolated full Nest/PostgreSQL health passed. Exact9 API/2 web files; schema, APK245, stock quantities, shipment history and sold WMS unchanged. WMS_INVENTORY_FOUND_UNIT_ENABLED=true only on our WMS; all prior environment values retained. Baseline `2026-10-30-found-unit`, sourceParityVerified=false. Public health/hashes verified. [Details](inventory-found-unit-review.md).

КИЗ FBS: повтор текущего отбора, сохранение OPEN-разбора и дата/заказ предыдущей отгрузки. [Описание и проверки](kiz-fbs-review-retry.md).

Published PR769 / 2026-10-29: atomic FBO camera captions record exact product/article, barcode/KIZ, authenticated operator/device, box and packed/target counts in the existing packing transaction. Own-WMS flag enabled; AuditLog index valid/ready, exporter Index Scan 0.128 ms / 7 buffers. API4039/web555, TypeScript, baseline8 and actual-container runtime10 passed. Exact2 API-module overlay; other686 files, web/TSD245, prior188 environment values, other containers and sold WMS preserved. Baseline `2026-10-29-fbo-video-caption`, sourceParityVerified=false. No new real packing occurred in the recorded verification window. [Details](fbo-video-caption.md).

Published PR767 / 2026-10-29: FBS automatic continuation stays inside the selected request. LOGOFF245 restores request/marketplace after pending-operation recovery; lost selection opens the list. Own-WMS `WMS_FBS_EXPLICIT_REQUEST_ENABLED=true` prevents new unscoped assignments. API4028/web555 passed (155/2 skipped), Android897, TypeScript/release, baseline8, actual runtime56 and RED/GREEN regressions. Exact1 API/3 download files; other686 API modules/schema/prior132 flags/environment/business data/sold unchanged. Baseline `2026-10-29-fbs-request-scope`, sourceParityVerified=false. Public hashes/health verified; terminal update required. [Details](fbs-explicit-request.md).

Опубликовано PR765: КИЗ клиента, LOGOFF244; baseline `2026-10-29-kiz-client-guard`. Проверки API4018/web555/Android885/PostgreSQL12/runtime26 и live4 пройдены. [Паспорт](kiz-client-duplicate-guard.md).

КИЗ клиента: `common/kiz-client-registry.ts` → приёмка/импорт/исправление/ТСД; `common/kiz-client-review.ts` → FBS/FBO/SOS/ручное списание. Durable registry + контекстные решения, общий lock. UI: ReceiptDuplicateNotice / ReceiptKizWarningView. [Карта изменения](kiz-client-duplicate-guard.md).

Published PR763 / 2026-10-29: LOGOFF TSD243 adds Sofia's approved offline tank voice pack (13 recordings / 17 existing events), selected by immutable account ID in LOGOFF only. Android286 per flavor (858 total), release/lintVital, baseline8, signed payload/certificate and existing25 raw-resource hashes passed. Exact3 download-file overlay on PR761; other3188 web files, all684 API files/schema/other containers/sold unchanged. Public APK/version/hash/health verified; terminal installation required. Baseline `2026-10-29-sofia-tanks-voice`, sourceParityVerified=false. [Details](sofia-tanks-voice.md).

Published PR761 / 2026-10-29: Ozon assembly/cargo and Lamoda FBO open in centered operational modals; Lamoda WB-style rows preserve client scope and label source-plan quantities. Minimize during loading retains its window and dock entry. API3975/web548 passed (150/2 skipped), TypeScript/build, baseline8, candidate/public browser32 each, runtime graph8 and capture guards5. Exact5 web overlay on PR759; all684 API files/schema/APK242/sold unchanged. Baseline `2026-10-29-fbo-modal-rows`, sourceParityVerified=false. [Details](fbo-modal-rows.md).

Published PR759 / 2026-10-29: FBO Ozon defaults to all permitted clients with WB-style rows, client in composition, retained countdown/actions and cursor paging. API3975/web542 passed (150/2 skipped), TypeScript/build, baseline8, runtime34, PostgreSQL9/full API health, candidate/public browser23 each. Read-only live check: 10 active/35 completed requests across3 clients in checked branch, metadata/scope/anonymous401 verified. Exact2 API/3web; schema/APK242/sold unchanged. Baseline `2026-10-29-ozon-all-clients`, sourceParityVerified=false. [Details](ozon-all-clients-list.md).

Applied PR757 / 2026-10-29: audited data-only binding of WMS2506 to manually created Lamoda MPG100007386, with factual composition checks and existing status refresh. No runtime changes. [Operation](lamoda-manual-link-2506.md).

Published PR755 / 2026-10-29: LOGOFF TSD242 restores KIZ focus after scanner Enter in compact FBO packing with guarded delayed autofocus. Regression RED/GREEN; Android280 per flavor (840 total), release build, signing/payload, public hashes and health passed. Exactly3 download-file overlay on PR753; API/schema/other containers/sold unchanged. Baseline `2026-10-29-fbo-compact-focus`, sourceParityVerified=false. Terminal installation required. [Details](fbo-compact-kiz-focus.md).

Published PR753 / 2026-10-29: LOGOFF TSD241 shows remaining product lines before scanning loose FBO stock, preserving client display settings and server quantities. Request2542 regression RED/GREEN; Android279 per flavor (837 total), release build, signing/payload, public hashes and health passed. Exactly3 download-file overlay on PR750; API/schema/other containers/sold unchanged. Baseline `2026-10-29-fbo-unboxed-display`, sourceParityVerified=false. Terminal installation required. [Details](fbo-unboxed-product-display.md).

Published PR750 / 2026-10-29: LOGOFF TSD240 retains the scanned partial-pick source when server route refresh reclassifies it as a whole box, while preserving unit barcode/KIZ checks and clearing unavailable sources. Request2494 regression RED/GREEN; Android277 per flavor (831 total), release build, baseline guards8, signed payload/certificate, public hashes and health passed. Exact3 download-file overlay on PR749; API/schema/other containers/sold unchanged, 3179 other web files preserved. Baseline `2026-10-29-fbo-partial-source`, sourceParityVerified=false. Physical TSD update required. [Details](fbo-partial-source-refresh.md).

Published PR749 / 2026-10-29: download factual Lamoda XLSX after completed packing/box control without entering commercial prices. Customer fills blank date/number/prices before upload; strict API prices unchanged. API3965/web539 (150/2 skipped), TypeScript, baseline8, PostgreSQL10/full health and candidate/public browser9 each passed. Exact5 API/3web; schema/APK239/sold unchanged. Baseline `2026-10-29-lamoda-blank-price`, sourceParityVerified=false. [Details](lamoda-actual-shipment.md).

Published PR747 / 2026-10-29: Lamoda FBO actual packed shipment XLSX/API creation, durable no-replay receipt, status reconciliation and explicit rejection correction. API3959/web539 passed (150/2 skipped), TypeScript, baseline guards8, PostgreSQL9/full Nest health/exact migration and candidate/public browser6 each. Exact7 API/3web overlay; one additive JSONB column, APK239/sold unchanged. Baseline `2026-10-29-lamoda-actual-shipment`, sourceParityVerified=false. No real marketplace shipment created for testing. [Details](lamoda-actual-shipment.md).

Published PR745 / 2026-10-28: LOGOFF TSD239 automatically refreshes Lamoda packing directions and relabel print completion. Read-only polling pauses for scans/dialogs/mutations, retries transient reads and stops on completion/close. Android275 tests per flavor (825 total), release build, signed payload/certificate, exact3 download-file delta, public hashes and health passed. 3174 web files, API682 files/schema/other containers/sold preserved. Baseline `2026-10-28-lamoda-auto-refresh`, sourceParityVerified=false. Physical terminal update required. [Details](lamoda-fbo-relabel.md).

Published PR743 / 2026-10-28: CL-000014 terminal WB AUTO reservation reconciliation and account-specific monitor identities. Twelve stale reserves released; physical stock hash unchanged. Monitor31: 29 successful, 2 historical WB-delta warnings, no WMS errors/unavailable identities; current publications show no excess. API3934/web537, runtime67, PostgreSQL8/full API health and baseline guards8 passed. Exact4 API overlay; web/schema/APK238/sold preserved. Baseline `2026-10-28-kubrin-stock`, sourceParityVerified=false. [Details](kubrin-stock-reservations.md).

Published PR740 / 2026-10-28: SKU printing searches confirmed active Lamoda cards by article/card/barcode and labels exact Lamoda barcode choices; warehouse barcode remains the default. Client-scoped, existing Lamoda flag; no inventory or mapping writes. API3901/web537 passed (155/2 skipped), TypeScript/build, baseline guards8, actual runtime8, isolated PostgreSQL6/full Nest health, candidate/public browser3 and production read-only lookup6. Exact4 API/2web overlay on PR739; schema/APK238/sold unchanged. Baseline `2026-10-28-lamoda-print`, sourceParityVerified=false. [Details](lamoda-print-barcodes.md).

Published PR739 / 2026-10-28: Lamoda relabel starts from warehouse barcode/KIZ scan and confirmed mapping, without manual unit list. Exact4 API modules, web3 and signed LOGOFF238 over PR737; schema/stock/mappings/sold unchanged. API3894/web536 passed (150/2 skipped), Android268 per flavor, TypeScript, isolated PostgreSQL16/full API health, candidate/public browser8, public hashes and live read-only2506 resolution verified. Baseline `2026-10-28-lamoda-source-scan`, sourceParityVerified=false. Physical printer remains untested. [Details](lamoda-fbo-relabel.md).

Published PR737 / 2026-10-28: restored FBO WB popup, sorting/archive/action styling for staff and clients on cold entry. Existing stylesheet linked in index.html only; 3171 other files unchanged. Web536/API3887 passed (2/155 skipped), TypeScript/build, baseline guards8, candidate/public browser32 each. API/schema/APK237/sold unchanged. Baseline `2026-10-28-fbo-wb-styles`, sourceParityVerified=false. [Details](fbo-wb-style-restoration.md).

Published PR735 / 2026-10-28: Lamoda product relabel printing and exact unit scan before packing; frozen marketplace barcode/size, durable print retries, KIZ identity check and bulk-recovery fence. Exact5 API modules,4 additive columns, web3 files and signed LOGOFF APK237 on PR733. API3887/web535 passed (150/2 skipped); Android268 per flavor; isolated PostgreSQL13/full Nest health, candidate/public browser8, public APK/file hashes and live read-only request2506 label verified. Sold WMS unchanged. Baseline `2026-10-28-lamoda-relabel`, sourceParityVerified=false; physical printer remains untested. [Details](lamoda-fbo-relabel.md).

Published PR733 / 2026-10-28: Lamoda created plans open persisted assemblies instead of disabled draft review; stale-list existingRequest recovery, no false original-plan shortage, preview cleared after creation. API3875/web532 passed (150/2 skipped), TypeScript/build, baseline guards8, candidate/public browser50+11+5. Exact3 web overlay on PR731; API/schema/APK236/sold and request2506 unchanged. Baseline `2026-10-28-lamoda-existing`, sourceParityVerified=false. [Details](lamoda-existing-review.md).

Published PR731 / 2026-10-28: missing Lamoda active-request badge added; scoped persisted assemblies count separately from WB/Ozon, drafts and terminal requests excluded. API3875/web531 passed (155/2 skipped), TypeScript, runtime PostgreSQL5/full API health and browser5 passed. Exact1 API/3web overlay on PR729; schema/APK236/sold unchanged. Baseline `2026-10-28-lamoda-counts`, sourceParityVerified=false. [Details](fbo-active-card-counts.md).

Prepared / 2026-10-28: add the missing Lamoda active-request counter to the FBO tile; same scoped queue and status policy as WB/Ozon, no draft plans. Own-WMS flag, not published.

Published PR729 / 2026-10-28: scoped active WB/Ozon FBO card counters without the 200-row list cap. API3875/web530 passed (155/2 skipped), TypeScript, PostgreSQL5/full API health, candidate/public browser5 and marketplace/Lamoda regression50. Exact3 API/3web overlay on PR727; schema/APK236/sold unchanged. Live authorized endpoint200, anonymous401; current actor counts WB2/Ozon3. Baseline `2026-10-28-fbo-counts`, sourceParityVerified=false. [Details](fbo-active-card-counts.md).

Published PR727 / 2026-10-28: shared administrative removal in Lamoda FBO cards, request-ID confirmation, scope reset and archive refresh. Preserves PR725 shortage review. API3872/web529 passed (150/2 skipped), TypeScript/build, baseline guards8, candidate/public browser50 plus shortage regression8 passed. Exact web3-file overlay; API/schema/APK236/sold unchanged. Baseline `2026-10-28-lamoda-removal`, sourceParityVerified=false. [Details](lamoda-request-removal.md).

Published PR725 / 2026-10-28: Lamoda shortages block assembly creation; review shows warehouse barcode/size/plan/reserves/free/deficit, explicit corrections reduce quantities without reserving, then Serializable recheck protects FBS/FBO demand. Original plan retained; compact PR723 layout and inline execution preserved. API3872/web529 passed (155/2 skipped), TypeScript/build, PostgreSQL7/full API health, candidate/public browser8 and baseline guards8 passed. Exact4 API/3 web overlay; schema/APK/sold unchanged. Baseline `2026-10-28-lamoda-stock`, sourceParityVerified=false. [Details](lamoda-stock-guard.md).

Prepared / 2026-10-28: Lamoda pre-creation shortage review and explicit quantity correction. Preview and Serializable creation share eligible AVAILABLE minus canonical FBS/FBO reservations; zero rows excluded, imported plan immutable, remote supply must match. Four API modules + Lamoda UI only; preserves PR720 workspace and PR721 inline execution and PR723 layout. Baseline PR721–723; not published. [Details](lamoda-stock-guard.md).

Prepared / 2026-10-28: Lamoda operational FBO uses Ozon-style compact toolbar, collapsed file/supply creation and full-width adaptive assembly cards. Exact web-only overlay on PR721; API3851/web525, source browser9, runtime browser43 and baseline guards8 passed. Sold/API/schema/APK unchanged. [Scope and checks](lamoda-ozon-layout.md).

Published PR723 / 2026-10-28: Lamoda operational FBO matches Ozon page layout: compact client/account/branch toolbar, collapsed file/supply forms, full-width active/completed cards with adaptive density4-6. API3851/web525 passed (150/2 skipped), source browser9, candidate/public browser43, TypeScript/build and baseline guards8. Exact web3 files; API/schema/APK236/sold unchanged. Baseline `2026-10-28-lamoda-layout`, sourceParityVerified=false. [Details](lamoda-ozon-layout.md).

Prepared / 2026-10-28: active WB/Ozon FBO card counters, complete scoped request queue, loading/error states and stale-response protection. Own-WMS workspace flags; not published. [Scope and tests](fbo-active-card-counts.md).

Published PR721 / 2026-10-28: Lamoda FBO opens shared execution inline after creation, preserves it across list refresh, resets on account/client/branch switch. API3851/web524 passed (150/2 skipped), build/TypeScript, baseline guards8, candidate/public browser28 passed with synthetic API fixtures. Web-only3 files on PR720; API/schema/APK236/sold unchanged. Baseline `2026-10-28-lamoda-inline`, sourceParityVerified=false. [Details](lamoda-inline-assembly.md).

Prepared / 2026-10-28: Lamoda shared FBO execution opens inline after assembly creation; list refresh preserves selection, scope change drops stale response. Web-only follow-up to PR720; API/APK/schema/sold unchanged. Runtime regression28 and full API3851/web524 passed. [Scope and tests](lamoda-inline-assembly.md).

Published PR720 / 2026-10-28: separate marketplace workspaces and scoped client directory; customer connected tiles, staff filtered clients, Lamoda client-card maintenance. Panthera opaque Ozon/FBY/Lamoda surfaces and text removal width fixed. API3851/web524 passed (150/2 skipped), runtime PostgreSQL24/full API health, candidate/public browser24 and CSS regression6 passed. Exact4 API/7 web overlay, schema/APK236/sold unchanged. Baseline `2026-10-28-marketplace-workspaces`, sourceParityVerified=false. [Details](marketplace-workspaces.md).

Prepared PR720 / 2026-10-28: exact marketplace workspace overlay; branch-aware directory preserved, separate four FBO/FBS markets, client filtering, client-card maintenance. Panthera opaque Ozon/FBY/Lamoda surfaces and text removal width. Runtime PostgreSQL24/full API health, browser24 and CSS regression6 passed. Own WMS only; schema/APK/sold unchanged. See [details](marketplace-workspaces.md).

Prepared / 2026-10-28: scoped marketplace client directory, customer-only connected tiles, operational Lamoda layout and client-card maintenance. Own-WMS flags default off; not published. See [plan, affected functions and validation](marketplace-workspaces.md).

Published PR718 / 2026-10-28: scoped client/admin manual Lamoda product correspondence with WMS name/article/barcode search and two-card confirmation. Plans retain Lamoda identities; availability/reservations/directions use warehouse barcodes. API3849/web519 passed,155/2 skipped; TypeScript, isolated PostgreSQL19/full Nest health and candidate/public customer browser14 passed. Live136 Lukin cards loaded and136 unique size-compatible links confirmed through audited service; client search verified. Exact3 API/3 web overlay on PR716, schema/APK236/sold unchanged. Baseline `2026-10-28-lamoda-mapping`, sourceParityVerified=false. [Details](lamoda-contour.md).

Prepared / 2026-10-28: Lamoda manual product mapping for scoped CLIENT and administrators, search own WMS name/article/barcode and explicit two-card confirmation. Marketplace identifiers retained; availability/reservations/directions use warehouse barcodes. Exact3 API/3 web overlay on 2026-10-28-yandex-fby. API3849/web519 passed,155/2 skipped; TypeScript, disposable PostgreSQL19/full Nest health and customer browser14 passed. Schema/APK236/sold unchanged. [Details](lamoda-contour.md).

Published PR716 / 2026-10-28: Yandex FBY existing-supply import and Excel/manual internal assembly, scoped mapping/binding/refresh, separate LOGOFF TSD queue/APK236. Preserves Lamoda FBO and CLIENT access; Lamoda credentials now in client card, four equal marketplace tiles (2/4/1 columns). API3846/web519 passed,150/2 skipped; Android267 per flavor. Exact runtime PostgreSQL12 FBY +19 Lamoda, full Nest health, candidate16/public16 browser scenarios and public file/APK hashes passed. Additive FBY table; exact overlay on PR714; other containers and sold WMS unchanged. Real client Yandex import/physical scans remain unverified; no external supply/cargo-place/label writes. Baseline `2026-10-28-yandex-fby`, sourceParityVerified=false. [Details](yandex-fby.md).

Published PR714 / 2026-10-28: CLIENT access to own Lamoda FBO plans through existing request rights. Excel/ID import, availability and replay-safe assembly allowed; credential management remains administrative. Exact2 API/4 web overlay; schema/APK235/roles/business records/sold WMS unchanged. API3811 plus new controller-guard test, web513 passed;155/2 skipped. TypeScript, disposable PostgreSQL19/full Nest health, customer browser10 and admin13 passed; public customer browser10 and live read-only Lukin account/warehouses verified. Baseline `2026-10-28-lamoda-client`, sourceParityVerified=false. [Details](lamoda-contour.md).

Prepared / 2026-10-28: scoped Lamoda FBO planning for CLIENT users with existing client-requests rights. Credential management remains API-admin only; no role grants. Exact2 API/4 web overlay on 2026-10-28-lamoda-fbo. API3811 and new route-guard test passed, web513 passed;155/2 skipped, dedicated KIZ DB suites excluded. Candidate client browser10 and admin browser13 passed; API/web TypeScript passed. Schema/APK/external writes/sold WMS unchanged. See [Lamoda scope](lamoda-contour.md).

Published PR711+712 / 2026-10-28: Lamoda FBO Excel/ID imports, replay-safe OUTBOUND assembly and isolated LOGOFF TSD queue/packing, APK235. API3810/web512 passed,155/2 skipped; all3 Android flavors, TypeScript with isolated Prisma types, runtime PostgreSQL17/full Nest health, candidate/public browser13 passed. Exact13 API/7 web files, two additive tables; own-image assembly gate enabled, external writes disabled, sold untouched. Baseline `2026-10-28-lamoda-fbo`, sourceParityVerified=false. Live account works; no client shipment yet for physical end-to-end test. [Details](lamoda-contour.md).

Prepared / 2026-10-28: Lamoda FBO Excel and existing-shipment ID import, immutable plan-to-request binding and directed TSD assembly. Branch feature/lamoda-fbo-imports; not published. WMS_LAMODA_FBO_ASSEMBLY_ENABLED gates creation/picking; sold installation unchanged. External shipment writes remain disabled. Real cabinet URL awaits a client example. See [Lamoda scope](lamoda-contour.md).

In progress / 2026-10-26: feature/lamoda-operations adds gated validated commands, bounded PDF labels and a durable command-journal component. Not published or connected to warehouse actions; external writes remain disabled. See [Lamoda scope](lamoda-contour.md).
Published PR709 / 2026-10-28: Lamoda check/catalog now supply country=RU; catalog pages25 (was100). API3773/web510 passed,150/2 skipped; dedicated KIZ DB suites excluded. Actual candidate and published OAuth201/catalog200 verified. One API file; baseline `2026-10-28-lamoda-country`, sourceParityVerified=false. Web/APK/schema/keys/business data/sold WMS unchanged. [Details](lamoda-country-fix.md).

Prepared / 2026-10-28: Lamoda connection/catalog validation fix. Seller 1060287436 authorization succeeds; catalog HTTP400 reproduced without required country and HTTP200 with RU. Catalog page limit corrected from100 to25, previous10000-row/time caps preserved. Exact one API runtime file; source parity verified for that module. API3773/web510 passed;150/2 skipped; two dedicated KIZ DB suites excluded. TypeScript and3 candidate runtime checks passed. Own-WMS deployment only; sold/web/APK/schema/credentials/business records unchanged. [Details](lamoda-country-fix.md).
Published PR707 / 2026-10-27: client service lists skip writes to unchanged standard services and existing client price bindings. Exact two methods/one API file; own-image WMS_BILLING_SERVICE_READ_FAST_ENABLED. API3772/web510 passed;155/2 skipped; dedicated KIZ DB suite unavailable. TypeScript, targeted30, candidate read-only70ms and published read-only47ms for identical367 Bushkova services passed. Web/APK/prices/invoices/sold WMS unchanged. Baseline `2026-10-27-billing-read-fast`; sourceParityVerified=false. [Details](billing-service-read-performance.md).

Published PR705 / 2026-10-27: corrected HTML entry after PR703. One index.html src changed; prevents dual React roots and blank screen on saved-session restore. Authenticated Panther startup reproduced before and verified after, including public page with synthetic API fixtures. API3767/web510 passed;155/2 skipped, dedicated KIZ DB suite excluded. API/assets/APK/data/sold WMS unchanged. Baseline `2026-10-27-receipt-startup`; sourceParityVerified=false.

Published PR703 / 2026-10-27: receipt availability controls and per-client Gray/White processing profiles. Exact13 API/4 web overlay; WMS_RECEIPT_PROCESSING_ENABLED=true in our image only. API3767/web510 passed;155/2 skipped; dedicated KIZ DB suite excluded. TypeScript, runtime18, browser12/full graph, isolated PostgreSQL/full Nest health and production rollback8 passed. Baseline `2026-10-27-receipt-processing`; sourceParityVerified=false. No client configured, no receipt/stock/invoice changed at deploy; APK/schema/sold WMS unchanged. [Details](receipt-processing-type.md).

Published PR701 / 2026-10-27: selected Ozon FBS labels avoid full marketplace/history reload. Exact2 API files; WMS_OZON_DIRECT_LABEL_ENABLED=true in our API image only. API3748/web510 passed,155/2 skipped; dedicated KIZ DB suite unavailable. TypeScript, candidate runtime/module graph, live health/hashes and read-only request2461 PDF passed (417ms,72205bytes). Baseline `2026-10-27-ozon-direct-label`; sourceParityVerified=false. Web/APK/schema/sold WMS/business records unchanged.

Published PR699 / 2026-10-26: actual Ozon FBO editing deadline countdown. Exact 4 API / 4 web overlay on multishop-auto. API3740/web510 passed, 155/2 skipped; dedicated KIZ database suite unavailable. TypeScript, runtime4/module graph, candidate/public browser (3 themes x6 widths) and live health/hash checks passed. Baseline `2026-10-26-ozon-deadline`; sourceParityVerified=false. Existing requests need an Ozon refresh. Sold WMS, APK, schema and business records unchanged.

Prepared / 2026-10-26: [Обратный отсчёт ФБО Ozon](ozon-edit-deadline.md). Exact API deadline per order; customer list, assembly/cargo details and legacy plans. Own-host UI only; unknown dates never inferred from slots. Not published. Tests: `ozon-edit-deadline.spec.ts`, `OzonEditCountdown.spec.tsx`.

Published PR697 / 2026-10-26: opt-in shared/allocated WB-Ozon stock publication with durable queue, canonical reservation reader, explicit preview/activation/stop and legacy writer fence. No client activated; Kubrin retains old settings. API3736/web502 passed;155/2 skipped; dedicated KIZ integration excluded. TypeScript, runtime8, isolated PostgreSQL12/full API health, editor13/runtime15/public15 browser and baseline guards8 passed. Exact14 API/3 web delta; baseline `2026-10-26-multishop-auto`, sourceParityVerified=false. Sold WMS/APK/schema unchanged. [Details](multishop-shared-stock.md).

Published PR695 / 2026-10-26: official local WB/Ozon/Yandex Market icons in FBS and WB/Ozon in FBO. Web504 passed/2 skipped, TypeScript,14 candidate/public browser scenarios and8 baseline guard tests passed. Seven-file web overlay; API/schema/APK/business records/sold WMS unchanged. Baseline `2026-10-26-marketplace-icons`, sourceParityVerified=false. Rollback `logoff-web:before-marketplace-icons-20261026`.

Published PR693 / 2026-10-26: Lamoda tile uses the supplied la icon and official lowercase SVG wordmark, local assets and shared 84px badge. Web503 passed/2 skipped, TypeScript and11 candidate/public browser scenarios passed. Exact five-file web overlay; API/schema/APK/business records/sold WMS unchanged. Baseline `2026-10-26-lamoda-icon`, sourceParityVerified=false. Rollback `logoff-web:before-lamoda-icon-20261026`. Sources: `apps/web/public/brand/README.md`.

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

Lamoda FBO final candidate: follow-up TSD entry/filter regression reproduced before fix; API3810/155 skipped, web512/2, isolated-schema TypeScript, all3 Android flavors and APK235 build pass. Exact13-file API overlay; isolated runtime PostgreSQL17 scenarios + full Nest health; browser13. Prepared, not yet published. See lamoda-contour.md.


Prepared / 2026-10-28: shared guarded removal in Lamoda FBO cards; scope reset and refreshed archive. Preserves PR725 stock review. Web-only on PR725; API3872/web529, runtime browser50 plus stock regression8 passed. [Details](lamoda-request-removal.md).
# В разработке: магазины одного плательщика

`ClientStoresSettings` → `clients/:clientId/stores` и `stores/skus/:skuId`: настройки магазинов и разрешений общего SKU. `requestStoreContexts` → ClientRequestsService.list/get, FboTwoStageService.snapshot, BillingService.listCharges; ClientRequestsTable/BillingChargesTable/FboStoreContext отображают магазин по подключению. Строгая приёмка отдельно включается WMS_CLIENT_STORE_RECEIPTS_ENABLED.

`fix/client-store-separation`: `clients/client-stores.{policy,service,controller}.ts`,
FBS controller/module, web `fbs/store-filter.ts`, `FbsPanel.tsx`, `lib/api.ts`.
Справочник магазинов и фильтр заказов; общий физический SKU не дублируется.
**Не опубликовано, не включать до завершения приёмки/ТСД/резервов.**
Состояние и оставшиеся работы: [client-store-separation.md](client-store-separation.md).

Продолжение разделения магазинов: `client-store-receipt.ts` проверяет разрешения SKU и закрепляет документ за магазином в транзакции прихода; `ClientStoresService.getSkuStores/saveSkuStores` хранит разрешения общего SKU. `TsdPayloadParser`, `TsdSyncService`, `TsdReviewService` сохраняют контекст; `TsdDeviceService.listClientsForDevice` и LOGOFF `MainActivity` дают выбор магазина и сохраняют его в очереди. Флаг выключен, production не изменён; полный статус — `client-store-separation.md`.

Подготовлен выпуск магазинов: scripts/releases/client-stores-20261030 сохраняет опубликованную серверную логику и добавляет настройки/метаданные. LOGOFF248; строгая приёмка выключена. Состояние: client-store-separation.md.
`web.cjs` сохраняет единый основной JS-модуль из PR789 при добавлении магазинов; LOGOFF249 сохраняет контроль этикеток Ozon. Проверка страницы: `scripts/releases/client-stores-20261030/bootstrap.cjs`.
Выпуск магазинов пересобран от PR791/792: сохраняет sidebar counts, Ozon label control и единственный HTML entry. PR787 объединён, перед выкладкой свежая база проверяется повторно.

- Проверки КИЗ при приёмке: KizReviewCard, ReceiptScanTimeline и KizCheckPanel показывают события ТСД и историю. Решение CLOSE в kiz-client-review закрывает ошибочный скан без движения товара.
- KizLocationService.lookup возвращает решения по единице (reviews) и историю WB (matches[].reuse). KizCheckPanel передаёт найденные решения в KizReviewQueuePanel.
- Карточка проверки приёмки использует ReceiptScanTimeline. WbSupplyWindow открывает форму передачи и приёмки WB из шапки онлайн-сборки.
- Шапка онлайн-сборки WB переносит название и удерживает кнопки в одном ряду. Колонка проверки приёмки КИЗ центрируется в пределах экрана.
- Контроль размещения приёмок: receipt-placement-report.ts читает остаток, StoragePalletBox и индекс приёмок в одном снимке. ReceiptPlacementPanel показывает три счётчика и диалог; ReceiptPlacementBadge отмечает зоны хранения в меню. Флаг WMS_RECEIPT_PLACEMENT_ENABLED — только наша ВМС.
- Режим размещения приёмки: receipt-placement-workflow.ts генерирует задачи из фактического хранения, фиксирует события и завершение. StorageLocationsService проверяет приёмку в транзакции размещения. ТСД сохраняет выбор между палетами; веб показывает прогресс, связь с активными заявками и историю.
- Выпуск размещения приёмок: scripts/releases/receipt-placement/prepare.cjs переносит проверенные методы на текущий runtime; release.py проверяет образы, подпись ТСД252 и откат; isolated.py и postgres.cjs проверяют точный пакет перед включением.

- Рабочий список размещения: StorageLocationsService.receiptPlacementTasks исключает COMPLETED только для общего списка; выбранная приёмка и история сохраняются. ReceiptPlacementTasks скрывает завершение сразу после действия.

- PR852 published: active placement list, public runtime6 and read-only list verified; baseline 2026-11-01-placement-active-list.

- RequestMarketStatusController использует отдельный WMS_REQUEST_MARKET_STATUS_MANUAL_ENABLED. Явный ручной вызов FboDeliverySyncService.reconcile не зависит от остановки фонового обработчика; планировщик по-прежнему требует WMS_FBO_DELIVERY_SYNC_ENABLED.

- PR858 published: manual status capability, exact API2 baseline 2026-11-04-manual-market-status, runtime6 and live38 targets verified; background remains paused.
## Проверка кандидата интеграции нарезки 05.11.2026 — не опубликован

Ветка `feature/fbs-fabric-cut-integration`, предполагаемая цель PR — `feature/la_panthera`.
Подключены исходники очереди WB/Ozon, экран CUT_FABRIC, подтверждение нарезки,
откладывание с сохранением резерва и сканов, доказательство PACKING при отгрузке.
`fbs-fabric-queue.ts` проверяет включение поштучного состава Ozon до резерва;
обычные товары клиента остаются на прежнем пути. `fabric-fbs-shipment-proof.ts`
исключает уже отгруженные WB-задания и проверяет принадлежность производства заказу.

Проверки: API без integration — 4436 passed / 9 skipped; integration последовательно
на отдельной локальной БД — 57 passed / 107 skipped. TypeScript прошёл.
Android LOGOFF прошёл; в Ffullhab два падения ReceiptPlacementActivityTest и
ReceiptProgressActivityTest воспроизводятся также на исходном 9bbd7a40 без изменений.
Параллельный общий запуск integration дал три падения KIZ identity transfer;
отдельно на исходной и изменённой версии, а также последовательно они проходят.
Это ограничение тестового запуска, не доказательство ошибки production.

До выпуска остаются: обработка отмены отложенного задания и отмены на маркетплейсе,
сквозная проверка повторного назначения, точный runtime overlay (sourceParityVerified=false),
проверки собранного API/подписанного APK. Нельзя включать режим на основании одних unit-тестов.
Повторная read-only сверка сервера: API sha256:451665ebbe686df5fb0ed19596cf68db06d58d7e538a74fe3a20d3f4f2621b04;
web sha256:b62f4d4b5d6f7f0f067d75ad9240b724d3160fdcc278f283ef171cc0780627e3.
Production, флаги и бизнес-данные в ходе проверки не менялись.

FBS fabric queue (prepared, not published): tryAssignFabricTask admits untouched WAITING_STOCK tasks created by automatic finished-stock reservation. Existing physical evidence checks and atomic claim stay intact; disabled installations unchanged. No marketplace or stock mutation in this code change.

Release tooling for the waiting-stock fix: scripts/releases/fbs-fabric-waiting/runtime.cjs validates the built API without DB access; release.py stages a one-module overlay and publishes only with merged PR proof, current-image/compose checks, release locks and automatic rollback.

Prepared, not published: fabric queue reports local ConflictException messages with the order number through assignFabricTaskForQueue, instead of replacing them with a marketplace refresh failure. Unexpected errors retain the generic fallback. No change to material reconciliation rules, reservations or completed scans. Branch fix/fabric-queue-block-reason.

Prepared, not published: approved later fabric receipts for FBS. assignFabricOrder resolves all matching pending WB shipment IDs within client/warehouse scope; only rolls received strictly after the latest proven shipment can be newly reserved. Unknown evidence remains blocked. reserveFabricOrder passes per-line cutoffs; reserveFabric preserves full ledger and existing commitments. Historical shipmentPending is not cleared or consumed. Own-WMS flag and client opt-in retained. Exact five-module overlay based on PR877; release scripts in scripts/releases/fbs-fabric-later-receipts.
Prepared receipt reporting correction: `receipt-linked-adjustments.ts` validates explicit movement snapshots; `receipt-channel-policy.receiptDocuments` applies them only to reports; `receipt-channels.controller.file` includes signed linked rows in XLSX. See [scope and validation](receipt-linked-adjustments.md). Not published; balances and sold WMS unchanged.

Prepared follow-up (2026-11-08): [saved FBS snapshots and blue fabric](fbs-fabric-reservation-display.md). Post-scope display decoration covers cold/merged saved orders; fresh physical/marking guards and client flags retained. Exact blue SKU support across availability/receipt/accounting. Source7/API4557/web605, runtime9, baseline8 and isolated boot passed; 9/2 skipped, dedicated DB suites excluded. API7/web0; sold WMS/data untouched; source parity false. PR target feature/la_panthera.
