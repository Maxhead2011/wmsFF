# Карта проекта WMS

Сверено 16.09.2026 с `a2bfc82`, исходная ветка `fix/fbo-xlsx-warehouse-selection`.
Пути ниже относительны `wms/`. Для другой ветки сначала проверьте наличие файлов.

## Структура и точки входа

| Область | Путь | Назначение |
| --- | --- | --- |
| API NestJS | [main.ts](../apps/api/src/main.ts), [app.module.ts](../apps/api/src/app.module.ts) | Запуск сервера и подключение модулей |
| Бизнес-логика API | [src/modules](../apps/api/src/modules/) | Контроллеры, DTO, сервисы по предметным областям |
| База WMS | [schema.prisma](../apps/api/prisma/schema.prisma) | Модели, связи, ограничения; изменения схемы сверять с миграциями |
| Аналитическая БД | [analytics/schema.prisma](../apps/api/prisma/analytics/schema.prisma) | Отдельная Prisma-схема аналитики |
| Web React/Vite | [main.tsx](../apps/web/src/main.tsx), [App.tsx](../apps/web/src/App.tsx) | Инициализация и приложение |
| Web API-клиент | [lib/api.ts](../apps/web/src/lib/api.ts) | HTTP-вызовы, DTO фронтенда, multipart |
| Android-ТСД | [MainActivity.kt](../apps/android-tsd/app/src/main/java/pro/logoff/wms/tsd/MainActivity.kt), [WmsApi.kt](../apps/android-tsd/app/src/main/java/pro/logoff/wms/tsd/network/WmsApi.kt) | Экранные сценарии и сетевой контракт |
| Инфраструктура | [infra](../infra/), [docker-compose.yml](../infra/docker-compose.yml) | Контейнеры, проксирование, вспомогательные скрипты |

## По задаче пользователя

| Задача | Где начать в API | Где начать в web / ТСД |
| --- | --- | --- |
| Заказ WB, поставка, перенос, статус | `modules/marketplace-connections/marketplace-connections.service.ts`; `fbs-stock-transfer.ts`, `fbs-wb-accounting.ts` в той же папке | `components/fbs/FbsPanel.tsx`, `components/client-requests/ClientRequestsPanel.tsx` |
| Остатки для FBS, публикация на маркетплейсе | `modules/marketplace-connections/fbs-stock-monitoring.service.ts`, `fbs-stock-allocation.service.ts`; `modules/stock/` | `components/fbs/`, `lib/api.ts` |
| ТСД: сборка, короб, КИЗ, резерв | `modules/tsd/tsd-assembly.service.ts`; затем `modules/stock/` | Android `MainActivity.kt`, `network/WmsApi.kt` |
| Повторная сборка | `modules/marketplace-connections/fbs-repeat-assembly.service.ts` | `components/fbs/FbsRepeatAssemblyPanel.tsx` |
| Заявка FBO из Excel | `modules/client-requests/client-request-xlsx.service.ts`, `dto/import-outbound-request-xlsx.dto.ts`, `parsers/outbound-request-xlsx.parser.ts` | `components/client-requests/ClientRequestXlsxImportForm.tsx`, `lib/api.ts` |
| Приёмка, синхронизация сканов | `modules/tsd/tsd-receipt.service.ts`, `tsd-sync.service.ts`, `tsd-review.service.ts` | `components/warehouse/OnlineReceiptPanel.tsx`, `ReceiptBatchesPanel.tsx`; Android |
| Короба, паллеты, размещение | `modules/warehouse/`, `modules/stock/` | `components/warehouse/BoxManagementPanel.tsx`, `StoragePanel.tsx`, `StorageZonesPanel.tsx` |
| Инвентаризация, оборот КИЗ | `modules/inventory/`, `modules/kiz-circulation/`, `modules/kiz-issues/` | Найти вызов соответствующего API через `lib/api.ts` |
| Пользователь, клиент, филиал | `modules/auth/`, `modules/users/`, `modules/clients/`, `modules/branches/`; `client-requests/client-request-warehouse-scope.ts` | `lib/api.ts`, форма нужного сценария |
| Начисления, счета, хранение | `modules/billing/`, `modules/contracts/`, `modules/expenses/` | Найти API-вызов и использующий его компонент |
| Доставка, фабрика, Ozon FBO | `modules/logistics/`, `modules/factory-shipments/`, `modules/ozon-fbo/` | Соответствующие компоненты через поиск API-вызова |
| Печать этикеток | `modules/print/` | Web API-клиент и Android сетевой контракт |
| Отчёты, оборот, интеграции | `modules/analytics/`, `modules/turnover/`, `modules/integration-api/` | `components/turnover/`, API-клиент |

