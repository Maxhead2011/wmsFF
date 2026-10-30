# Автоматическое завершение упакованных заявок ФБС Ozon

Подготовлено от PR801, ветка `fix/ozon-packed-auto-done`.

Штатная синхронизация переводит OUTBOUND/PACKED в DONE, если все действующие
отправления Ozon имеют статус `delivering` либо `delivered`. Ожидание отгрузки
`awaiting_deliver`, ожидание упаковки, отмена, арбитраж, неизвестный статус и
неполный ответ не подтверждают сдачу. Для составной заявки проверяется каждое
отправление; частичная передача недостаточна.

Нормализованные поля supplierStatus и wbStatus для Ozon содержат один исходный
статус API; несовпадение блокирует переход. Заказы WB не обрабатываются этим правилом.
Перенос, повторная сборка, переотгрузка, аварийный поиск и демо-клиенты исключены.

Изменяются только статус и история. StockMovement, StockBalance, задания ТСД,
состав, упаковки и КИЗ не изменяются. Это событие не подтверждает историческое
списание и не создаёт новое. Lock заявки, условное обновление и событие в одной
транзакции защищают от гонок и повторного закрытия.

Флаг `WMS_OZON_PACKED_AUTO_DONE_ENABLED` предназначен только для нашей WMS.
Правило WB и его флаг сохраняются. Без нового флага проданная WMS работает
по-прежнему; её контейнеры не публикуются.

Код: `marketplace-connections.service.ts::syncOneFbsRequest`,
`ozon-packed-auto-done.ts::closeOzonPackedRequest`.
Тесты: `ozon-packed-auto-done.spec.ts` и прежние тесты WB.
Runtime: `scripts/releases/ozon-packed-auto-done-20261030/` — точечная вставка
в текущий сервис и один новый модуль; полная локальная сборка не публикуется.
`runtime.test.cjs` воспроизводит проблему на старой версии и проверяет исправление.
`postgres.cjs` проверяет конкурентные транзакции, откат при ошибке истории,
идемпотентность, неизменность остатков и изоляцию флага на отдельной тестовой БД.

Validation: API4194 passed /156 skipped, web579 passed /2 skipped, TypeScript, runtime RED/GREEN, PostgreSQL8/full isolated API health. Dedicated KIZ integration suite excluded without its isolated DB URL. Exact two-module candidate validated against PR801 baseline; WB helper unchanged.
