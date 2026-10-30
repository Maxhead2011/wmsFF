# Автоматическое завершение упакованных заявок ФБС WB

Подготовлено, не опубликовано. Ветка `fix/wb-packed-auto-done`, база PR798.

При штатной синхронизации заявка OUTBOUND в статусе PACKED переходит в DONE,
если все действующие связанные заказы WB имеют supplierStatus `complete` и
wbStatus `sorted`, `ready_for_pickup` либо `sold`. Это сдача WB, а не ожидание
получения покупателем. В истории записываются номера заказов и статусы WB.

Изменяются только статус заявки и история. Новые складские движения не создаются,
исторические списания не подтверждаются этим событием. Задания ТСД, возвраты,
короба, КИЗ и состав заявки не изменяются.

Отмена, дефект, неизвестный статус, неполный ответ, смешанные маркетплейсы,
перенос заказа, повторная сборка, переотгрузка и аварийный поиск блокируют переход.
Демонстрационные клиенты исключены. Lock заявки и условное обновление предотвращают
гонку и повторное событие; запись события входит в ту же транзакцию.

Флаг `WMS_WB_PACKED_AUTO_DONE_ENABLED=true` предназначен только для нашей WMS.
Без флага поведение прежнее. Проданная WMS не публикуется и не меняет поведение.

Код: `marketplace-connections.service.ts::syncOneFbsRequest` вызывает
`wb-packed-auto-done.ts::closeWbPackedRequest` до физической сверки.
Тесты: `wb-packed-auto-done.spec.ts`, включая реальную точку вызова синхронизации.

Кандидат: `scripts/releases/wb-packed-auto-done-20261030/prepare.cjs` добавляет
только новый модуль и две вставки в текущий runtime синхронизации. Полная замена
сервиса исходной сборкой запрещена: source/runtime parity остаётся false.
`runtime.test.cjs` воспроизводит отсутствие перехода на прежнем runtime и проверяет
переход/идемпотентность на кандидате. Перед активацией требуется PR и публикация
с отдельным флагом только нашей WMS; флаг сейчас не включён.

Проверка ФБО Ozon 30.10.2026, 21:33 МСК: заявки 2528–2533 имеют
`ACCEPTED_AT_SUPPLY_WAREHOUSE`. По правилу Катерины приём на точке отгрузки
означает сдачу; проверка выполнена без изменения данных Ozon и складских остатков.

Validation: API 4175 passed / 156 skipped; web 579 passed / 2 skipped. Dedicated `kiz-duplicate.integration.spec.ts` excluded because its isolated database URL is not configured (initial full run failed at suite construction). TypeScript passed; candidate runtime RED/GREEN and idempotency passed; baseline verification/check-candidate passed with exactly two API modules changed.
