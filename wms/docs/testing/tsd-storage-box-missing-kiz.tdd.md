# ТСД: новый КИЗ при перемещении из короба в бокс

## Причина и границы

Константин сообщил повторный отказ «КИЗ не найден у клиента» при перемещении
в бокс. Причина подтверждена чтением рабочего stock-operations.service.ts:
BOX_TO_STORAGE_BOX отклонял любой КИЗ без точной записи ProductMark.
Исправление предыдущего выпуска касалось другой операции — FBS WB.

Ветка: `fix/tsd-storage-box-missing-kiz`, создана от текущего `e17d6ef`.
Предлагаемая база PR: `fix/fbs-box-scan-route-consistency`, только WMSFF2207.
FFULHAB/проданная ВМС не публикуется. До её обновления требуется отдельная проверка:
StockOperationsService является общим модулем, но новая ветка разрешения включается
только из BOX_TO_STORAGE_BOX. Вызов общего resolver из legacy по умолчанию остаётся строгим.

Файлы и функции:

- `apps/api/src/modules/stock/stock-operations.service.ts`: внутренний флаг
  registerMissingMark, inspectTsdTransferItem (текст), executeTsdTransfer,
  resolveStorageBoxTransferItem/Mark, новый resolveUnregisteredStorageBoxTransferMark,
  локальный storageBoxTransferKizIdentity. Риск высокий: маркировка и остатки.
- `apps/api/test/tsd-storage-box-transfer.spec.ts`: stateful fixture и тесты. Риск низкий.
- Этот документ: проверяемые гарантии и ограничения. Риск низкий.

## Пользовательский сценарий // FIX

Исходный короб → ШК нужного товара → КИЗ → бокс назначения.
Новый КИЗ допускается после проверки структуры, клиента, доступного немаркированного
остатка и истории. На этапе проверки нет записей. На завершении в существующей
Serializable-транзакции выполняется перенос ровно одной единицы, создание ProductMark
с назначением и inbound StockMovement, запись аудита TSD_STORAGE_BOX_KIZ_REGISTERED.
Общий остаток не увеличивается, отдельной повторной приёмки нет.
Сбой регистрации или аудита откатывает и количества. Повтор того же operation key
возвращает ALREADY_APPLIED; другой key не позволяет забрать тот же КИЗ снова.

Нельзя создавать новый КИЗ вместо чужого, уже отгруженного/заказанного, защищённого
печатью этикетки либо вместо другой маркированной единицы полного короба.
Известные альтернативные представления проверяются по GTIN/серийному номеру;
сходство SQL LIKE или префикса не доказывает совпадение единицы.
Raw КИЗ новой записи сохраняется без переписывания криптохвоста/разделителей.

## Доказательства // TEST

Тесты через реальный StockOperationsService и stateful Prisma fixture с откатом.
Команда из apps/api (direct runner сохраняет существующие junction dependencies):

```text
node node_modules/vitest/vitest.mjs run test/tsd-storage-box-transfer.spec.ts --maxWorkers=1 --minWorkers=1
```

- Первоначально расширенный fixture ошибочно воспринимал String.startsWith как
  Prisma StringFilter; прогон 33 failures НЕ считается RED бизнес-логики.
- После исправления fixture, до изменения production-кода: 74 теста,
  **5 FAILED / 69 PASSED**. Воспроизведён именно отказ «КИЗ не найден у клиента».
- Первое исправление: 74/74; дополнительные scanner/identity проверки: 82/82.
- Self-review обнаружил обход проверки истории для AVAILABLE crypto-варианта
  того же короба: отдельный новый тест **1 FAILED / 82 PASSED**.
- История теперь проверяется до повторного использования известной записи:
  **83/83** в соответствующем targeted GREEN.
- Финальный полный API-прогон на окончательном коде: **847/847**, 0 failed/pending;
  в том числе **83/83** теста файла перемещений. Предварительный full run 846/846
  не заменяет финальный: он был запущен до последнего защитного теста.
- Полный web: **34/34**. API/web lint (tsc --noEmit), API tsc build и web vite build
  завершились с exit 0. Существующие web asset/chunk warnings остались без изменений.
- git diff --check: PASS. В добавленных строках нет credential-like строковых
  литералов или console logging; это узкая проверка diff, не полный security audit.

Полные команды (из соответствующего apps/api или apps/web):

```text
node node_modules/vitest/vitest.mjs run --maxWorkers=1 --minWorkers=1 --reporter=json --outputFile=<report.json>
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node ../../node_modules/typescript/bin/tsc -p tsconfig.json
node node_modules/vite/bin/vite.js build
```

