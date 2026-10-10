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
