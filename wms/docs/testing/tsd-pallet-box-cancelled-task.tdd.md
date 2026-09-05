# ТСД: создание бокса на паллет-сорте и отменённое задание на другой КИЗ

Дата: 2026-09-05. Проект: WMSFF2207. Ветка: `fix/tsd-pallet-box-and-cancelled-task`.
Предлагаемая цель PR: `fix/fbs-box-scan-route-consistency` (ветка выпуска нашей WMS).
На production в рамках этой задачи выполнена только диагностика, изменений данных и публикации нет.

## Требования и границы

Требования получены из сообщения пользователя и уточнения: отсутствующий **бокс хранения**
создать и привязать к выбранному паллет-сорту, существующий — привязать. Никакого
автоматического прихода товара. Для обычных коробов сохранить пересчёт содержимого.

В диагностике перемещения из FFL_LKB1107_411 обнаружено задание RETURN_REQUIRED
по заказу WB 5545446176 на другой КИЗ. Live WB вернул complete/canceled_by_client.
У двух проверенных отсканированных КИЗов отсутствовали ProductMark, сборка, отгрузка,
печать и архив повторной сборки. Блокировала связь задания с коробом/SKU, не история самих КИЗов.

## Изменения и риски

| Файл | Функции / назначение | Риск и ограничение |
|---|---|---|
| `apps/api/src/modules/warehouse/storage-locations.service.ts` | `scanTsdPalletBox`, `placeBox` | Создание Box + размещение в Serializable-транзакции, без StockBalance/StockMovement; существующие проверки клиента, филиала, архива сохранены |
| `apps/api/src/modules/stock/cancelled-box-task-transfer.ts` | `prepareCancelledBoxTaskTransfer`, `validateCancelledBoxTaskTransfer`, внутренний `context` | Только новый КИЗ и RETURN_REQUIRED на иной распознаваемый КИЗ. До 10 заданий одного WB-кабинета, один запрос 4 с, подтверждение всех отмен, срок доказательства 15 с и повторная проверка в транзакции |
| `apps/api/src/modules/stock/stock-operations.service.ts` | Подготовка проверки, разрешение КИЗа и аудит в `executeTsdTransfer` | Исключаются только проверенные IDs старых заданий. Собственные сборка/печать/отгрузка/архив КИЗа остаются блокирующими. Перемещение −1/+1; старые задания не редактируются |
| `apps/api/test/storage-locations.service.spec.ts` | Регрессионные тесты боксов | Новый бокс, повтор, основной/дополнительный префикс, гонка с созданием чужого/архивного бокса |
| `apps/api/test/tsd-storage-box-transfer.spec.ts` | Регрессионные тесты отменённых заданий | Успех, идемпотентность, сбои WB, истечение проверки, гонки, активная сборка, собственная история КИЗа и rollback |

Код помечен `// FIX`, тесты — `// TEST`.
Изменения не переносятся в sold/FFULHAB; по умолчанию оба новых флага выключены:

```text
WMS_TSD_PALLET_CREATE_STORAGE_BOX_ENABLED=true
WMS_TSD_CANCELLED_BOX_TASK_TRANSFER_ENABLED=true
```

Это настройки будущей публикации только в нашей WMS, не значения по умолчанию.
Существующий `WMS_TSD_CANCELLED_WB_TRANSFER_ENABLED` и его проверки SHIPPING/RESERVED
КИЗов сохранены. APK, web, схемы БД и миграции не изменены.

## TDD: фактические результаты

1. До изменения production-кода добавлены воспроизводящие тесты.
   `node node_modules/vitest/vitest.mjs run test/storage-locations.service.spec.ts test/tsd-storage-box-transfer.spec.ts --maxWorkers=1 --minWorkers=1`
   RED: **3 failed / 128 passed**. Ошибки: SCAN_BOX_CONTENTS вместо создания, отказ
   основному storage-префиксу, блокировка новым КИЗом старого отменённого задания.
2. После минимального исправления тот же набор + `test/cancelled-wb-transfer.spec.ts`:
   GREEN: **159/159**. Дополнены отрицательные сценарии защиты.
3. Полный API-прогон:
   `node node_modules/vitest/vitest.mjs run --maxWorkers=1 --minWorkers=1 --reporter=json --outputFile=C:/WMSFF2207/tmp/pallet-cancelled-task-full.json`
   **923/923**, 0 падений, success=true.
4. Полный web-прогон: **34/34**.
5. Линтер API и web: `node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` — успешно.
6. Сборка API: `node ../../node_modules/typescript/bin/tsc -p tsconfig.json` — успешно.
7. Сборка web: TypeScript + `node node_modules/vite/bin/vite.js build` — успешно.
   Vite предупреждает о Jura fonts/warehouse-hero, разрешаемых во время исполнения, и большом bundle. Эти файлы не менялись.
8. `git diff --check` — успешно. Проверка diff: нет ключей/паролей, логирования ответов WB или новых WB-операций записи.

Отчёт coverage не запускался: провайдер coverage отсутствует в установленном окружении.
Реальная многопоточная PostgreSQL-гонка и проверка на физическом ТСД после публикации
не выполнялись; unit/service-тесты проверяют гонки через изменение снимков и rollback модели.
RED-коммит не создавался: правило пользователя требует зелёных тестов перед коммитом.
RED/GREEN доказательства сохранены здесь и в локальных логах `C:/WMSFF2207/tmp/pallet-cancelled-task-*`.

## Публикация

Публиковать только после разрешения пользователя через PR. Для текущего production,
где исходный checkout отличается от установленного образа, использовать проверяемый overlay
трёх изменённых модулей поверх текущего API image, а не весь checkout. Сохранить предыдущий
image и конфигурацию для отката. Включить только два новых флага; не менять прочие настройки.
После выпуска проверить health, неизменность web/БД и выполнить операторский сценарий
нового/существующего бокса и перемещения нового КИЗа при отменённом старом задании.
