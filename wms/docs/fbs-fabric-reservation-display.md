# Отображение нарезки ткани в ФБС WB

Список заказов показывал для ткани «Резерв ожидает товар» и требовал короб на палет-сорте, хотя очередь ТСД уже поддерживает нарезку из рулонов. Автоматический резерв готового товара и чтение сохранённого задания не учитывали этот режим.

Для открытых заказов WB без физических действий список возвращает состояние представления `FABRIC_ON_DEMAND`: «Нарезка по факту». Оно не записывается в статус задания и не означает наличие либо резерв метров. Обновление распределения не ищет готовый отрез в коробе. Старое нетронутое `WAITING_STOCK` сохраняется в БД до штатного назначения на ТСД.

Условия: `WMS_FBS_FABRIC_CUT_ENABLED=true`, оба включения клиента (`fabric.fbs.enabled.v1`, `fabric.rolls.enabled.v1`), точная идентификация складской карточки ткани, отсутствие требования КИЗ и переклейки. Обычные товары, выключенные клиенты, подтверждённый резерв короба, сканы, завершённые и отменённые заказы сохраняют прежний путь. Перед формированием ответа повторно учитывается свежая запись задания, включая конкурентный старт отбора.

Метры проверяются и списываются существующими операциями сборки/передачи, не чтением списка. Изменение не создаёт запас готовых отрезов, не снимает ограничений материала и не меняет Ozon, печать, биллинг или данные проданной ВМС.

Файлы: `fbs-fabric-reservation.ts` (`fabricReservationOrders`, `untouchedFabricReservation`), `MarketplaceConnectionsService.syncFbsPalletSortReservations`, `FbsPanel.tsx` (`FbsOrderRow`). В исходном методе сохранён уже опубликованный режим `readOnly`; runtime меняется четырьмя ограниченными вставками. Web меняет одно условное выражение и import map, сохраняя прочие assets.

Проверка: регресс до изменения воспроизвёл поиск готового товара; после изменения тест реального метода запрещает чтение StockBalance и запись задания для ткани. Отдельно проверены маркировка, переклейка, чужой клиент, выключенные настройки и конкурентное начало отбора. Два теста строки UI, семь тестов точного runtime, два браузерных сценария. Read-only проверка по десяти старым ожидающим заданиям двух клиентов подтвердила классификацию; категории заказов для этой проверки заданы тестом, это не аудит текущих статусов WB. Физическое сканирование ТСД не выполнялось.

Скрипты выпуска: `scripts/releases/fbs-fabric-display-20261108/`. Отдельный PR в `feature/la_panthera`; production baseline остаётся с `sourceParityVerified=false`.

Опубликовано PR914 в `feature/la_panthera`. Проверены хеши всех 754 модулей API и двух web-файлов на сайте, здоровье API и сохранность окружения/остальных контейнеров. Браузерные проверки нового блока и ранее опубликованных кнопок/шапки прошли на кандидате и сайте. База `2026-11-08-fabric-display`.

## Follow-up: saved WB snapshots and blue fabric (2026-11-08)

`decorateFabricReservationResponse` runs after the controller's client/branch/store scoping, including cold saved snapshots and merged order rows. It reads fresh task evidence in bounded batches, preserves cache objects and sync metadata, and refuses physical/marked tasks. No task or stock write occurs. `blue_*` exact articles are supported consistently in fabric availability, runtime roll receipt, shipment accounting and the roll storage label. Existing client/our-WMS gates remain; sold WMS is not deployed.

Files/functions: fbs-fabric-reservation.ts, MarketplaceConnectionsController.listFbsOrders, MarketplaceConnectionsService.decorateFbsFabricDisplay, identifyFabricSku; legacy runtime fabricSku/applyRollAction, identify/planShipments and virtualSku use exact constant-only overlays. Runtime snapshot routing absent from the older controller source is preserved, not overwritten. Scripts: `scripts/releases/fbs-fabric-snapshot-20261108/` (API7, web0). PR target `feature/la_panthera`.

Validation: new source7 (first two reproduced before fix), API4557 passed/9 skipped, web605 passed/2 skipped; dedicated DB integration excluded. Exact runtime9, baseline8, isolated full API/PostgreSQL boot, read-only four actual saved orders with no WB calls. Full API typecheck still has the two pre-existing Yandex nullable-SKU errors; no new type errors. Public stock-cell browser2 and compact-controls/header checks must pass before release. Physical TSD/printer not tested. No receipts/metres/stock were created by the diagnostic or release.

Published follow-up PR916. Read-only checks on all four reported saved rows and exact runtime9 passed on the working server. Public stock-cell2, compact controls24 and header12 passed; all API hashes match and web is unchanged. Baseline `2026-11-08-fabric-snapshot`.
