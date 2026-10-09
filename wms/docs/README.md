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