Финальные свидетельства: `storage-box-missing-kiz-final-api.json`,
`storage-box-missing-kiz-web-tests.json`, `storage-box-missing-kiz-api-final-lint.log`,
`storage-box-missing-kiz-api-final-build.log`, `storage-box-missing-kiz-web-lint.log`,
`storage-box-missing-kiz-web-build.log`. Сборка tsc относится к API, Vite — к web.

Изменены два прежних ожидания согласно запросу: неизвестный структурно корректный
КИЗ больше не является ошибкой сам по себе, а проверка не должна создавать его
до завершения перемещения. Отказы при неправильном ШК/типе кода сохранены.

| Гарантия | Покрытие |
| --- | --- |
| Новый КИЗ после ШК; проверка без записи | inspection + complete movement |
| Одна единица out/in; исходный другой КИЗ не трогается | stateful quantities/marks assertions |
| Повтор не дублирует КИЗ и движение | same/different operation keys |
| Чужой клиент, заполненная маркировка, активное задание | protected-case matrix |
| История заказа, отгрузки, печати | three protected models + between-scans check |
| Префикс сканера, GS, текст GS, AI, crypto-варианты | scanner representation cases |
| Похожий серийный номер/SQL wildcard не подменяет единицу | identity safety cases |
| Ошибка назначения, создания КИЗ, аудита | transaction rollback cases |
| Исходный короб опустел после проверки | revalidation case |
| Существующие legacy/batch/rebind правила | прежние тесты файла |

## Ограничения и публикация

Тестовый coverage provider не установлен (нет @vitest/coverage-v8/istanbul).
Процент покрытия не заявляется; зависимости ради фикса не добавлялись.
Физический ТСД, реальные конкурентные PostgreSQL-транзакции и рабочая БД не
использовались для тестовых записей. Перед выпуском проверить точный серверный
образ и время глобальных проверок истории; нельзя строить из устаревшего checkout.
На сервере есть отличия в том же stock-модуле, их требуется сохранить.

Нет миграций, APK, смены applicationId, изменения алгоритмов FBS или ручного
исправления остатков. При этой доработке рабочий сервер пока не изменялся.
RED-коммит не создавался: правило пользователя требует зелёного полного набора
перед каждым коммитом. Evidence JSON/logs: C:/WMSFF2207/reports/wms-audit-20260905,
префикс `storage-box-missing-kiz-`.

## Согласованная публикация и совместимость с новым архивом FBS

Константин разрешил публикацию. Read-only сверка обнаружила обновлённый runtime
и уже существующий FbsAssemblyAttemptHistory, поэтому добавлена проверка архивного
КИЗ в том же узком resolver. Новые повторы могут быть выключены, но старые записи
архива продолжают защищать КИЗ. Если установлен клиент Prisma с архивной моделью,
архив проверяется независимо от feature flag. При отсутствии модели и включённых
повторах операция блокируется. Ошибка чтения существующей истории не игнорируется.
На старых установках без этой модели и функции новый запрос не добавляется.

- Новый RED: 4 FAILED / 84 PASSED — без проверки архива разрешалась регистрация
  ранее использованного КИЗ, также не блокировалась недоступность включённой истории.
- Дополнительный RED выключенного feature flag: 1 FAILED / 88 PASSED.
- Итоговый полный локальный API-прогон: **853/853**, включая **89/89** тестов
  перемещения; API lint/typecheck/build прошли повторно. Web не менялся:
  предыдущие финальные 34/34, lint/build применимы к неизменённому web-коду.
- Артефакты этого этапа: `publish-storage-box-kiz/final-api.json`,
  `archive-red.json`, `archive-disabled-red.json`, `final-lint.log`, `final-build.log`
  в C:/WMSFF2207/reports/wms-audit-20260905.
- Проверка production БД выполнена без записей, со statement_timeout 5s:
  архив существует; синтетические запросы prefix-history 0.101–37.415 мс.
- Новый API image строится FROM текущего runtime; в серверном stock-модуле
  смешанные LF/CRLF. Для применения точных hunks использован ignore-space-change
  только к контексту. Семантические конфликты не разрешались автоматически.

Текущий серверный образ при подготовке:
`c1b7d4b465fb84fc1e545bc9a3e84af28da85dcb93e4575125fc075a68555714`.
Другие изменения в Git после исходной базы относятся к отдельным выпускам,
не являются частью этого патча и не должны перезаписываться.
