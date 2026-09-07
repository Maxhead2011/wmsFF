# Выпуск восстановления неизвестного источника — 07.09.2026

Только наша WMS; PR в `fix/fbs-box-scan-route-consistency` из
`fix/sorting-unknown-source-recovery-20260907`. FFULHAB не публикуется.
Это дополнение к протоколу локального исправления `pallet-sorting-unknown-source-20260907.md`.
Факт переключения production фиксируется отдельным `published-at` на сервере; наличие этого документа само по себе не означает публикацию.

## Область и изоляция

- API: только `PalletSortingService` и `StockOperationsService.recoverSortingUnit`, без миграций.
- Web: только типы pallet-sorting API и существующий `PalletSortingPanel` поверх проверенного live-исходника.
- Android: форматирование проблемных коробов в LOGOFF; версия 160 / `0.1.161-sorting-recovery`.
- Независимый уже работающий `validateBoxWeight` сохраняется побайтно с нормализацией LF: расчётный перевес даёт предупреждение, подтверждённый измеренный вес сохраняет прежние ограничения.
- Не изменяются конфигурация, общий APK/JSON обновления, старые APK, старые lazy bundles, другие модули и остатки production.
- Не связанный с задачей `apps/api/test/pallet-sorting-postgres.cjs` исключён; SHA256 `93133d4ca1115e3d399c16b0b918b318d4feda0b6d0e393658575ef268661a18`.

## Проверки перед выпуском

- Повторный локальный API: 151 файл / 1359 тестов PASS.
- Повторный локальный web: 16 файлов / 58 тестов PASS.
- API и web typecheck/build PASS; существующие предупреждения Vite о размере чанков и трёх ресурсах остаются.
- Node release guards: 10/10 PASS (перед добавлением версии/overlay новые 3 теста RED).
- Фактический серверный кандидат: 151 файл / 1372 теста PASS; различие числа тестов с локальной веткой связано с сохранённым live-набором, а не исключением проверок.
- PostgreSQL на кандидатном образе: PASS — 3 найденные единицы / 3 движения, rollback, concurrentRetry, alternativeKizAndLiteralLike, completion.
- Проверка скомпилированной весовой политики: `WEIGHT_POLICY_PRESERVED`.
- Gradle: `testLogoffDebugUnitTest testFfullhabDebugUnitTest assembleLogoffRelease` PASS; по 52 теста на flavor.
- APK проверен aapt/apksigner: package `pro.logoff.wms.tsd`, minSdk 24, code 160.
- APK SHA256: `c6bdd49cf28aa630918326cab6e0a900a54a6b5946ab546fea1ada70d4796af5`.
- Подпись SHA256: `52916d7797ade50cc1c50bba8787b9d2307b1e5dfd4ea725bd7c3be0e64f989b` (совпадает с существующей).
- UI-проверка реального React-компонента и ограничения проверки физического ТСД описаны в исходном протоколе. Установка APK на устройство этим выпуском не подтверждается.

## Воспроизводимая публикация

`infra/scripts/sorting-recovery-overlay.cjs`: отклоняет неожиданные различия live, сохраняет существующий весовой обработчик; проверяет разрешённые изменения файлов и неизменность runtime-конфигурации.

`infra/sorting-recovery.Dockerfile`: сборка без сети поверх закреплённых live images; в финальный API переносит ровно два TS и два JS; web сохраняет старые файлы.

`infra/scripts/sorting-recovery-release.sh stage`: блокировки параллельного выпуска, проверка текущих image ID, свежий pg_dump, pg_restore --list и SHA256, резервные теги образов, сборки и сравнение артефактов.

`infra/scripts/sorting-recovery-candidate-tests.sh`: полный runtime Vitest без сети и production credentials, проверка скомпилированного ограничения веса, настоящий PostgreSQL-тест на синтетических данных.
Первый runtime-прогон обнаружил отсутствие двух вспомогательных файлов старых тестов в образе. Они монтируются read-only только в тестовый контейнер; исключений тестов и дополнительных файлов в production нет.

`infra/scripts/sorting-recovery-postgres.sh`: отдельный остановленный тестовый PostgreSQL на внутренней сети, только схема production без данных. Проверяет восстановление, одновременный повтор, rollback, исторический КИЗ, завершение; затем останавливает тестовый контейнер.

`infra/scripts/sorting-recovery-release.sh publish`: требует merged PR, успешные тесты и неизменность артефактов/конфигурации; переключает только наши API/web, проверяет health, 401 без авторизации, публичный HTML и APK по SHA256, неизменность контейнера БД. При ошибке возвращает только прежние app images; не откатывает БД и не перетирает чужой параллельный выпуск.

Папка резервной копии и протоколов: `/opt/logoff-wms-backups/sorting-recovery-20260907`.
Отдельный APK: `/downloads/logoff-tsd-sorting-recovery-160.apk`. Общий канал обновления остаётся прежним; автоматическая установка на все ТСД не запускается.
