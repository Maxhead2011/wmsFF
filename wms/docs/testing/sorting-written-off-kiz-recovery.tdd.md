# Восстановление найденного ранее списанного КИЗа

## Область и гарантии

WMSFF2207, ветка `fix/sorting-written-off-kiz-recovery`, основана на `feature/tsd-monitor-messages` (55934fb).
Только включённая сортировка `WMS_PALLET_SORTING_ENABLED` и роль ADMIN. FFULHAB не публиковался и не менял настроек.

Администратор сканирует ШК и КИЗ. Для BLOCKED требуется подтверждённое складское списание: отрицательный INVENTORY_ADJUSTMENT того же клиента, SKU и филиала, в течение секунды перед блокировкой КИЗа. Для записи без boxId дополнительно требуется `admin-unpalleted-writeoff`. Неоднозначные документы, остаток в старом коробе, другая принадлежность, дубликаты, любая найденная история заказа/отгрузки/печати/погашения запрещают восстановление.

Первый запрос не пишет остатки: возвращает 409 `SORTING_WRITEOFF_CONFIRM_REQUIRED` и fingerprint, привязанный к пользователю, сессии, версии, ШК, КИЗу, коробу и документу списания. После отдельного нажатия на ТСД все проверки повторяются. Одна транзакция создаёт движение +1, обновляет существующий ProductMark, увеличивает остаток назначения и счётчики сессии, пишет аудит. Старый короб и его списание не восстанавливаются. Другие BLOCKED-случаи без такого доказательства требуют отдельного разбора.

## Точки касания

- `apps/api/src/modules/inventory/pallet-sorting.service.ts`: только ответвление BLOCKED в move; recovered reason WRITTEN_OFF_KIZ.
- `apps/api/src/modules/inventory/dto/pallet-sorting.dto.ts`: отдельные confirmRestore/restoreFingerprint.
- `apps/api/src/modules/stock/sorting-written-off-recovery.ts`: изолированный механизм проверки и восстановления.
- `apps/api/src/modules/stock/stock-operations.service.ts`: адаптер с проверкой прав и существующим incrementTargetBalance.
- `apps/android-tsd/app/src/main/java/pro/logoff/wms/tsd/PalletSortingScreen.java`: обработка структурированного 409, отдельный touch-only диалог. Старые APK не выполняют автоматическое восстановление.
- `PalletSortingRestoreConsent.java`: снимок скана, отмена согласия, новый operationId после подтверждения, прежний operationId при сетевом повторе.

## RED / GREEN

1. `vitest run test/sorting-written-off-recovery.spec.ts -t 'routes a written-off' --maxWorkers=2 --minWorkers=1` до правки: выполненный тест упал с исходным сообщением «КИЗ не относится к доступному товару в отсканированных исходных коробах» (move, строка 259).
2. Gradle `:app:testLogoffDebugUnitTest --tests '*PalletSortingRestoreConsentTest'`: compile-time RED, отсутствует новый класс подтверждения, на который ссылаются тесты.
3. После правки: 25 серверных тестов новой ветви пройдены. `SORTING_WRITEOFF_COVERAGE=true` с тем же тестом: native V8 34/34 блока основной функции (100%). Это не покрытие всего WMS.
4. Полный API: `vitest run --maxWorkers=2 --minWorkers=1 --reporter=json --outputFile=.../api-tests-final.json` — 1527/1527, 0 падений.
5. API `tsc -p tsconfig.json --noEmit` и `tsc -p tsconfig.json` — успешно.
6. Gradle `:app:testLogoffDebugUnitTest :app:testFfullhabDebugUnitTest :app:assembleLogoffDebug` — успешно. LOGOFF: 61 тест, 0 падений; оба flavor unit test task прошли.
7. `apps/api/test/sorting-written-off-postgres.cjs` — отдельная PostgreSQL `sorting_written_off_test`, внутреняя Docker-сеть, только синтетические данные и схема. Пройдены: preview без записи, повтор, одновременное подтверждение, rollback при ошибке финального аудита, поздняя запись печати блокирует подтверждение. Контейнер тестовой БД остановлен после запуска.

8. Полный web: `vitest run --maxWorkers=2 --minWorkers=1` — 61/61, 0 падений. `git diff --check` — успешно.

RED-коммит не создавался: правило пользователя запрещает коммиты при красном наборе. RED-доказательства сохранены здесь; итоговый коммит после GREEN.

## Ограничения проверки и выпуска

Физический ТСД/эмулятор недоступен: диалог проверен через тесты модели подтверждения и компиляцию Android, но не аппаратным сканером. Новый APK релиза ещё не выпущен; versionCode не повышен. Серверная функция ещё не опубликована постоянно. Для публикации нужен PR в текущую ветку нашей WMS (`fix/sorting-recorded-source-20260908`), проверка точного production diff, новая LOGOFF-версия APK и обычные проверки выпуска. Ни main/master, ни sold-ветки не затронуты.

## Подтверждённая единичная коррекция

По прямому согласию Константина через этот же проверенный механизм восстановлен только ProductMark `56403de6-2c27-4c3c-886f-5c3b0e4dde52`, ШК 2051754379636, в FFL_LKBS0709_09. Движение +1: `7776a03a-59cb-4f9d-8334-9e3048580c33`, версия сессии 114 → 115, количество в новом коробе 0 → 1. Прежнее списание -5 сохранено. Дополнительный аудит CODEX_USER_APPROVED_SINGLE_UNIT_RECOVERY явно отличает выполнение по согласию в Codex от нажатия на физическом ТСД.

Исполнение — временный контейнер на образе работающей API с двумя read-only подставленными тестированными JS-модулями, без перезапуска/замены работающих сервисов. Снимки до/после сохранены в защищённом каталоге резервных копий сервера. Секреты в Git не добавлялись.
