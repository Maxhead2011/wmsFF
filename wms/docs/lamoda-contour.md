# Lamoda — подготовительный контур, 26.10.2026

## Продолжение в работе: `feature/lamoda-operations`

Локально добавлены `lamoda-commands.ts`, закреплённые схемы официального API,
методы `LamodaClient.execute/packLabel` и `lamoda-operation-journal.ts`.
Отправки ограничены перечнем методов, валидируются до OAuth и требуют отдельного
`WMS_LAMODA_EXTERNAL_WRITES_ENABLED=true` (по умолчанию выключен).
Таймаут, 5xx, неоднозначный HTTP и повреждённый успешный ответ означают UNKNOWN,
автоматического повтора бизнес-запроса нет. PDF проверяется по MIME и сигнатуре,
чтение ограничено 10 МБ. Форматы этикеток S/M/L соответствуют спецификации.

Подготовлена дополнительная миграция `20261026160000_lamoda_operations`.
Журнал использует уникальный ключ кабинета/операции, хеш состава и атомарный переход
PENDING → SENDING. SENDING после перезапуска не возвращается автоматически в очередь.
Неопределённый результат требует сверки. Ответы с персональными данными в журнал не пишутся.

**Не опубликовано.** Журнал пока является внутренним компонентом, не подключён
к пользовательским маршрутам и складской сборке. Миграция на сервер не применялась.
Следующий этап: сохранение подтверждённых внешних идентификаторов, сверка зависших
операций, создание складских заявок и интеграция ТСД. Не включать внешние записи
до завершения этих этапов и проверки с подключённым клиентом.

Проверки: 60 тестов Lamoda API/контрактов и 5 тестов журнала прошли;
Общий API-прогон: 3709 passed, 150 skipped; две специальные KIZ integration suites исключены. TypeScript и Prisma schema прошли. Тест журнала использует изолированное хранилище в памяти:
это не заменяет проверку миграции и конкурентных запросов на PostgreSQL.

Ветка `feature/lamoda-contour`, база PR689/PR690 (`276e7fac`, `feature/wb-print-check`), объединена без потери последнего выпуска.
**Опубликовано 26.10.2026, PR691. Это первый этап плана, а не готовый полный коннектор FBO/FBS.**

## Что реализовано

- Изолированный модуль `apps/api/src/modules/lamoda/`: подключение рабочего клиента,
  проверка доступа к Seller ID, смена секрета и отключение подключения.
- OAuth `client_credentials`, обновление по `expires_in`, объединение одновременных
  запросов токена одного кабинета. Единственный исходящий POST — получение OAuth-токена.
  Бизнес-методы Lamoda вызываются только через GET. База URL фиксирована, редиректы запрещены.
- AES-256-GCM для Client secret с привязкой к клиенту, Seller ID и OAuth Client ID.
  Токены живут только в памяти; ответы кабинета не содержат секретов.
- Полная постраничная загрузка каталога; внутренние ID заказов сохраняются отдельно
  от публичных номеров. Чтение поставок FBO/FBS и ожидаемых возвратов.
  Журнал результата, запрет одновременных загрузок, курсор заказов с перекрытием 5 минут.
  При сбое страницы предыдущий кеш/курсор не заменяются неполными данными.
  Черновики карточек с `sku:null` пропускаются с явным счётчиком. После истечения аренды
  старый незавершённый запуск отмечается `INTERRUPTED`, новый получает свою аренду.
- Сопоставление карточек вручную по точному ШК внутри выбранного клиента.
  Изменение ШК/размера/артикула Lamoda снимает подтверждение. Несколько совпадений
  не выбираются автоматически. Загрузка каталога не создаёт SKU или складские остатки.
- Шаблон Excel и импорт черновиков FBO. Числовые ШК, формулы, некорректные количества
  и файлы более 1000 строк отклоняются. ШК в шаблоне имеют текстовый формат.
- Предварительная доступность через существующий `ClientRequestsService.previewAvailability`:
  один товар из нескольких направлений проверяется суммарно. Это расчёт FBO, а не количество
  для публикации FBS. Черновики **не резервируют** товар и **не запускают ТСД**.
- Панель `ФБО → Lamoda`: подключение, товары, планы, заказы, возвраты, журнал.
  Ожидаемый возврат не становится фактическим приходом. Статус загрузки не означает,
  что документ исполнен или физически отгружен.

## Границы и оставшаяся работа по согласованному плану

1. Подключение и чтение — реализованы, требуют проверки с настоящим кабинетом.
2. Каталог — собственная панель и подтверждение связей реализованы. Отображение Lamoda
   в общей таблице каталога и расширение общего реестра соответствий ещё не сделаны.
3. Резервы — предварительный расчёт FBO использует существующие правила; добавление спроса
   Lamoda в общий резерв и безопасная публикация FBS ещё не сделаны.
