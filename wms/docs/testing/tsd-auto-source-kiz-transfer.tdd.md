# Перемещение в бокс по ШК и КИЗ без сканирования источника

Задача Константина, 05–06.09.2026. Новый дополнительный сценарий: ШК → КИЗ → бокс хранения.
Ветка: `fix/tsd-auto-source-kiz-transfer-20260905`, от текущей рабочей ветки `fix/web-assembly-order-search-20260905` (`2caf4fc`).
Предлагаемая база PR в текущем publish-репозитории: `fix/fbs-box-scan-route-consistency`.
Production, данные, установленные приложения и метаданные автообновления не менялись.

## Точки касания

| Файл / функция | Изменение и риск |
| --- | --- |
| `apps/api/src/modules/stock/stock-operations.service.ts`: `inspectTsdTransferItem`, `executeTsdTransfer`, новый `resolveAutoSourceStorageTransfer` | Высокий риск: остатки. Новый явный режим `KIZ_TO_STORAGE_BOX`, старый движок `applyTransferBetweenBoxes`, сериализуемая транзакция и условное обновление КИЗ. Старые режимы не переводятся на новую проверку. |
| `apps/android-tsd/app/src/main/java/pro/logoff/wms/tsd/MainActivity.java`: `renderStockTransferScreen` | Низкий риск: отдельная кнопка только для LOGOFF. |
| `apps/android-tsd/app/src/main/java/pro/logoff/wms/tsd/StorageBoxTransferActivity.java`: создание/отрисовка, `inspectItem`, `executeTransfer`, сохранение/восстановление операции | Средний риск: дополнительный режим существующего экрана; незавершённая операция имеет приоритет над выбранным режимом. |
| `apps/android-tsd/app/src/main/java/pro/logoff/wms/tsd/StorageBoxTransferState.java`: конструктор, сканы, отмена/завершение, восстановление | Средний риск: автоматический источник заново для каждой единицы. Старый конструктор и формат восстановления поддерживаются. |
| `apps/api/test/tsd-storage-box-transfer.spec.ts`, `apps/android-tsd/app/src/test/java/pro/logoff/wms/tsd/StorageBoxTransferStateTest.java` | Регрессионные тесты и минимальное расширение существующей фикстуры. |

Общий серверный файл используется и другими конфигурациями: при переносе PR в проданную систему это нужно явно учитывать. Кнопка не доступна в FFULLHAB; тесты и debug-сборка этой конфигурации проверены. Архитектура, схема БД, резервы и интеграция WB не изменены.

## Гарантии и границы

- Инспекция только читает данные. Источник определяется по единственному зарегистрированному КИЗ (GTIN + регистрозависимый серийный номер); похожие результаты поиска не принимаются за совпадение.
- ШК должен принадлежать SKU найденного КИЗа. Клиент, филиал, доступный остаток и история сборок/отгрузок/печати проверяются повторно внутри транзакции.
- Одна единица убирается из исходного короба и добавляется в бокс назначения; тот же ProductMark переносится в целевой бокс. Нет приёмки, создания другого КИЗа или увеличения общего количества.
- Два MOVE-движения используют существующий ledger. Пользователь и SHA-256 параметров записаны в sourceDocument; повтор того же ключа возвращает ALREADY_APPLIED, изменение параметров с тем же ключом запрещено.
- Последняя единица: используется существующее архивирование и отсоединение пустого короба от паллет-сорта в той же транзакции.
- Неизвестный, бескоробный, неоднозначный, зарезервированный/отгруженный КИЗ автоматически не восстанавливается и не списывается. Сообщение объясняет причину. Для неизвестного КИЗа остаётся существующий сценарий со сканированием исходного короба.
- Потеря ответа: ТСД сохраняет режим, ШК, КИЗ, источник, назначение и ключ операции; повтор разрешён только в тот же бокс.

## TDD evidence

План основан на запросе пользователя, без внешнего plan-файла. Навык `tdd-workflow` повлиял на порядок: сначала тесты, затем сервер и ТСД. RED-коммит не создавался: пользователь требует зелёные тесты перед каждым коммитом.

RED: `node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1 test/tsd-storage-box-transfer.spec.ts` — 6 failed / 135 passed. Новая инспекция отвергалась с «Сначала отсканируйте исходный короб», execute не распознавал storage-box mode.

GREEN профильного файла: 144/144. В том числе 22 новых сценария: полный путь, варианты GS, повтор, смена параметров ключа, неизвестный/чужой/занятый КИЗ, неверный ШК, неоднозначный источник, гонка обновления, повторная проверка резерва, архивирование последней единицы и откат при ошибке архивирования. Это service-тесты с транзакционной in-memory фикстурой, не реальный PostgreSQL.

Android: Gradle `:app:testLogoffDebugUnitTest :app:testFfullhabDebugUnitTest :app:assembleLogoffDebug :app:assembleFfullhabDebug --no-daemon --console=plain` — BUILD SUCCESSFUL. В каждой конфигурации 38 тестов, 0 failures; StorageBoxTransferStateTest — 9/9, из них 3 новых. Получены debug APK, не предназначенные для обновления рабочих ТСД поверх release-подписи.

Web: `node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1` — 36/36.
API и web: проектный lint (`tsc -p tsconfig.json --noEmit`) — PASS. API build (`tsc -p tsconfig.json`) — PASS. Web build (`vite build` после typecheck) — PASS, прежние предупреждения о статических fonts/images и размере chunks.

Полный API: `node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1` — **1012/1012**, 129 файлов, 92.58 секунды. Старые тесты не упали.

## Код и тесты

Код помечен `// FIX`, тестовые сценарии — `// TEST`. Основные места:

```java
// FIX: source is resolved by WMS after the product barcode and its KIZ.
view -> startActivity(new Intent(this, StorageBoxTransferActivity.class)
    .putExtra(StorageBoxTransferActivity.AUTO_SOURCE, true))
```

```typescript
// TEST: automatic source discovery must never manufacture or double-move stock.
expect(f.quantities()).toEqual([1, 1]);
expect(f.markBox()).toBe('target');
expect(f.db.productMark.create).not.toHaveBeenCalled();
```

## Ограничения проверки и выпуск

`adb devices` — устройств нет. Не выполнены реальный сканерный E2E и интеграционный тест на PostgreSQL. Перед массовым выпуском нужен контролируемый пилот одной единицы на одном ТСД: проверить оба короба, общий остаток, тот же КИЗ, повтор после потери ответа и историю перемещения.

Coverage запущен: `vitest run --coverage --maxWorkers=2 --minWorkers=1 test/tsd-storage-box-transfer.spec.ts` — отсутствует `@vitest/coverage-v8`. Процент покрытия не подтверждён; зависимости не переустанавливались.

Для выпуска необходимы серверная публикация через PR и подписанный APK LOGOFF с новым номером версии. Текущий debug APK не выдаётся сотрудникам. Проданную ВМС и общий канал обновлений автоматически не обновлять.
