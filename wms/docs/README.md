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

Prepared, not deployed: [Сборка ФБС по номерам](fbs-manual-assembly.md) — ADMIN/OWNER, выбор филиала и короба, обычная заявка с сохранением поставок WB. Флаги выключены по умолчанию.

Published PR561 + PR562 / 2026-10-11: «Сервис → Сборка ФБС по номерам». ADMIN/OWNER, выбор филиала и короба, одна обычная заявка с сохранением поставок WB, повтор без дублей. Точный uint64-курсор WB; WMS_FBS_MANUAL_ASSEMBLY_ENABLED=true только в нашей WMS. API3344/web421 passed,145/2 skipped; два специализированных KIZ DB suite исключены. PostgreSQL5 на исходниках и5 на кандидате, браузерный граф31, live preview с откатом и блокировкой дубля №1921 прошли. Baseline `2026-10-11-fbs-manual`, sourceParityVerified=false. APK227, прочие флаги и проданная WMS сохранены. [Evidence](releases/fbs-manual-20261011.json).

Published PR559 / 2026-10-10: Excel mapping of WMS boxes to confirmed Ozon cargo IDs, directions and supply/order numbers. Download available after all directions succeed; exact text identifiers and scoped read-only export. Request1861 verified:27 boxes/11 directions. API3313/web417 passed,145/2 skipped; dedicated KIZ DB suites excluded. TypeScript, candidate runtime, live controller and browser download passed. Baseline `2026-10-10-ozon-cargo-export`, sourceParityVerified=false. APK227, print agent, flags, sold WMS and business records preserved. [Evidence](releases/ozon-cargo-export-20261010.json).

Published PR557 / 2026-10-10: Windows print agent2026.10.10.1 restores duplicate KIZ station heartbeat/polling and includes KizDuplicate.ps1 in package/installation. Only agent download changed. API/APK227/configuration/sold WMS unchanged; physical printer update required. 31 source and31 packaged agent tests, API3303/web416 passed;145/2 skipped, dedicated KIZ DB suites excluded. Baseline `2026-10-10-kiz-agent`, sourceParityVerified=false. [Details](kiz-duplicate-agent-station.md).

Current release **PR555**: [WB barcode identity](wb-barcode-identity.md). Baseline `2026-10-10-wb-barcode`; APK227 unchanged.

Current release **PR553**: [WB/Ozon product links](marketplace-product-links.md). Baseline `2026-10-10-marketplace-links`, APK227 preserved.

Published PR551 / 2026-10-10: LOGOFF APK227 adds last-unit packing undo and immediate Ozon destination barcode checks. Exact-unit receipt, atomic stock/KIZ return and audited idempotent undo; closed/stale/intervening operations rejected. WMS_FBO_PACK_UNDO_ENABLED=true only on our WMS. Three API modules and three APK download files changed; sold WMS, routing/schema and business records untouched by deployment. API3287/web414, Android252 per flavor (756), runtime7 and real PostgreSQL concurrency/rollback/KIZ return passed;139/2 skipped, dedicated KIZ integration excluded. Read-only production snapshot1861 verified capability; route allocation excluded. Physical scanner check pending APK installation. Baseline `2026-10-10-fbo-packing-undo`, sourceParityVerified=false.

Published PR549 / 2026-10-10: LOGOFF APK226 adds Ozon packing by product alongside packing by destination. Barcode/KIZ → suggested direction → carton scan; atomic packing, durable replay, quota checks. WMS_OZON_PACK_BY_PRODUCT_ENABLED=true only on our WMS. Three API modules and three APK download files changed; sold WMS, routing and business records untouched. API3283/web414, Android249 per flavor (747), runtime7 and real PostgreSQL concurrency/rollback passed;139/2 skipped, dedicated KIZ integration excluded. Read-only production snapshot1861 verified capability and18 suggestions; route allocation excluded. Physical scanner check pending APK installation. Baseline `2026-10-10-ozon-packing-product`, sourceParityVerified=false.

Published PR547 / 2026-10-10: LOGOFF APK225 displays barcode, product, size, destination quantity and packed/remaining counts for the selected Ozon destination. Existing response only; no added requests. 245 Android tests per flavor (735 total), release/lint and signed package checks passed. Regression reproduced before fix. Physical scanner verification pending installation. Only three APK download files changed; API, print agent, flags, sold WMS and stock unchanged. Baseline `2026-10-10-ozon-direction-items`, sourceParityVerified=false.

Current verified release: PR543, Ozon parallel packing capability; APK224 unchanged. [Production](current-production.md).

Current verified release: PR541, LOGOFF APK224; WB/Ozon selection in both picking and packing, optional marketplace query in TSD lists. [Production](current-production.md). Sold WMS unchanged.

Published PR539 (2026-10-09): WB/Ozon FBO lists separated by persisted Ozon shipment relation. API sha256:fe92f300071c6b51a2a8e5452bfef661910711c4e5b629f9e40d2c191aeb9f24, web sha256:302d0ae012e1317cad9b55b07080adc59472a48ca0367a85b21a4ea3af861dfd. Baseline `2026-10-09-fbo-marketplace`; sourceParityVerified=false. APK223, flags and business records unchanged. API3266/web414, runtime2 and read-only live list handler passed; 144/2 skipped, dedicated KIZ DB integration excluded. Rollback tags: logoff-api:before-fbo-marketplace-20261009 and logoff-web:before-fbo-marketplace-20261009.

