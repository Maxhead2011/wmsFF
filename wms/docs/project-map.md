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
