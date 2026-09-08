# Свободный источник при наполнении и автоматический переход ШК → КИЗ

Дата: 08.09.2026. Только WMSFF2207 / LOGOFF.
Ветка: `fix/sorting-free-source-auto-kiz-20260908`.
База: `fix/sorting-recorded-source-20260908`, `bfcbc19`.
Статус: локально реализовано и проверено; API и APK не опубликованы.

## Запрос и границы

Константин попросил не проверять исходные короба при наполнении нового короба и автоматически переходить с принятого ШК на КИЗ.

- В FORMING при MOVE/OPEN_TARGET/CLOSE_TARGET больше не проверяется весь старый список исходных коробов. Проверка фактически используемого источника остаётся в MOVE; проверка целевых коробов и общей полной инвентаризации сохранена.
- Для зарегистрированного AVAILABLE КИЗа источник списания определяется по учётной привязке КИЗа. Наличие/сканирование физического источника в старом списке, его старый флаг и совпадение паллет-сорта не требуются. Введённый физический источник сохраняется как необязательная подсказка в аудите, а не как доказательство состояния короба.
- Учётный короб должен оставаться действующим и принадлежать клиенту/филиалу сортировки; ШК должен соответствовать КИЗу. Проверяются доступный остаток, конкурирующая сортировка, инвентаризация и собственная история КИЗа. Эти ограничения не отменены.
- Для ещё не привязанного КИЗа можно указать фактический короб с другого паллета. Он не добавляется автоматически в список последующего архивирования/списания. Если источник неоднозначен, система по-прежнему просит его указать: произвольный расход или повторный приход не допускаются.
- Приход найденной единицы остаётся в существующем защищённом `recoverSortingUnit`; этот метод не изменён. Нулевой AVAILABLE при наличии резерва не разрешает новый приход.
- Первоначальная сверка CHECKING и подтверждение недостачи при COMPLETE не изменены. Остатки автоматически по отсутствию короба не списываются.
- Android: ШК из 8–14 цифр автоматически принимается через 350 мс после последнего изменения поля, без Enter; фокус и прокрутка переводятся на КИЗ после layout. Для нестандартного ШК сохраняются Enter/кнопка. Автоввод не применяется к полю исходного короба или к КИЗу. При закрытии, перерисовке, явном подтверждении, занятом экране и неподтверждённом запросе отложенный ввод отменяется.
- Версия, signing, applicationId и конфигурация других flavors не менялись. Экран уже доступен только в LOGOFF; серверная сортировка по-прежнему требует ADMIN и `WMS_PALLET_SORTING_ENABLED=true`.

## Файлы и риск

| Файл | Функции / назначение | Риск |
|---|---|---|
| `apps/api/src/modules/inventory/pallet-sorting.service.ts` | `action`, `move`, `moveFromRecordedSource`, nullable physical hint | Высокий: источник списания; не изменены ledger, recovery и другие сервисы |
| `apps/android-tsd/app/src/main/java/pro/logoff/wms/tsd/PalletSortingScreen.java` | `render`, `submit`, `close`; wiring TextWatcher и focus | Средний: последовательность ввода |
| `apps/android-tsd/app/src/main/java/pro/logoff/wms/tsd/PalletSortingAutoSubmit.java` | debounce с отменой устаревших callbacks | Низкий: отдельный локальный обработчик |
| `apps/api/test/pallet-sorting-recorded-source.spec.ts` | новая политика источника, аудит, права, история, повтор, locks | Тесты |
| `apps/api/test/pallet-sorting-late-source.spec.ts` | обновлён контракт FORMING; CHECKING сохранён | Тесты |
| `apps/api/test/pallet-sorting-recovery.spec.ts` | внешний фактический источник и моки source locks | Тесты |
| `apps/api/test/sorting-settled-task.spec.ts` | дополнен fixture реального источника и locks | Тесты |
| `apps/android-tsd/app/src/test/java/pro/logoff/wms/tsd/PalletSortingAutoSubmitTest.java` | debounce, отмена, устаревшие callbacks, отключённый ввод | Тесты |
| Этот файл | доказательства и ограничения | Документация |

## Основные изменения кода

```ts
// FIX: forming checks the actual moved source below, not every old checklist box.
const checkSources = !['MOVE', 'OPEN_TARGET', 'CLOSE_TARGET'].includes(dto.action);
```