Все API-пути в этой таблице начинаются с `apps/api/src/`, web-пути — с `apps/web/src/`. Имена сервисов помогают найти область, но обработчик конкретного действия устанавливайте по контроллеру.

## Основные связи данных

| Сущности Prisma | Что проверять |
| --- | --- |
| `ClientMarketplaceConnection`, `FbsOrderRequestLink` | Подключение и клиент заказа, ссылка на заявку, последний сохранённый статус WB и время синхронизации |
| `FbsTsdAssembly` | Резерв, фактический короб, исходный SKU для переклейки, КИЗ, завершение сборки и упаковка |
| `FbsAssemblyAttemptHistory` | Предыдущая завершённая попытка при повторной сборке |
| `ClientRequest`, `ClientRequestItem`, `ClientRequestBoxSelection` | Номер заявки, состав и выбор коробов; выбор короба в завершённой заявке не равен активному резерву |
| `Sku`, `Barcode` | Точное соответствие клиенту, штрихкоду, артикулу и размеру |
| `StockBalance`, `StockMovement` | Текущие количества по статусам и история движения |
| `Box`, `Pallet`, `StoragePallet`, `StoragePalletBox` | Короб и его размещение; проверять `storagePlacement`, а не только `Box.palletId` |
| `ProductMark` | КИЗ, SKU, короб, статус и связь с движением |
| `AuditLog` | Зафиксированные действия; отсутствие записи само по себе не доказывает отсутствие физического действия |

### Проверка зависшего заказа

1. Найдите номер вместе с `marketplace`, `connectionId`, `clientId`. Один номер может присутствовать у нескольких подключений.
2. Сопоставьте `FbsOrderRequestLink`, заявку и `FbsTsdAssembly`. Отдельно смотрите резерв, скан товара, КИЗ, завершение и упаковку.
3. Сверьте сохранённые статусы с текущим WB API. Название поставки и статус ВМС не подтверждают фактическую приёмку WB.
4. Ищите точный штрихкод во всех соответствующих SKU и филиалах. Разделяйте `AVAILABLE`, `PACKING`, другие статусы и резервы.
5. Проверьте статус и текущее размещение короба. Сохранённый список `storageBoxes` может устареть.
6. При поиске замены проверьте историю переклейки, размер и фактический товар. Похожий артикул не означает взаимозаменяемость; историческая переклейка не даёт разрешения на новую.
7. Завершайте диагностику подтверждёнными данными и оставшимися неизвестными. Не исправляйте остатки и статусы только для устранения расхождения на экране.

### Проверка Excel-заявки

Проследите цепочку: файл и филиал в `ClientRequestXlsxImportForm` → multipart в `api.ts` → DTO → `ClientRequestXlsxService` → проверка доступности / создание в `ClientRequestsService`.
Проверяйте права клиента, филиал, чтение штрихкодов, количество и дефицит отдельно. Успешный разбор файла не означает достаточность остатка.

## Поиск и тесты

КИЗ без подтверждённой печати SOS WB 2: `modules/service/unprinted-kiz.{controller,service,policy}.ts`, web `components/service/UnprintedKizPanel.tsx` и `lib/unprintedKiz.ts`. Выбор по периоду сканирования, номеру заявки ВМС или поставке WB; последующая печать проверяется без ограничения датой. Онлайн-сборка `TsdAssemblyService.loadFbsAssemblyFacts` использует `service/fbs-packing-progress.ts` для этапов «Найдено» и «Упаковано»; web-компонент `FbsPackingStatus.tsx` показывает время и сотрудников. Создание поиска использует существующий формат `KIZ_SEARCH_CREATED` для ТСД. Флаги и критерии: [описание проверки](testing/service-unprinted-kiz-search.md).

Из папки `wms/`:

