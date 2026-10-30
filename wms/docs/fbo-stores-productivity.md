# Магазины ФБО Ozon и производительность ФБО

Опубликовано PR800, 30.10.2026. База: PR802, `2026-10-30-ozon-packed-auto-done`.

## Магазины

Список Ozon запрашивает `requestStoreContexts` после существующего ограничения
клиента и филиала. Обе версии списка показывают магазин отдельно от плательщика.
Привязка определяется сохранённым подключением Ozon, а не общим физическим SKU.
Неопределённый магазин обозначается явно. Без флага/справочника старый вид сохраняется.

Операция `configure-ozon-stores.cjs` по умолчанию выполняет только проверку;
`--apply` создаёт отсутствующий справочник и AuditLog в одной транзакции под lock.
Существующий справочник не перезаписывается. Проверены CL-000016, Ozon seller40312
(Монларти) и seller520725 (Брайбо). №2529/2530 — Монларти, №2531 — Брайбо.
WB-подключения не классифицируются без отдельной сверки. SKU, КИЗы, остатки,
резервы и состав заявок не меняются; строгая приёмка по магазинам остаётся выключенной.

## Производительность

`fbo-picker-statistics.ts` добавляет отдельную статистику ФБО в существующий
мониторинг только при `WMS_FBO_PICKER_STATISTICS_ENABLED=true` в нашей WMS.
Период берётся из выбранного дня мониторинга. Запросы группируют физические
FboAssemblyUnit по заявке и исполнителю отдельно для pickedAt и packedAt.
Незавершённые заявки учитываются, RETURNED исключается, повторы сканов не
увеличивают количество. Заявки в итогах уникальны; отбор и упаковка не суммируются
в число физических единиц. Первое/последнее действие — московское время,
не оценка непрерывной работы. Это текущая подтверждённая история единиц: поздний
возврат исключит единицу и из отчёта за прошлый день. Длительности FBS не изменены.

## Проверки и выпуск

API4198, web582, TypeScript; API156/web2 пропущены, отдельный KIZ DB suite без URL
исключён. PostgreSQL11 на disposable DB и полный Nest health; браузер6 на фактических
компонентах; bootstrap5 (вход, reload, Заявки, FBS, FBO), один React root.
RED/GREEN для подписи магазина зафиксирован до исправления. Тесты нового отчёта:
`fbo-picker-statistics.spec.ts`, `FboPickerStatistics.spec.tsx`.

Точный overlay: три API-модуля, два новых web-chunk и index.html/importmap.
HTML entry остаётся прежним. APK249, схема и проданная WMS не изменяются.
`sourceParityVerified=false`: полная локальная сборка не заменяет сервер.
PR направляется в `feature/wb-print-check`; прямая публикация в ветку запрещена.


## Published PR800

Published PR800: Ozon FBO shop labels after client/branch scope; separate FBO picking/packing productivity by actor and Moscow day. API4198/web582/TypeScript, PostgreSQL11/full health, artifact browser6/bootstrap5/public5 and baseline8 passed. Exact API3/web3; own-image WMS_FBO_PICKER_STATISTICS_ENABLED=true, sold/schema/APK249 unchanged. Audited Ozon-only directory configured for CL-000016; shared stock and KIZ untouched, strict receipt flag off. Live2529/2530 Monlarti,2531 Braibo verified; WB shop bindings pending separate verification. Baseline sourceParityVerified=false.

Живая проверка опубликованных list/monitor handlers выполнена только на чтение.
2529/2530/2531 имеют DONE и показываются в завершённых заявках.
Справочник Ozon записан отдельной аудированной операцией после публикации.
Публичный bootstrap повторно проверен с ожиданием завершения сетевых обработчиков
перед закрытием браузера: пять сценариев, один root, без ошибок.
