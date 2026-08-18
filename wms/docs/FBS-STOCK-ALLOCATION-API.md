# API распределения остатков FBS

Внешняя учетная система работает с `https://wms.logoff.pro/api/v1/external/v1/fbs` и передает выданный в WMS ключ в заголовке:

```http
X-WMS-API-Key: wms_fbs_...
Content-Type: application/json
```

Ключ закреплен за одним клиентом. `clientId` намеренно отсутствует во внешних запросах: изменить остатки другого клиента этим ключом нельзя. Открытый ключ показывается в WMS только один раз, в базе хранится только SHA-256 хеш.

## Получить настройку

```http
GET /api/v1/external/v1/fbs/stock-allocation?connectionId=<WB_CONNECTION_ID>
```

Ответ содержит рабочие склады из маршрутизации FBS, сохраненные проценты, рекомендуемые проценты, состояние синхронизации и непросмотренные изменения клиента.

## Изменить распределение

```http
PUT /api/v1/external/v1/fbs/stock-allocation
```

```json
{
  "connectionId": "<WB_CONNECTION_ID>",
  "enabled": true,
  "lowStockThreshold": 10,
  "externalReference": "accounting-policy-2026-08-18-001",
  "shares": [
    { "warehouseId": "507", "warehouseName": "Москва", "percent": 70, "isPrimary": true },
    { "warehouseId": "1206", "warehouseName": "Рабочий склад 2", "percent": 30, "isPrimary": false }
  ]
}
```

Сумма `percent` должна быть ровно `100`, основной склад — ровно один. Если доступный для продажи остаток не превышает `lowStockThreshold`, WMS публикует весь остаток только на основном складе.

## Изменить публикуемый остаток товаров

```http
PUT /api/v1/external/v1/fbs/stocks
```

```json
{
  "connectionId": "<WB_CONNECTION_ID>",
  "externalReference": "accounting-stock-2026-08-18-991",
  "items": [
    { "barcode": "4600000000001", "requestedAmount": 25 },
    { "article": "CLIENT-ARTICLE-2", "requestedAmount": 8 },
    { "skuId": "<WMS_SKU_ID>", "requestedAmount": 0 }
  ]
}
```

Для каждой строки указывается ровно один идентификатор: `skuId`, `barcode` или `article`. `requestedAmount` — верхний предел публикации, а не изменение физического `StockBalance`. Итоговая сумма по складам всегда ограничена фактически доступным остатком WMS.

`externalReference` рекомендуется делать уникальным идентификатором операции учетной системы. Повторный запрос с тем же ключом и `externalReference` возвращается как `duplicate: true` и повторно не отправляет остатки в Wildberries.

Каждое принятое внешнее изменение сохраняется в журнале WMS и отображается сотрудникам как «Остатки изменены клиентом» до подтверждения просмотра.

## Ошибки

- `400` — неверные проценты, неоднозначный товар или склад отсутствует в маршрутизации FBS.
- `401` — ключ отсутствует, неверен или отозван.
- `404` — подключение WB или товар не принадлежит клиенту ключа.
- `409` — распределение еще не включено либо артикул найден более чем у одного товара.

Интерактивная схема доступна после публикации версии в Swagger WMS: `https://wms.logoff.pro/api/docs`.