4. FBO — импорт черновиков и привязка к загруженному ID поставки реализованы.
   Создание складской заявки, проверка состава удалённой поставки, запуск и контроль сборки
   ещё не сделаны. Привязка ID черновика не подтверждает совпадение количеств.
5. ТСД, упаковки и официальные этикетки Lamoda — ещё не реализованы. Существующий режим
   WB/Ozon не выдаётся за Lamoda и не изменён.
6. FBS — читаются списки заказов и отгрузок; позиции заказов, резервы, пакеты, сборка,
   отмены после отбора, передача отгрузок и сверка неопределённого ответа ещё не реализованы.
7. Возвраты — читается ожидаемый возврат; складской workflow приёмки, карантин и биллинг
   Lamoda ещё не реализованы. Статистику received/accepted FBO храним отдельно.

Полноценный запуск продаж невозможен в этой версии: нет обработчика отправки остатков,
создания/подтверждения отгрузок или запуска сборки. Нельзя обозначать эти отсутствующие
операции как «реализовано, но выключено».

## Данные и права

Пять добавленных таблиц: `LamodaAccount`, `LamodaProduct`, `LamodaDocument`, `LamodaPlan`,
`LamodaExchange`. Миграция `20261026120000_lamoda_preparation` только добавляет таблицы,
индексы и внешние ключи, не меняет остатки и существующие строки.

Все методы требуют `marketplace-api:read/write` либо `system:admin` и проверяют клиентскую
область доступа. Изменения запрещены демо-пользователю. Планы и расчёт доступны только
в разрешённом филиале. Сырые телефоны/адреса получателей из ответов Lamoda не сохраняются.

Заказы при первом чтении берутся за последние 90 дней, далее по updatedAt с перекрытием.
Поставки/возвраты запрашиваются в бизнес-периоде ±90 дней. До полноценного FBS-пуска нужно
отдельно загрузить все открытые старые заказы. Автоматический планировщик/webhook ещё не добавлен.
Одна загрузка ограничена 100 страницами по 100 записей и 120 секундами между запросами;
превышение даёт ошибку, не частичный успех. Интерфейс показывает до 1000 товаров,
500 документов, 100 планов и 25 событий журнала; пагинацию рабочего кабинета расширить
перед запуском большого каталога.

## Флаги и выпуск

- `WMS_LAMODA_ENABLED=true` — открывает подготовительные серверные методы.
- `VITE_LAMODA_ENABLED=true` — показывает плитку подготовки в FBO.
  Используется существующий `FboWorkspace` (`VITE_FBO_WORKSPACE_ENABLED=true`).
- `WMS_LAMODA_SECRET_KEY` — отдельный ключ из 32 случайных байт, base64. Хранить в секретах
  окружения, не в Git. Потеря ключа делает сохранённые OAuth-секреты нечитаемыми.
  Ротация ключа требует отдельной миграции зашифрованных значений.
- По умолчанию оба флага выключены. Общий MarketplaceType и обработчики WB/Ozon не расширены:
  Lamoda не может случайно пройти через старую ветку обработки WB.
- Проданную WMS не обновлять этим выпуском. До публикации нашей установки — свежая сверка
  реального runtime, проверка миграции в отдельной PostgreSQL, точечный кандидат через
  `release_baseline.py`, PR в `feature/wb-print-check`. Полная локальная сборка не является
  точной копией production.

## Проверки

Новые тесты: `test/lamoda-client.spec.ts`, `test/lamoda-policy.spec.ts`,
`test/lamoda.service.spec.ts`, `components/lamoda/LamodaPanel.test.tsx`.
Проверяются scopes, выключенный флаг, шифрование и привязка секрета, истечение/401 токена,
пагинация/ошибки, точные оболочки ответов API, изменения идентификаторов, повторяющиеся
строки плана, неоднозначный ШК, филиал, отсутствие исходящих бизнес-записей.

Проверки кандидата после объединения с PR689/690: API **3682 passed / 150 skipped**, web
**502 passed / 2 skipped**. Два KIZ integration suite исключены: требуют своей отдельной БД.
TypeScript API/web прошёл. 38 тестов Lamoda API входят в общий прогон.

На изолированной PostgreSQL выполнена настоящая миграция от точной предыдущей runtime-схемы:
пять таблиц добавлены, `prisma migrate diff` не обнаружил расхождений. 10 интеграционных
проверок кандидата прошли: шифрование, scope, связи, импорт без дублей, сумма направлений,
отказ загрузки без потери кеша, ротация секрета, выключенный флаг, отсутствие складских записей.
Полный API запущен на отдельных основной и аналитической тестовых БД, health OK.
Первый запуск тестового окружения без аналитической БД не завершился; после добавления
изолированной аналитической БД полный запуск прошёл. Production при проверках не менялся.

