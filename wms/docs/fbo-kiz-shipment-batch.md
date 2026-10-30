# Пакетная итоговая проверка КИЗ FBO

Опубликовано 30.10.2026 через PR783 в feature/wb-print-check.

№2494 «Никольское»: 578 упакованных единиц, 57 закрытых и подтверждённых коробов, этап CONTROL. FINISH прерывался после 60 секунд на последовательной проверке КИЗ. Ошибка одинаково затрагивала ТСД и административное завершение через «Проблемы FBO».

В kiz-shipment-reads.ts данные загружаются группами по 20 канонических идентичностей: физические марки, история отгрузок/FBO, обращения и конкурирующие привязки. Перед чтением берутся те же клиентские advisory-locks, что при приёмке и одиночном использовании, в едином порядке. Контекст существует только внутри текущей транзакции. Смена заявки/клиента/филиала отклоняется. Переполнение лимита чтения блокирует решение, а не скрывает возможные дубли. Формы сканера и точное сравнение идентичности сохранены. Повтор идентичности внутри заявки запрещён.

kiz-client-review.ts использует эти данные в прежней assertClientKizUse: история, административное разрешение REUSE, его fingerprint/контекст, OPEN/REJECTED/USED, конкурирующие заявки, физические дубли и ожидаемое перемещение остаются обязательными. FIRST_USE сохраняется для каждой единицы, историческая приёмка не перезаписывается. Одиночный отбор, FBS, приёмка и решения администратора сохраняют прежний путь. Флаг WMS_KIZ_CLIENT_GUARD_ENABLED не отключается, схема/данные/проданная ВМС не мигрируются.

Файлы: common/kiz-client-review.ts; новый common/kiz-shipment-reads.ts; test/kiz-shipment-batch.spec.ts; scripts/releases/fbo-kiz-shipment-20261030 (изолированная проверка, точный overlay и rollback); карта/индекс/паспорт.

Проверки: RED578 отдельных поисков марок → GREEN29. API4108/web563, TypeScript; API156/web2 skipped, отдельный ненастроенный kiz-duplicate.integration исключён. PostgreSQL9: 578 единиц/57 коробов, дубль марки, OPEN, отгрузка WB с датой/заказом, активная FBS-привязка, общий advisory-lock, сохранение578 разрешений, FINISH и идемпотентный повтор, оба Excel-файла, SHIPPING578. Полный запуск Nest health. Дополнительные unit-тесты: REJECTED/USED, дубли внутри заявки, активная FBO-привязка/CLAIMED, лимит и смена клиента. Проверка живых данных2494 в READ ONLY, записи разрешений имитированы: ALLOW15.67s, без изменений БД. Полное синтетическое завершение7.451s. Это замеры конкретных запусков, не гарантия времени при любой нагрузке.

Выпуск: точные изменения двух API-модулей на опубликованном PR779 API; web/APK247 от PR781 сохраняются. Остальные690 API-файлов, окружение, схема и другие контейнеры неизменны. Все новые проверки помечены // TEST, исправления // FIX.

Published API image: `sha256:add4e84416d33f85f96d8a398681c6c08148534b38cf7349085791a17040acfe`. Public health and exact module hashes verified; other containers/environment unchanged.


Follow-up: real FINISH2494 still rolled back on P2034 at KizReviewCase upsert while staff worked on other requests. EXPLAIN confirmed Seq Scan for clientId + kizIdentity: the required composite index was absent. Additive own-WMS SQL in scripts/releases/fbo-kiz-review-index-20261030/review-index.sql creates it CONCURRENTLY and refuses an existing invalid/different definition. No policy, transaction isolation or business rows are changed. The original single-table schema source does not contain this runtime model, so no unverified schema replacement is deployed.
PostgreSQL regression reproduces the original serialization conflict, then five concurrent runs succeed with the index; all30000 OPEN review rows remain OPEN. Source API4108/web563/TypeScript and nine runtime negative/FINISH tests from PR783 remain applicable: API code is unchanged. Current real completion remains pending verification.