Current verified release: PR537, print agent **2026.10.09.2**. [Production](current-production.md), [evidence](releases/print-agent-ack-conflict-20261009.json). Only agent download changed.

LOGOFF223 / PR535: [found-KIZ route](kiz-found-tsd-route.md); `KizFoundRouteTest` verifies actual Retrofit paths for all five actions.

Current verified base: **PR533**, `2026-10-09-ozon-multiple`. [Production](current-production.md).

Current verified release: PR529, LOGOFF APK222, found KIZ without a box. [Scenario](kiz-found-review.md); [production](current-production.md). FFULHAB untouched.

Current verified base: **PR527**, `2026-10-09-ozon-supply`. APK221 unchanged. [Production](current-production.md).

# Индекс нашей WMS

Актуализировано 09.10.2026. Последний выпуск **PR525**: [онлайн-выполнение](online-window-performance.md). База `2026-10-09-online-window`; LOGOFF APK221 сохранён. Проданная ВМС вне выпуска.

## С чего начать

1. [Паспорт опубликованного состояния](current-production.md) — версии и границы проверок; предыдущие записи ниже являются историей.
2. [Карта проекта](project-map.md) — точки входа и связи модулей.
3. [Индекс проверок](test-index.md) — связанные сценарии и ограничения тестов.
4. [Порядок выпуска](release-workflow.md) — свежая база, отдельная ветка, PR и проверка артефакта.
5. [Запись PR525](releases/online-window-20261009.json) и [актуальный baseline](../baselines/our-wms/2026-10-09-online-window/manifest.json).

Интеграционная ветка нашей WMS — `feature/wb-print-check`. Рабочие каталоги —
`D:/WMSFF/_Kof` и его подпапки, продукт — `wms/` в репозитории.
`sourceParityVerified=false`: успешная локальная сборка не доказывает соответствие
production. Перед следующим выпуском повторно сверить живые image ID;
не заменять действующий runtime полной сборкой исходников.

## Подготовлено к проверке

- [Подозрительные ШК приёмки и доступ ADMIN к проблемам ФБО](receipt-barcode-review.md) — реализовано, ещё не опубликовано.

## Последние изменения и рабочие сценарии

| Область | Документ | Что учитывать |
| --- | --- | --- |
| Навигация и темы, PR498 | [Разбор и проверки](single-react-incident-20261008.md) | Один React во всём достижимом JS-графе; переходы проверены в la_panthera, Soul и modern |
| Клиентский склад, PR496 | [Четыре раздела](client-warehouse-menu.md) | Онлайн-приёмка, приход товара, приёмки, отгруженные КИЗ; только свои данные, отдельные флаги API/web |
| Согласование приёмок, PR494 | [Доступ в остатках](receipt-stock-approval.md) | Лукина / ФФ Москва: подтверждение клиентом или администратором с именем и временем; до него нет доступного остатка и отбора, хранение начисляется |
| Выгрузки и ФБО, PR492 | [Журнал Excel и ожидание размещения](cabinet-export-and-fbo-placement.md) | Снимок выгрузки; подтверждённый свежий приход без палет-сорта ожидает размещения, прямой отбор закрыт |
| ФОТ, PR488 | [Редактирование и история](payroll-corrections.md) | Перенос смены, время, объёмы работ, фильтры и защищённая отмена новых исправлений |
| Отбор ФБО, PR485 | [Целые короба и частичный отбор](fbo-two-stage-picking.md) | Два маршрута LOGOFF; общий прогресс и сохранность уже отобранного |
| Биллинг, PR472 | [Закрытие периода](billing-period-close.md) | Корректировки отдельно от исходных счетов и оплат |
| Биллинг, PR455–469 | [Расчёты](billing-settlements.md), [частичный приход](billing-partial-receipt-fix.md), [статусы счетов](billing-invoice-status-filter.md), [сданные заявки](billing-done-requests.md) | Денежные суммы, покрытия и фильтры не изменяют складские движения |

## Справочники и история

[Архитектура](architecture.md), [описания модулей](modules.md),
[OpenClaw](openclaw-wms.md), [передача режима ТСД](releases/tsd-fbs-capability/README.md).
[Сверка до PR302](../baselines/our-wms/2026-09-25/divergence.json) — исторические
расхождения, а не свидетельство полной синхронизации. Старые снимки и пути
относятся к своим выпускам и не заменяют актуальный baseline.

Операционные расхождения сохранённых инструкций, маршрутов ТСД и остатков WB
проверяются отдельно: обновление документации не изменяет остатки и заявки.
Current verified receipt release: PR522, baseline `2026-10-09-receipt-review`, LOGOFF APK221. See [production](current-production.md) and [receipt review](receipt-barcode-review.md).


Опубликован PR531: [постоянная станция печати](print-agent-lifecycle.md), версия 2026.10.09.1. Актуальный baseline `2026-10-09-print-agent`; сервер PR529 и APK222 сохранены.
