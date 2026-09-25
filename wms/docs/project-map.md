# Карта проекта

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
