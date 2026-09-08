# Выпуск LOGOFF 163: подтверждение найденного списанного КИЗа

Разрешение Константина: «публикуй». Ветка `fix/sorting-written-off-kiz-recovery`; PR в `fix/sorting-recorded-source-20260908`. Прямых push в базовую/защищённую ветку нет.

## Область и риск

- Четыре API-модуля: `inventory/pallet-sorting.service`, `inventory/dto/pallet-sorting.dto`, `stock/stock-operations.service`, `stock/sorting-written-off-recovery`. Изменения накладываются проверенным patch на исходники **работающего** API и компилируются там. Остальные исходники и JS проверяются по SHA-256 на неизменность.
- Android: `PalletSortingScreen`, новая модель/тест согласия, версия только flavor LOGOFF. Общие исходники потенциально влияют на будущую сборку FFULHAB; серверный механизм требует включённой сортировки/ADMIN, FFULHAB APK и окружение не публикуются.
- Веб: только `downloads/logoff-tsd.apk`, `logoff-tsd.json` и новый неизменяемый URL. Все остальные файлы, старые APK и bundles сохраняются.
- Инфраструктура: новые `infra/kiz-recovery-163.Dockerfile`, `infra/scripts/kiz-recovery-163-release.sh`, `kiz-recovery-163-artifacts.cjs` и тест. Риск переключения API снижен точными image gates, резервной копией и возвратом предыдущих образов при ошибке.
- Нет миграций БД, массовых исправлений остатков, изменений прав или автоматического снятия заказов.

## Проверки

Повторно перед коммитом: API 1527/1527, web 61/61, API/web typecheck, 7 проверок состава выпуска, Android unit tasks LOGOFF и FFULHAB и подписанная LOGOFF release-сборка — успешно. Тест новой функции первоначально воспроизвёл старую ошибку (см. `sorting-written-off-kiz-recovery.tdd.md`).

Release APK: versionCode **163**, versionName **0.1.164-kiz-recovery**, applicationId **pro.logoff.wms.tsd**, minSdk 24. Размер 2259529, SHA-256 `5c568246e86f1af4a5d2f42e9be034ee0d04233dc26f3672e1e87fff21b7a16c`. Подпись прежняя: `52916d7797ade50cc1c50bba8787b9d2307b1e5dfd4ea725bd7c3be0e64f989b`.

Физический ТСД недоступен; установка и аппаратное нажатие не проверены. Подтверждение проверено тестами модели и компиляцией.

## Процедура

`stage` → `test` → `sql` → MERGED PR → `publish EXPECTED_HEAD`. До последнего шага production не переключается. Полный набор кандидата сохраняет согласованные тестовые fixtures выпусков 161/162. PostgreSQL — отдельная внутренняя сеть, пустая тестовая БД со схемой без production-данных; используется настоящий stock-адаптер кандидата. Проверяются подтверждение, повтор, конкуренция, rollback и появившаяся после preview печать.

Backup: `/opt/logoff-wms-backups/kiz-recovery-163-20260908`. Staging: `/opt/logoff-wms-releases/kiz-recovery-163-20260908`.

Исходный API: `sha256:44178623ff5e3646732ba5e5d3541db9839e21109b17e23d5790b503d46482e3`; web: `sha256:c0d1214a0b71ecdb54d6e756cf3d8b83da8d659aa83d91d1a5305116e69ab98b`. Откат на теги `infra-api:before-kiz-recovery-163-20260908` и `infra-web:before-kiz-recovery-163-20260908`, **без восстановления БД поверх новых операций**.

Публикацию доказывают `published-at`, проверки public health, совпадение metadata/хешей двух APK, сохранение env/compose и неизменность контейнеров PostgreSQL/Redis/аналитики. Этот документ описывает выпуск, но сам по себе не доказывает переключение.
