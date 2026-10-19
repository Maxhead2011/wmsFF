# Снятие пустых сортировок из администрирования

Подготовлено 19.10.2026, не опубликовано.

Администрирование → «Незавершённые сортировки» → «Снять сортировку». Доступ только ADMIN и OWNER, исключая демонстрационные аккаунты, при существующем флаге сортировки. Ограниченный администратор не получает доступ к API собственника.

Список ограничен текущим филиалом и доступными клиентами. Требуются причина и подтверждение конкретной сессии. Команда CANCEL_EMPTY повторно проверяет версию под блокировкой строки в Serializable-транзакции. Разрешены только сессии без moves, targets, activeTargetId, pendingRoutes и архивированных источников. Прочие требуют отдельной проверки.

Команда закрывает только сессию: stage=COMPLETED, completedAt и дополнительные cancelledAt/cancellationReason. Сохраняются исходные короба, складские остатки, КИЗы, размещения и история. Обычный COMPLETE с обработкой остатков не вызывается. Журнал PALLET_SORTING_CANCELLED содержит пользователя, причину, прежний этап и новую версию. Повтор той же операции идемпотентен, повтор с изменённым телом отклоняется.

API: `pallet-sorting.service.ts`, `dto/pallet-sorting.dto.ts`. Web: `AdministrationSortingCancellation.tsx`, `AdministrationPanel.tsx`, `workspaces.ts`. Схема БД не меняется. Используются существующие WMS_PALLET_SORTING_ENABLED / VITE_PALLET_SORTING_ENABLED; включение на других установках не выполняется.

Проверки: `apps/api/test/pallet-sorting-cancel.spec.ts` (13), `apps/web/src/components/administration/AdministrationSortingCancellation.spec.tsx` (7). До исправления 3 новых API-теста воспроизводили отсутствие операции.

Для публикации требуется сверить актуальный runtime и подготовить overlay: исходники пока не являются полным эквивалентом production. Текущий проверенный baseline до этой работы — 2026-10-18-wb-first-publication.

Локальная регрессия: API 3535 passed / 155 skipped, web 453 passed / 2 skipped. Обе проверки TypeScript успешны. Отдельный kiz-duplicate.integration.spec.ts исключён из повторного API-прогона: локальная KIZ_DUPLICATE_TEST_DATABASE_URL не настроена; первоначальный общий прогон остановился на создании PrismaClient этого набора, остальные тесты прошли.
