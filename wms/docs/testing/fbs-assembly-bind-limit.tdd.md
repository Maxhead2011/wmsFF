# TDD: сборка FBS при большой истории заказов

## Источник требований и production-доказательство

Пользователь сообщил, что кнопка сборки заказов FBS возвращает `Internal server error`.

Журнал API `wms.logoff.pro` за 29.08.2026 показал точный стек:

- `MarketplaceConnectionsService.assembleFbsOrders` → `resolveSelectedFbsOrders` → `loadFbsOrdersUncached`;
- `prisma.fbsOrderRequestLink.findMany()` получил `32 772` bind-параметра;
- PostgreSQL допускает не более `32 767`, поэтому Prisma выбросила необработанный `PrismaClientKnownRequestError`.

## Пользовательский сценарий

Оператор выбирает заказы в разделе FBS и запускает сборку. Полная история WB может содержать более 32 тысяч заказов, но чтение их связей с заявками WMS должно выполняться без HTTP 500 и без потери связей.

## RED / GREEN

| Этап | Команда | Результат |
|---|---|---|
| RED | `vitest run test/marketplace-connections.service.spec.ts -t "loads FBS request links in bounded batches"` | FAIL: `loadActiveFbsOrderRequestLinks is not a function`; production-запрос оставался единым и превышал лимит |
| GREEN | та же команда после исправления | PASS: 1/1; все `32 768` связей возвращены семью запросами не более 5 000 order ID каждый |
| Линтер | `tsc -p tsconfig.json --noEmit` из `apps/api` | PASS |
| Сборка | `tsc -p tsconfig.json` из `apps/api` | PASS |
| Полный spec сервиса | `vitest run test/marketplace-connections.service.spec.ts` | 94 PASS / 27 прежних FAIL; новый сценарий PASS |
| Полный API suite | `vitest run` | 491 PASS / 74 прежних FAIL; 75 файлов PASS / 23 FAIL |

## Гарантии теста

1. История из `32 768` заказов больше не формирует один SQL-запрос выше лимита PostgreSQL.
2. Размер каждого списка `orderId` не превышает `5 000`.
3. После пакетной загрузки не теряется ни одна связь заказа с заявкой WMS.
4. Запросы разделяются по подключению маркетплейса, поэтому связи разных кабинетов не смешиваются.

## Известные ограничения проверки

Полный API suite production-базы уже содержит старые падения тестовых моков филиалов и новых зависимостей сервисов. Они не затрагивают изменённый загрузчик и не исправлялись, чтобы не расширять область хирургического изменения.

Coverage-команда не запускалась: пакет `@vitest/coverage-v8` в workspace отсутствует, новые зависимости без отдельного согласования не устанавливались.