10 браузерных сценариев на точном runtime с изолированными API-данными прошли:
меню WB/Ozon/Lamoda, подключение, скрытый секрет, смена клиента, чтение каталога,
черновики, запрет FBS при выключенной схеме и сохранение существующего экрана WB.
Реального кабинета Lamoda ещё нет — сетевой контракт проверен фикстурами.

Скрипты выпуска: `scripts/releases/lamoda-preparation-20261026/`; браузерная проверка:
`scripts/tests/lamoda-runtime-browser.cjs`. Локальные отчёты:
`D:\WMSFF\_Kof\work\lamoda-release-20261026/` и `work/lamoda-contour/*-merged-tests.log`.
Точная добавка: девять API-файлов, четыре web-файла, расширение runtime-схемы/Prisma.
Перед публикацией: повторная сверка образов под блокировками, резервная копия БД и конфигурации,
транзакция DDL с записью в Prisma migration ledger, отдельный случайный ключ в серверном `.env`
и его передача только сервису API. Ключ не попадает в Git/образ/ответы. При откате прежние
образы и конфигурация восстанавливаются; новые таблицы автоматически не удаляются.

## Контракт Lamoda

Использован [официальный OpenAPI v2](https://academy.lamoda.ru/upload/iblock/5d9/tmjgfhmk1s6qaa9fo89vduavfeo6psu5.yaml),
найденный на [странице спецификации](https://academy.lamoda.ru/articles/api/spec/10_v2_spec/).
Проверено 26.10.2026. `/nomenclatures` → nomenclatures, `/orders` → orders,
`/fbo/shipments` → shipments, `/fbs/shipments` → items, `/fbs/return-items` → data.
Идентификатор заказа для API — `id`, отображаемый номер — `orderId`.
SHA-256 скачанного OpenAPI:
`373fb1b1241cfecde7243f6b52c92683c5554617b58bca776287a89dffe864c9`.

## Опубликованный выпуск

Точный runtime и схема сверены с кандидатом после публикации; health OK. Публичный интерфейс прошёл 10 сценариев с перехватом всех API-вызовов на синтетические данные. Реальный read-only smoke проверил таблицы и доступность раздела без создания подключений/товаров.
Ключ хранится в серверном `.env`, добавлена передача `WMS_LAMODA_SECRET_KEY` только API. Миграция записана в `_prisma_migrations`. Резервная копия БД/конфигурации находится в защищённой серверной папке выпуска.
Откат: `logoff-api:before-lamoda-preparation-20261026` и `logoff-web:before-lamoda-preparation-20261026`; конфигурация сохраняется отдельно. При откате не удалять ключ, если уже появились подключения: он нужен для расшифровки. Новые таблицы автоматически не удаляются.

## Prepared FBO import and assembly / 2026-10-28

Excel creates a plan; existing-shipment import reads ID, warehouse and quantityPlanned from Lamoda. Confirmed unambiguous SKU mappings are required before a separate action creates an OUTBOUND request/reservation and durable LamodaFboAssembly binding. Repeated creation returns the same request. Shortage never silently reduces the plan. Existing two-stage stock/reservation/KIZ guards remain; boxless and source-box picking and direction packing use the shared pipeline. Lamoda cannot export WB files.

Files: lamoda-fbo-policy.ts (ID/quantity/mapping); lamoda-client.ts/fboShipment; lamoda.service.ts/importShipment,createAssembly; controller/DTO; Prisma LamodaFboAssembly and migration20261028120000; client-requests.service.ts and client-request-marketplace-files.service.ts; fbo-two-stage.service.ts; LamodaPanel.tsx/FboTwoStagePanel.tsx/fboRequestScope.ts/api.ts; Android FboTwoStageScreen.java; administration-internal-api.service.ts registry.

Release needs additive migration, new APK and own-installation-only WMS_LAMODA_FBO_ASSEMBLY_ENABLED=true. Preserve existing two-stage/unboxed flags. Lukin FBO account was verified28Oct; FBS disabled, live shipment list empty. Actual cabinet URL and physical end-to-end cycle still unverified. This imports existing Lamoda shipments; it does not create remote shipments.

Pre-integration checks: web506 passed/2 skipped; all three Android flavor unit suites passed; isolated synthetic PostgreSQL table constraints5 passed (not full runtime migration parity). Exact runtime migration, candidate/browser/public checks remain mandatory before release.

Release candidate2026-10-28: integrated PR710; API3809 passed/155 skipped (dedicated KIZ DB suite excluded), web512/2, TypeScript API/web and all three Android flavor suites passed. APK235 LOGOFF only. A first highly parallel API run timed out in an existing PDF test; complete four-worker rerun passed. Candidate uses12 API files, two additive tables, Lamoda UI and one WB list filter overlay. Browser13 isolated scenarios passed. Remote shipment creation/stock publication still disabled; live shipment list empty.
