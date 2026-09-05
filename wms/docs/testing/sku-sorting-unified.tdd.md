# Единая сортировка по SKU — локальная реализация, 05.09.2026

## Назначение

Сортировка по SKU — внутрискладское перемещение для однородного хранения, не сборка поставки.
Маршрут: паллет-сорт / исходный короб → проверка всего содержимого → применение факта
существующей актуализацией → ШК нужного SKU → КИЗ → целевой короб.
Повторять переходы через главное меню не требуется.

Создание новой заявки не меняет AVAILABLE на RESERVED. До подтверждения целевого короба
новый отбор не переводит единицу в PACKING. Перемещение атомарно записывает MOVE −1/+1,
меняет привязку существующего КИЗ и отмечает размещение в заявке. Общий остаток при перемещении
сохраняется. Актуализация — отдельная операция, которая может изменить общий остаток по факту.
Обычные права на исправление расхождений сохранены: сам факт открытия этого экрана не выдаёт
сборщику полномочий администратора.

## Изоляция и состояние выпуска

- Рабочая ветка: `fix/sku-sorting-unified-flow-20260905`.
- База: `c74b5dc`, чистый релиз `feature/client-marketplace-stock-control-release`.
- Грязный основной checkout не изменялся. Схема БД и зависимости не менялись.
- Серверная возможность включается только `WMS_SKU_SORTING_ENABLED=true`, по умолчанию false.
- Новый экран включается только во flavor LOGOFF и при серверной capability `sortingWorkflow`.
- Проданная FFULHAB сохраняет прежний экран; флаг на её сервере должен оставаться false.
- Production, реальные резервы и остатки в ходе разработки не изменялись.
- Подготовлен debug APK для локальной проверки, не production-релиз. Публикация не выполнялась.

## Файлы, функции и риск

Пути относительно `wms/`.