```java
// FIX: Enter/button and automatic submission share one scan, never two.
autoSubmit.cancel();
```

```ts
// TEST: physical SKU + KIZ selects the accounting source, not an obsolete pallet checklist.
expect(f.service.stock.transferSortingUnit).toHaveBeenCalledTimes(1);
expect(f.service.stock.recoverSortingUnit).not.toHaveBeenCalled();
expect(f.state.sources).toEqual(before);
```

## RED → GREEN

1. `vitest run test/pallet-sorting-recorded-source.spec.ts --reporter=json --outputFile=C:/WMSFF2207/tmp/sorting-free-source-red.json`: 11 FAIL / 28 PASS до изменения сервиса. Отказы из-за старого списка, расположения физического короба и блокировки постороннего источника. Первоначальный неполный mock для неизвестного кода исправлен и RED повторён до правки рабочего кода.
2. `vitest run test/pallet-sorting-recovery.spec.ts --reporter=json --outputFile=C:/WMSFF2207/tmp/sorting-free-source-recovery-red.json`: добавленные случаи внешнего паллета отклоняются до фикса.
3. Android `:app:testLogoffDebugUnitTest --tests '*PalletSortingAutoSubmitTest'`: compile-time RED — тест ссылается на отсутствующий обработчик автоматического ввода. Исходный Android-код скомпилировался; тестовый target не скомпилировался именно из-за отсутствия новой реализации.
4. После минимальной правки 146 целевых API-тестов проходят; 4 новых Android-теста проходят в полном наборе.
5. Первый полный API-прогон выявил прежние ожидания запрета внешнего паллета и неполные моки перенесённых проверок. Обновлены только соответствующие тесты; повторный полный прогон — 1475/1475.

Коммит RED не создавался: правило Константина требует зелёных тестов перед коммитом. Доказательства сохранены в отчётах RED, без изменения истории Git.

## Проверки

Команды API выполнялись из `apps/api`, Android — из `apps/android-tsd`, web — из `apps/web`. Использованы установленные зависимости, без их изменения.

| Проверка | Фактическая команда / артефакт | Результат |
|---|---|---|
| Целевые API | `vitest run test/pallet-sorting-recorded-source.spec.ts test/pallet-sorting-recovery.spec.ts test/pallet-sorting-late-source.spec.ts test/sorting-settled-task.spec.ts --reporter=dot` | 146 PASS |
| Полный API | `vitest run --reporter=json --outputFile=C:/WMSFF2207/tmp/sorting-free-source-full-api.json` | 1475 PASS, 0 FAIL |
| Полный web | `vitest run --reporter=json --outputFile=C:/WMSFF2207/tmp/sorting-free-source-full-web.json` | 58 PASS, 0 FAIL |
| API типы | `node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` | PASS |
| API сборка | `node ../../node_modules/typescript/bin/tsc -p tsconfig.json` | PASS |
| Android | Gradle 8.10.2 `:app:testLogoffDebugUnitTest :app:assembleLogoffDebug --no-daemon --console=plain` | 56 PASS; debug APK собран |
| Покрытие нового пути | `SORTING_RECORDED_SOURCE_COVERAGE=true vitest run test/pallet-sorting-recorded-source.spec.ts --reporter=dot` | moveFromRecordedSource: 32/33 V8-блока, 96.97% |
| Пробелы | `git diff --check` | PASS |

Покрытие 96.97% относится только к измеренной функции, не ко всему API/Android. Android-тесты используют детерминированные часы, а не реальный экран. `adb devices` не показал подключённых устройств; физический ТСД, аппаратный сканер и полноценный UI E2E в этой задаче не проверены. Новая отдельная SQL-интеграция на реальном PostgreSQL не запускалась. Production-данные и существующие сессии не изменялись.

## Публикация

Предлагаемый PR — из `fix/sorting-free-source-auto-kiz-20260908` в `fix/sorting-recorded-source-20260908`. Перед публикацией сравнить с текущими live-файлами: репозиторий не равен общему production-образу. Нужны API-патч и отдельное обновление LOGOFF APK; один рестарт приложения новый Android-код не доставит. Никаких push/PR/deploy в этой задаче пока не выполнялось.

Чужая незавершённая правка `pallet-sorting-postgres.cjs` в исходном рабочем каталоге сохранена и не включена.
