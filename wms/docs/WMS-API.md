# LOGOFF WMS API v1

Актуальная интерактивная документация всех контроллеров WMS доступна на:

- Swagger UI: `https://wms.logoff.pro/api/docs`
- OpenAPI JSON: `https://wms.logoff.pro/api/docs/openapi.json`

Этот документ полностью описывает публичный контур `Integration API v1`, предназначенный для 1С, МойСклад и других внешних систем учёта. Внутренние методы web и ТСД также отражены в Swagger, но не должны вызываться внешней системой.

## Базовый адрес и авторизация

Базовый адрес:

```text
https://wms.logoff.pro/api/v1/integration/v1
```

Передавайте ключ в каждом запросе:

```http
X-WMS-API-Key: wms_live_************_**************************************
```

Допустим альтернативный заголовок `Authorization: ApiKey <ключ>`. Пользовательские Bearer-токены WMS во внешнюю систему передавать нельзя.

Ключ жёстко закреплён за одним клиентом и одним складом. Параметрами запроса переключить клиента или склад невозможно. Секрет показывается только при выпуске или ротации; в базе WMS хранится только SHA-256-хеш.

## Права ключа

| Scope | Возможность |
|---|---|
| `catalog:read` | Читать товары и штрихкоды клиента |
| `stock:read` | Читать остатки закреплённого склада |
| `stock:write` | Устанавливать фактический остаток `AVAILABLE` в коробе |
| `requests:read` | Читать заявки закреплённого склада |
| `movements:read` | Читать складской ledger |

Если scope отсутствует, API возвращает `403` и поле `requiredScope`.

## Проверка подключения

### `GET /profile`

Проверяет ключ и возвращает его безопасный профиль, клиента и склад.

```bash
curl "https://wms.logoff.pro/api/v1/integration/v1/profile" \
  -H "X-WMS-API-Key: $WMS_API_KEY"
```

```json
{
  "data": {
    "id": "uuid",
    "name": "1C Ногинск",
    "keyPrefix": "a1b2c3d4e5f6",
    "scopes": ["catalog:read", "stock:read"],
    "expiresAt": null,
    "client": { "id": "uuid", "code": "CLIENT", "name": "Клиент" },
    "warehouse": { "id": "uuid", "code": "NOGINSK", "name": "Ногинск", "city": "Ногинск" }
  }
}
```

## Справочник товаров

### `GET /catalog`

Scope: `catalog:read`.

Параметры: `limit` (1–500, по умолчанию 200), `afterId`, `updatedSince` (ISO 8601).

Ответ содержит SKU, артикул, наименование, габариты, признаки маркировки и все штрихкоды. Для следующей страницы передайте `meta.nextAfterId` как `afterId`. Когда `nextAfterId` равен `null`, страница последняя.

```bash
curl "https://wms.logoff.pro/api/v1/integration/v1/catalog?limit=200&updatedSince=2026-08-01T00:00:00Z" \
  -H "X-WMS-API-Key: $WMS_API_KEY"
```

## Остатки

### `GET /stocks`

Scope: `stock:read`.

Параметры: `limit` (1–500), `afterId`, `updatedSince`, `status`, `barcode`.

Возвращается только закреплённый склад. Каждая строка содержит SKU, короб, паллету, статус, количество и время обновления.

```bash
curl "https://wms.logoff.pro/api/v1/integration/v1/stocks?status=AVAILABLE&barcode=04680992593139" \
  -H "X-WMS-API-Key: $WMS_API_KEY"
```

### `POST /stock-adjustments`

Scope: `stock:write`.

Устанавливает фактически посчитанное количество `AVAILABLE` в конкретном коробе. Метод не правит таблицу остатков напрямую: WMS создаёт стандартное движение `INVENTORY_ADJUSTMENT`, записывает аудит и уведомляет сотрудников, что остаток изменён клиентом.

```bash
curl -X POST "https://wms.logoff.pro/api/v1/integration/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -H "X-WMS-API-Key: $WMS_API_KEY" \
  -d '{
    "barcode": "4680992593139",
    "boxCode": "FFL_LKB2507_44",
    "countedQuantity": 12,
    "idempotencyKey": "1c-stock-20260819-000042",
    "comment": "Пересчёт во внешней системе"
  }'
```