| Файл | Изменение | Риск / ограничение |
| --- | --- | --- |
| `apps/api/src/modules/inventory/sku-sorting.service.ts` | Новый `SkuSortingService`: start, openSource, ready, check, move | Высокий: остатки и КИЗ; транзакции, повторная проверка, точная область клиент/филиал, opt-in |
| `apps/api/src/modules/inventory/sku-collection.service.ts` | create, pick, receive, withRoutes | Высокий: отказ от резерва только при флаге; совместимость со старыми отобранными единицами |
| `apps/api/src/modules/inventory/inventory.service.ts` | openBox, decideLine, assertSortingInventorySnapshot | Высокий: актуализация; дополнительная проверка только для `[SKU_SORTING_SOURCE]`, обычные права сохранены |
| `apps/api/src/modules/inventory/dto/sku-collection.dto.ts` | DTO источника, готовности, проверки и перемещения | Средний: валидация новых маршрутов |
| `apps/api/src/modules/inventory/inventory.module.ts` | Регистрация и экспорт сервиса | Низкий: wiring |
| `apps/api/src/modules/tsd/tsd-device.controller.ts` | Пять POST sorting/*, stock:write | Средний: новая поверхность API; старые маршруты не удалены |
| `apps/api/src/modules/administration/administration-internal-api.service.ts` | Счётчик маршрутов ТСД 79 → 84 | Низкий: каталог |
| `apps/android-tsd/app/src/main/java/pro/logoff/wms/tsd/MainActivity.java` | Единый экран, переход в существующую проверку и обратно, сканы, busy/retry, onBackPressed | Средний/высокий: общий Activity; новые ветви только LOGOFF + capability |
| `apps/android-tsd/app/src/main/java/pro/logoff/wms/tsd/SkuSortingScanState.java` | Отдельная последовательность состояний, физическое подтверждение старого отбора, целевой короб при неопределённом результате | Средний: не используется старым режимом |
| `apps/android-tsd/app/src/main/java/pro/logoff/wms/tsd/network/WmsApi.java` | Пять методов Retrofit | Низкий: добавление без удаления старых |
| `apps/android-tsd/app/src/main/java/pro/logoff/wms/tsd/network/TsdSkuCollection.java` | capability и barcode скана | Низкий: обратно совместимые поля |
| `apps/android-tsd/app/src/main/java/pro/logoff/wms/tsd/network/TsdSkuSortingSource.java` | Ответ session + box | Низкий: новый DTO |
| `.env.example` | Флаг false | Низкий: реальная конфигурация не изменена |
| `apps/api/test/sku-sorting.spec.ts` | Создание без резервирования | Тест |
| `apps/api/test/sku-sorting-move.spec.ts` | Движение, повтор, права, инвентаризация, чужие статусы | Тест |
| `apps/api/test/sku-sorting-legacy.spec.ts` | Старый PACKING и доказуемый собственный резерв | Тест |
| `apps/api/test/sku-sorting-inventory.spec.ts` | Не восстанавливать параллельно отобранный / зарезервированный товар | Тест |
| `apps/android-tsd/app/src/test/java/pro/logoff/wms/tsd/SkuSortingScanStateTest.java` | Последовательность, физические сканы, повтор и выход | Тест |
| `docs/testing/sku-sorting-unified.tdd.md` | Этот отчёт | Документация |

## Защита остатков

- Сервер повторно проверяет AVAILABLE и КИЗ внутри serializable-транзакции.
- Повтор того же КИЗ в тот же целевой короб возвращает результат без повторного движения.
- Другой целевой короб при повторе отвергается; ТСД сохраняет цель при потере ответа.
- Чужой клиент/филиал, отгруженный КИЗ, активная полная инвентаризация и пересчитываемый
  исходный/целевой короб не обходятся.
- Целевой короб не должен оставаться необработанным источником в той же заявке.
- Короб без положительных остатков архивируется и снимается с паллет-сорта штатным helper.
- APPLY_ACTUAL не восстанавливает товар по устаревшему снимку, если за время проверки
  были движения или появился несвободный остаток. Доступна свежая проверка без удаления старых решений.
- Старый собственный остаток RESERVED снимается только при явном POST start и достаточном
  подтверждении количества по журналу; при неоднозначности вся операция отклоняется.
- Старый PACKING размещается только после физических ШК + КИЗ, без повторного исходного отбора.
- Новая сортировка не вызывает отправку поставки или КИЗ в WB.

## TDD и проверки

Использован навык tdd-workflow. По правилу Константина коммиты допустимы только с зелёными
тестами, поэтому отдельные RED-коммиты не создавались. RED проверен локальными запусками,
а не заявлен по результатам чужих коммитов.

| Гарантия | RED | GREEN |
| --- | --- | --- |
| Создание не резервирует | Старое create удаляло AVAILABLE / создавало RESERVED | sku-sorting.spec.ts |
| Старое размещение не является новой приёмкой | Старый ledger содержал только RECEIPT +1 | sku-sorting-legacy.spec.ts: MOVE PACKING −1 / AVAILABLE +1 |
| Новая последовательность сканов | Отсутствующий SkuSortingScanState не компилировался | SkuSortingScanStateTest |
| Старый отбор требует физических ШК + КИЗ | Начальный TARGET_BOX не соответствовал ожидаемому BARCODE | legacyPickedCanBePlacedWithoutPickingAgain |
| Не потерять цель при неизвестном результате | Отсутствующие методы pending target / canLeave не компилировались | uncertainMoveMustRetryTheSameDestination |

Локальные команды и результаты:

- API: `node node_modules/vitest/vitest.mjs run` — **815/815**, включая 19 новых тестов.
- API: `tsc -p tsconfig.json` — успешно. Проектный lint использует тот же TypeScript checker;
  проверка `--noEmit` также выполнялась успешно. Отдельного ESLint в скриптах нет.
- Web: Vitest — **34/34**; TypeScript + Vite build — успешно. Есть предупреждение Vite о крупных
  чанках; веб-код в этой задаче не менялся.
- Android: `:app:testLogoffDebugUnitTest :app:testFfullhabDebugUnitTest :app:assembleLogoffDebug`
  через Gradle 8.10.2 / JDK 17 — **35/35 для каждой версии**, APK собирается.
- `git diff --check` — без ошибок пробелов.

Код содержит локальные пометки `// FIX`, тесты — `// TEST`. Например:

```ts
// FIX: sorting is a route snapshot, not a reservation of saleable stock.
if (process.env.WMS_SKU_SORTING_ENABLED === 'true') continue;
```

```ts
// TEST: lost HTTP response is a read-only retry, not a second decrement.
await service.move('request', dto as any, user);
expect(tx.stockBalance.updateMany).not.toHaveBeenCalled();
```

## Чего эти проверки не доказывают

Это unit/service-тесты с подменой Prisma, не полноценный прогон конкурентных транзакций
на PostgreSQL. На реальном ТСД / эмуляторе интерфейс не проверялся: подключённых устройств нет.
Покрытие 80% не подтверждено: coverage provider не установлен. Принудительное закрытие Android,
перезапуск устройства и восстановление после этого требуют отдельного сквозного прогона.
Зелёные тесты не означают разрешение на массовый выпуск.

## Следующий безопасный шаг

После согласования — PR в текущую интеграционную ветку нашей WMS
`fix/fbs-box-scan-route-consistency` (не sold-vm / main / master). В PR отметить изменения
общих InventoryService / MainActivity и требование оставить флаг false на проданной системе.
Перед активацией: свежая резервная копия БД и конфигурации, подписанный LOGOFF APK, тестовая
заявка и один ТСД. Проверить весь путь, расхождение при актуализации, неверный КИЗ,
потерю ответа, два одновременных скана, архивирование пустого короба, старый PACKING и
неизменность FBS. Только затем включать сотрудникам. Возвращать старый APK для уже
маркированных `[SKU_SORTING_V2]` заявок нельзя: старый pick специально их блокирует.
