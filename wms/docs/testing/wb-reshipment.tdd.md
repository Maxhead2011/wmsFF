# WB: повторная отгрузка / довоз

Дата: 2026-09-10. Ветка: `feature/wb-reshipment-requests`, база `0d39f74`.
Работа только для нашей LOGOFF WMS. Production, WB, остатки и КИЗы в ходе разработки не изменялись.

## Контракт

- В FBS/WB добавлен раздел «Повторная отгрузка / довоз». Проверка — только чтение.
- Источник кандидатов: специальный список WB `/api/v3/supplies/orders/reshipment` и доказанный переход `complete → confirm`, сохранённый обычной синхронизацией. Один статус `confirm` не считается доказательством.
- До записи: выбор 1–100 заказов одного кабинета, способ, предварительная проверка и явное подтверждение.
- `SAME_ITEM`: новая связанная заявка доставки; прежний физический task ID, КИЗ, сотрудник, дата сборки и списание сохранены. Доступна упаковка, не новый отбор.
- `NEW_ITEM`: новая физическая попытка `WAITING_STOCK`; завершённая предыдущая попытка остаётся в истории. При создании нет операций с остатками. Незавершённые физические сканы нельзя молча отбросить.
- Новая поставка получает известное назначение исходной поставки. При неизвестном или смешанном назначении предварительная проверка останавливается до записи WB.
- Проверяются ADMIN/OWNER, не demo, клиент, writable активный филиал, действующий WB кабинет.
- `WMS_FBS_RESHIPMENT_ENABLED=true` включает функцию. По умолчанию выключена, проданная WMS не получает новые операции. `read-only` выключает создание, сохраняет чтение уже записанной истории.

## Анализ влияния / файлы и функции

- `apps/api/src/modules/marketplace-connections/fbs-reshipment.{ts,service.ts,controller.ts}`: eligibility, стабильный цикл попытки, check/preview/create/resume, журнал и lease, finalize.
- `.../dto/fbs-reshipment.dto.ts`: валидация пяти endpoints и подтверждения.
- `.../marketplace-connections.service.ts`: отдельные WB gateway методы; `syncOneFbsRequest` сохраняет переход WB и состав явно выбранной новой заявки.
- `.../fbs-reshipment-transition.ts`: `recordReshipmentTransition`, идемпотентная запись факта перехода до замены последнего снимка.
- `.../marketplace-connections.module.ts`: регистрация новых controller/provider.
- `apps/api/src/common/shipment-history/fbs-attempt-history.ts`: чтение предыдущей физической попытки при новом feature flag. Для SAME_ITEM снимки читаются только по исходным requestId; глобальные выработка/оплата не получают вторую физическую попытку.
- `apps/api/prisma/schema.prisma`, `migrations/20260910144000_fbs_reshipment/migration.sql`: только новые `FbsReshipmentRun`, `FbsReshipmentClaim`, индексы; нет массовых UPDATE остатков/заявок.
- `apps/api/src/modules/administration/administration-internal-api.service.ts`: описание новых маршрутов в существующей группе API.
- `apps/web/src/components/fbs/FbsReshipmentPanel.tsx`, `FbsPanel.tsx`, `apps/web/src/lib/api.ts`: кнопка, выбор, два режима, подтверждение, сохранённые операции, открытие заявки.
- Автотесты `apps/api/test/fbs-reshipment*.spec.ts`, `fbs-reshipment-postgres.cjs`, web component spec и browser fixture/test; регрессионный тест API-каталога.

## Надёжность внешней операции

До первого запроса записи в WB сохраняются журнал, снимки и уникальные claims по `(connectionId, orderId, stable attempt/request cycle)`. POST выполняется не более одного раза после durable `WB_CREATE_STARTED`. Неопределённый результат восстанавливается поиском точного уникального имени поставки; пустой ответ поиска не разрешает второй POST.

Перед повтором PATCH сверяется фактический состав; отправляются только отсутствующие выбранные заказы. Посторонние заказы или закрытая поставка останавливают продолжение. Локальная заявка, состав поставки, ссылки, новая попытка и финал журнала записываются одной Serializable-транзакцией после подтверждения WB. Повторный create с прежним токеном сверяет точный состав. Lease перечитывается после CAS и проверяется/продлевается перед записью; старый владелец не может подтвердить локальный результат.