Вместо `barcode` можно передать `skuId`. `idempotencyKey` обязателен и должен быть уникальным для логической операции. Повтор с тем же ключом не создаёт вторую корректировку и возвращает `ALREADY_APPLIED`.

Внешний API намеренно не позволяет менять `RESERVED`, `PACKING`, `SHIPPING`, `BLOCKED` и другие служебные статусы.

Пример результата:

```json
{
  "data": {
    "idempotencyKey": "CLIENT_API:a1b2c3d4e5f6:1c-stock-20260819-000042",
    "status": "APPLIED",
    "skuId": "uuid",
    "box": "FFL_LKB2507_44",
    "previousQuantity": 10,
    "countedQuantity": 12,
    "delta": 2
  }
}
```

## Заявки

### `GET /requests`

Scope: `requests:read`.

Параметры: `limit` (1–500, по умолчанию 200), `afterId`, `updatedSince`, `status`.

Возвращает заголовок заявки, тип, статус, приоритет, желаемую дату и строки товаров. В выборку попадают только заявки закреплённого клиента и склада.

## Движения

### `GET /movements`

Scope: `movements:read`.

Параметры: `limit`, `afterId`, `updatedSince`. Для ledger `updatedSince` применяется к `createdAt`, потому что проведённые движения не редактируются.

Возвращает тип движения, статус остатка, дельту количества, SKU, короб, `sourceDocument`, `idempotencyKey`, комментарий и время проведения.

## Формат списков

```json
{
  "data": [],
  "meta": {
    "count": 0,
    "limit": 200,
    "nextAfterId": null,
    "generatedAt": "2026-08-19T12:00:00.000Z"
  }
}
```

## Ошибки

| HTTP | Значение | Что делать |
|---|---|---|
| `400` | Неверное тело или параметр | Исправить поля по `message` |
| `401` | Ключ отсутствует, неверен, истёк, отозван или IP запрещён | Проверить заголовок, срок и белый список IP |
| `403` | У ключа нет scope либо запрещён служебный статус | Добавить минимально необходимый scope или изменить операцию |
| `404` | SKU, короб или сущность не найдены в закреплённом контуре | Проверить идентификаторы и филиал ключа |
| `409` | Конфликт складского состояния | Обновить данные и повторить с новым `idempotencyKey` только после решения конфликта |

Ошибки Nest API имеют форму:

```json
{
  "statusCode": 403,
  "message": "API-ключу не выдано требуемое право.",
  "requiredScope": "stock:write"
}
```

## Выпуск и обслуживание ключей

В WMS откройте плитку **API WMS**. Она доступна только роли `WMS_API_MANAGER` или системному администратору.

1. Выберите клиента и склад.
2. Выдайте только необходимые scopes.
3. При необходимости укажите точные IP-адреса и срок действия.
4. Нажмите **Сгенерировать ключ** и сразу сохраните секрет во внешней системе.
5. Для плановой смены нажмите **Заменить ключ**. Старый ключ отключается немедленно.
6. При компрометации нажмите **Отозвать**.

Не отправляйте ключ в мессенджеры, тикеты и Git. Для разных внешних систем выпускайте разные ключи — это позволяет отозвать одно подключение без остановки остальных.

## Управление ключами программно из WMS

Эти методы предназначены для авторизованного web-интерфейса WMS и используют пользовательский Bearer-токен с правом `integration-api:manage`:

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/api/v1/integration-access/scopes` | Справочник scopes |
| `GET` | `/api/v1/integration-access/options` | Доступные клиенты и склады |
| `GET` | `/api/v1/integration-access/credentials` | Ключи без секретов и хешей |
| `POST` | `/api/v1/integration-access/credentials` | Выпуск; секрет возвращается один раз |
| `POST` | `/api/v1/integration-access/credentials/{id}/rotate` | Ротация; секрет возвращается один раз |
| `POST` | `/api/v1/integration-access/credentials/{id}/revoke` | Немедленный отзыв |

Полные схемы тел и ответов находятся в Swagger/OpenAPI.