```powershell
rg -n 'previewOutboundRequest|createOutboundRequest' apps/api/src apps/web/src
rg -n 'readWbStatusesForConnection|FbsOrderRequestLink' apps/api/src
rg -n 'reservedBoxId|sourceSkuId' apps/api/src/modules/tsd
rg --files apps/api/test apps/web/src apps/web/test
```

- API: `apps/api/test/*.spec.ts`, Vitest; web: тесты в `apps/web/src/`, дополнительные сценарии в `apps/web/test/`.
- Скрипты пакетов: [API package.json](../apps/api/package.json), [web package.json](../apps/web/package.json), [общие команды](../package.json).
- В `apps/api` и `apps/web`: `npm test -- --run` и `npm run build` при уже установленных зависимостях. Монорепозиторий объявляет pnpm; установку выполняйте по его lockfile и `packageManager`.
- Android: Gradle из `apps/android-tsd`; варианты сборки и окружение сверяйте с конфигурацией приложения.
- Для исправления поведения нужен воспроизводящий регрессионный тест. Для правок только документации проверяйте ссылки, пути и diff; запуск приложения не подтверждает точность текста.

## Ветки и развёртывание

Фильтр списка FBS по выбранному филиалу: `MarketplaceConnectionsService.scopeFbsOrdersForUser`, тест `apps/api/test/fbs-selected-branch-filter.spec.ts`. Включается серверной переменной `WMS_FBS_SELECTED_BRANCH_FILTER=true`; по умолчанию остаётся прежнее поведение. При включении даже глобальные роли видят заказы по выбранному филиалу: WB — по маршруту склада (`BRANCH`, `CENTRAL` или настроенная автопривязка), Ozon — по филиалу исполнения подключения. Историческое размещение заявки не переопределяет маршрут. В центре заголовка FBS селектор «Режим отображения» передаёт `displayWarehouseId` для выбранного филиала либо `allBranches=1` для «Показать всё» в списки заказов, активных клиентов и клиентов: глобальные роли видят общий список без исключённых складов, ограниченные пользователи — только разрешённые филиалы. Рабочий филиал в профиле не сбрасывается. `FbsPanel.tsx` пересоздаёт содержимое экрана при смене режима, сбрасывая прежний выбор заказов и сохраняя выбранный маркетплейс. `ClientsService.list` фильтрует клиентов по активным привязкам к филиалу; тест `apps/api/test/clients-display-branch.spec.ts` проверяет права и совместимость при выключенном флаге. Переменная не меняет права пользователя и не переносит заказы.

Перед работой: `git status --short`, `git branch --show-current`, затем выясните целевую ВМС. Создавайте `fix/…` или `feature/…` от согласованной текущей ветки. Не переключайтесь на `main`/`master` и не пушьте в защищённые или интеграционные ветки напрямую.

В этой сессии PR №144 принят в `feature/billing-period-register-20260910`. Это исторический факт, не постоянное назначение всех будущих PR. Ветки `feature/our-vm` и `feature/sold-vm`, упомянутые в правилах пользователя, отсутствовали среди полученных remote refs при проверке 16.09.2026; не создавайте их автоматически и не угадывайте замену.

Сервер может содержать выпуски из нескольких линий разработки. Перед публикацией сверяйте текущие образы, источник сборки, миграции, конфигурацию и сведения о выпуске. Локальный checkout, корневой README и старый deploy-скрипт не являются доказательством соответствия production. Для проданной ВМС отдельно оценивайте общие модули и не развёртывайте изменения без соответствующей задачи.

### Резерв и рекомендации WB

Необязательное `WbStockReserve.lowStock = { threshold, reserveUnits }` заменяет основной резерв, если доступный остаток строго меньше порога; при равенстве действует основной резерв. Расчёт `wbStockAfterReserve` применяется до распределения на склады, ограничивается нулём снизу. Свой резерв SKU заменяет всё правило клиента, запрет публикации приоритетнее. `WbLowStockReserveFields.tsx` используется в клиентском, товарном и административном редакторах; отключение удаляет вложенное правило. Старые настройки без lowStock сохраняют прежнее поведение.