## TDD evidence

- WB gateway: исходный RED — 13 отсутствующих методов; после реализации 13 PASS.
- Backend helpers: RED отсутствующего модуля → 7 PASS; service/controller suite расширена до 39 PASS.
- Реальные воспроизведения RED → GREEN: устаревший `PLANNED` после получения lease; подмена выбора при повторном preview token; истёкший lease; изменившиеся физические сканы; неизвестное назначение; частичный PATCH; сохранение CREATED при ошибке очистки cache; непосредственная очередь ТСД после NEW_ITEM (`lastCategory`, `lastSkuId`); упаковка SAME_ITEM.
- История и sync: RED — отсутствовал исходный SAME_ITEM history и добавлялся посторонний заказ; GREEN 13 тестов. Проверяется действующий `syncOneFbsRequest`, а не только вспомогательная функция.
- Web: RED отсутствующего компонента → 6 PASS. Реальный Edge/React StrictMode выявил disposed controller после replay effect; исправлен lifecycle. Browser test проверяет выбор, подтверждение, смену режима/области, двойное нажатие, продолжение операции и feature-off.
- Каталог API: существующий тест обнаружил незарегистрированные префиксы; после описания новых endpoints 37 PASS.

## Проверки

- API targeted reshipment: 65 тестов (39 backend + 13 WB + 13 history/sync).
- Web full: 20 файлов, 76 тестов PASS; TypeScript, Vite build PASS. Browser Edge PASS на синтетических ответах.
- API TypeScript `--noEmit` и build PASS. Prisma generate/validate PASS (валидация с фиктивным local test URL, без подключения).
- Полный API suite: **172 файла / 1772 теста PASS**, финальный прогон 18:12:42, длительность 79.94 с. Первые прогоны обнаруживали новые RED-тесты во время работы и недостающий API-каталог; итоговый прогон выполнен после завершения правок.
- `git diff --check` PASS; предупреждения Git LF/CRLF не являются ошибками.
- Процент покрытия не измерялся: `@vitest/coverage-v8` не установлен. Заявления о 80%+ не делаются.
- Физический ТСД и настоящий WB не тестировались; browser/API fixtures не заменяют их.

## Незакрытый PostgreSQL gate

Локально нет PostgreSQL/Docker/test URL. Подготовлен `apps/api/test/fbs-reshipment-postgres.cjs`: точная миграция, откат, реальные конкурирующие UNIQUE claims/fingerprints, lease, FK/mode, sourceRequestIds. Требуется отдельная localhost БД `wms_reshipment_test[_suffix]`, `NODE_ENV=test`, `FBS_RESHIPMENT_TEST_ACK=isolated-test-only` и явный `FBS_RESHIPMENT_TEST_DATABASE_URL`. `DATABASE_URL` намеренно не используется.

Запущены только `node --check`, `--self-test` и отрицательный запуск без разрешённого окружения. Это проверка защитных ограничений, НЕ выполнение PostgreSQL миграции/конкуренции. Перед публикацией необходимо выполнить настоящий тест и записать результат. Не подставлять production URL.

## Публикация / откат

Коммит, push, PR и публикация в этом этапе не выполнены. Предлагаемая база PR — фактическая release-ветка нашей WMS `fix/sorting-recorded-source-20260908`; перед PR подтвердить её актуальность. Не пушить напрямую в release/main/feature/our-vm и не затрагивать sold-vm.

После тестового PostgreSQL gate: согласование Gate2; PR; backup и миграция только нашей WMS; сначала feature-off, smoke-test, затем явное включение. Проверить один согласованный заказ в каждом режиме без необратимого массового переноса.

При проблемах установить `WMS_FBS_RESHIPMENT_ENABLED=read-only`, сохранить совместимый reader истории. Не удалять новые таблицы, claims, снимки или WB поставки: они нужны для сверки неопределённых операций. Откат к старому коду может скрыть SAME_ITEM provenance и старую выработку; предпочтительно отключение записи новым флагом, а не потеря reader. Удаление таблиц допустимо только в изолированном пустом тестовом окружении.
