# SOS WB 2: ограничение размера запросов списка заявок

Дата: 08.09.2026. Запрос Константина: исправить Internal Server Error в SOS WB 2.

## Причина и границы

В production `listSosWbRequests` падает с Prisma P2035: 32771 bind parameters при максимуме 32767. Stack указывает на `fbsOrderRequestLink.findMany`. Последующий `clientRequest.findMany` также содержал неограниченный IN-список.

Изменён только `MarketplaceConnectionsService.listSosWbRequests`: последовательные порции по 1000 уникальных requestId в обоих запросах; общий Set допустимых связей и общий порядок number DESC / createdAt DESC. Поля ответа не изменены. При ошибке порции метод отклоняется целиком, не возвращает частичный успех.

Локальная основа dd405f5 отстаёт от production в этом методе: в неё перенесён уже опубликованный фильтр связей ACTIVE, lastCategory active/shipped, с совпадением requestId+connectionId+orderId. Это сохранение серверного поведения, не разрешение отменённых заказов. Правила client scope, activeWarehouseId, requiresKiz, relabelRequired и статусов заданий сохранены.

Не менялись остатки, КИЗы, сборка, назначение заказов, DTO, Android, БД и флаги production. Общий API-файл может использоваться проданной системой: не переносить туда автоматически. Публикация целиком локального service.ts запрещена: на сервере есть дополнительные изменения сортировки и других функций.

## RED → GREEN

- Новый `apps/api/test/sos-wb-requests-query-limit.spec.ts` вызывает реальный метод с моками чтения БД и воспроизводит лимит подготовленного запроса.
- RED до изменения: 6 failed / 5 passed. На 32768 заявках — `too many bind variables in prepared statement`. Часть остальных падений фиксирует отставание локальной версии от опубликованного фильтра связей.
- GREEN: 11 / 11 на том же файле. Проверки 1000, 1001, 32768 ID; все строки и счётчики; отсутствие повторов; пустой список; active/shipped и исключённые связи; совпадение connection/order; client и warehouse scope; закрытые заявки; глобальная сортировка между порциями; отказ БД во второй порции.
- Отдельный RED-коммит не создавался: приоритетное правило Константина — только зелёные тесты перед коммитом.

## Запущенные проверки

Из `apps/api`:

```powershell
node node_modules/vitest/vitest.mjs run test/sos-wb-requests-query-limit.spec.ts --maxWorkers=1 --minWorkers=1
node node_modules/vitest/vitest.mjs run --maxWorkers=1 --minWorkers=1 --reporter=json --outputFile=C:/WMSFF2207/tmp/sos-wb-full-api-20260908.json
```

Полный API: **1323 passed, 0 failed**. Полный web, `node ../api/node_modules/vitest/vitest.mjs run ...` из `apps/web`: **54 passed, 0 failed**, отчёт `C:/WMSFF2207/tmp/sos-wb-full-web-20260908.json`.

Из корня `wms`:

```powershell
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json
git diff --check
```

Все завершились успешно. Web-код не менялся, web build отдельно не запускался; APK не собирался.

Опциональная V8-проверка: `WMS_SOS_COVERAGE_REPORT=C:/WMSFF2207/tmp/sos-wb-method-coverage-20260908.json` при запуске нового spec. **20 из 21 V8-диапазонов изменённого метода и вложенных функций исполнены (95.24%)**. Это не процент покрытия всего API и не стандартный отчёт покрытия строк Istanbul.

## Проверка реальной БД — без публикации

Действующий API image: `sha256:bd201173e86704ca37f82061ee55e87864cd6513ad6c19a2c5fb0a5b2108aa24`.
В отдельном диагностическом процессе выполнены старый опубликованный метод и кандидат. Транзакции: `SET TRANSACTION READ ONLY`, RepeatableRead, statement timeout 20 секунд; запись запрещена самой транзакцией.

1. Scope клиента «ИП Лукин Илья Ильич», Москва: старый метод и кандидат дают 28 заявок, у кандидата 373 доступных заказа.
2. Scope всех клиентов, Москва: **старый метод воспроизвёл P2035 / bind-limit**, кандидат вернул **28 заявок, 373 заказа**.
3. В одной read-only snapshot-транзакции результат кандидата (ID, номер, количество, порядок) точно совпал с независимым SQL через JOIN/EXISTS; ни потерь, ни дублей.

Диагностический скрипт: `C:/WMSFF2207/tmp/sos-wb-readonly-verify-20260908.cjs`. Текущий API не заменялся и не перезапускался. Проверка физического приложения SOS WB 2 пока не проведена.

## Git / публикация

Ветка: `fix/sos-wb-request-query-limit`, создана от `fix/project-navigation-index` (обе исходно на dd405f5). Незакоммиченные карта/индекс остались отдельной работой и не включаются в коммит исправления.
Для узкого PR подходит база `fix/fbs-collected-sku-message` на dd405f5; перед PR сверить актуальную целевую ветку WMSFF2207.
Публикация не выполнена. При согласованной публикации перенести только изменённый метод поверх фактического live-source с проверкой остальных файлов, полным тестированием кандидата и сохранением образа отката.