Флаг `WMS_WB_STOCK_FINE_SETTINGS=true` включает на нашей ВМС резерв клиента (`marketplace-stock-control.service.ts`, `wb-stock-reserve.ts`), endpoint `PUT administration/marketplace-stock-control/:clientId/reserve` и анализ `wb-stock-demand-analysis.ts`. При выключенном флаге прежние расчёты сохраняются. Резерв применяется в расчётах публикаций и сверки WB, но не меняет StockBalance/ProductMark. Настройка хранится в SystemSetting, отдельно от общего разрешения отправки. Менеджер клиента (роль CLIENT с явным закреплением в clientIds и writableClientIds и правом stock:read) может менять резерв и исключения SKU в FBS WB → Распределение остатков; демо и доступ только на чтение исключены. Шаг рекомендаций и общий выключатель остаются административными. `reserveSettings` возвращает резерв и версию одним чтением; `WbClientReserveEditor` сохраняет с этой версией, не сбрасывая несохранённые доли.

Веб: `AdministrationMarketplaceStockControl.tsx` — резерв; `FbsStockAllocationView.tsx` и `WbStockFineControls.tsx` — ABC по объёму заказанных единиц, XYZ по вариации дневного спроса, предпросмотр, исключения по SKU, шаг рекомендации и подтверждения WB. Рекомендация сама ничего не сохраняет; ручные доли остаются при недостаточной истории. Настройки администратора: `PUT administration/marketplace-stock-control/:clientId/skus/:skuId` (резерв или запрет публикации) и `PUT .../:clientId/analysis` (шаг в п.п., по умолчанию 10, 0 фиксирует доли). Все настройки версионированы, изолированы по клиенту и аудируются; общий выключатель они не меняют.

`wb-stock-safe-publication.ts` сначала уменьшает и повторным чтением подтверждает остатки на всех складах, затем увеличивает. Удалённые из долей склады получают нули для известных публикаций. Ошибка/неполный ответ останавливает увеличение; повторная синхронизация начинает с факта WB. `wb-stock-observations.ts` сериализует отправки одного подключения через advisory lock PostgreSQL, сохраняет последнюю проверку по товару/складу. При действующем распределении прямое ручное увеличение одного склада отклоняется: нужно синхронизировать общий план через раздел распределения. `POST marketplace-connections/fbs/stocks/allocation/check` сверяет сохранённый план с WB без PUT даже при выключенной отправке. Таблица показывает последние 500 проверок, кнопка проверяет все сохранённые позиции.

`WbStockAvailabilityDay` накапливает почасовые наблюдения WB, включая выключенную исходящую публикацию. `wb-stock-demand-coverage.ts` отличает отсутствие наблюдений от нулевого остатка и нормирует спрос по наблюдаемым часам наличия. Минимум: 18 часов наблюдений за день, 7 дней покрытия и 3 эквивалентных дня наличия на участвующий склад; для XYZ также 10 заказанных единиц и 7 дней с заказами. Старую историю не выдумываем; до накопления данных остаются ручные доли. Хранение наблюдений — 90 дней, анализ — последние 30; дни по Москве, незавершённый день исключён из оценки наличия.

Изменения `StockBalance` после инвентаризации, актуализации коробов и сортировки/перемещения учитывает существующий фоновый `autoSyncFbsStocksForClient`: период запуска по умолчанию 30 секунд после завершения предыдущего обхода (не гарантия доставки за 30 секунд). При включённом флаге публикация одного склада может и уменьшаться, и увеличиваться до свободного остатка после резерва/лимита. Обычное перемещение между коробами одного склада не добавляет единицы. Отправка требует включённого контроля клиента, активного подключения и подготовленных публикаций/политики распределения. Ошибки WB задерживают синхронизацию и отражаются в проверках. Физические остатки, КИЗ и незавершённые пересчёты функция не редактирует.

Миграция `20260918050000_wb_stock_verification`: новые таблицы `WbStockPublicationCheck`, `WbStockAvailabilityDay`, без переписывания складских остатков. Перед включением флага применить миграцию и сгенерировать Prisma Client. Для отката поведения выключить флаг; таблицы можно оставить. В проданной ВМС флаг не включать без отдельного согласования.

Тесты: `apps/api/test/wb-stock-*.spec.ts` (резерв, исключения, спрос/наличие, подтверждённая отправка, блокировки, автообновление), `apps/web/src/lib/wbStockPreview.spec.ts`, `api.wb-stock-fine.spec.ts`. Реальные отправки WB в тестах не выполняются.
