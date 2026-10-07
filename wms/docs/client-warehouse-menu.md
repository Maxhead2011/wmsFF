# Клиентский раздел «Склад»

Клиенту доступны ровно четыре пункта: Онлайн-приёмка, Приход товара, Приёмки,
Отгруженные КИЗ. Клиентское чтение использует существующие ограничения по клиентам.
Подтверждение сверки приёмок PR494 сохранено. Онлайн-приёмка сохраняет настройку
onlineReceiptVisibleToClient; на данных Лукина доступ подтверждён.

В приходах скрыты запись, удаление и формирование счёта; история КИЗ не запускает
служебную синхронизацию. Серверные права warehouse:write/billing:write не выдаются
клиенту и остаются на изменяющих маршрутах. Чтение истории допускает CLIENT со
stock:read только при WMS_CLIENT_WAREHOUSE_ENABLED=true. Web opt-in:
VITE_CLIENT_WAREHOUSE_ENABLED=true. Флаги включаются только на нашей ВМС.
Общие файлы затронуты; проданная ВМС не обновляется, старый доступ сохраняется без флага.

Исходники: workspaces.canOpenWorkspace, WarehouseOpsPanel/TopicPicker,
GoodsArrivalPanel, ShipmentHistoryPanel, WarehouseController.shipmentHistoryList.
SourceParityVerified=false: один API-модуль точечным delta, пять web-функций
в текущем графе. Сохранены уведомления о коробах, меню сотрудников, APK218,
приложение учёта времени, прежние флаги и согласование приёмок.

Проверки: два первоначально красных web-теста воспроизводят скрытое меню/опасные
кнопки. После исправления API3120 passed/141 skipped, web394 passed/2 skipped,
TypeScript; actual runtime2; browser открывает все четыре экрана, проверяет
ровно четыре плитки и отсутствие POST/мутаций. PostgreSQL READ ONLY: реальные
данные Лукина в четырёх разделах и запрет чужого clientId. KIZ DB integration
исключена без отдельной тестовой базы. Никакие бизнес-данные не меняются.

Выпуск через PR в feature/wb-print-check; guard проверяет только изменённый
warehouse.controller.js. Откат образов: logoff-api:before-client-warehouse-20261007,
logoff-web:before-client-warehouse-20261007. Предыдущее согласование приёмок сохраняется.
