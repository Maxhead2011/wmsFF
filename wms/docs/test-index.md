# Индекс проверок

При изменении общей точки входа проверять все связанные строки, а не только новый
экран. Наличие имени в коде не заменяет вызов сценария. Production-данные не использовать
для тестовых записей/списаний. Интеграционные БД — отдельные, пропуски явно указывать.

| Изменяемая область | Проверки API (`apps/api/test/`) | Android / другие проверки |
| --- | --- | --- |
| FBS экран, capability, контроллер | `tsd-fbs-capability.spec.ts`, `fbs-tsd-sticker-number.spec.ts` — также на реальном runtime | `FbsAssemblyUiTest`, `OzonLabelSafetyTest` |
| Переклейка и её печать | `tsd-relabel-print.spec.ts`, `tsd-relabel-label.spec.ts`, `fbs-physical-kiz-relabel.spec.ts`, `pick-instruction-relabel-barcode.spec.ts` + предыдущая строка | `FbsRelabelPrintUiTest`, `RelabelPrintGateTest`, `FbsKizRelabelTest` |
| Несколько единиц и последовательная сборка | `tsd-fbs-capability.spec.ts` с runtime-путями, `fbs-online-remaining-progress.spec.ts`, `fbs-box-scan-route-consistency.spec.ts` | `FbsSequentialPickTest`, восстановление после повторного ответа |
| Очередь заявок и роли | `fbs-lukin-batch.spec.ts`, `fbs-terminal-queue.service.spec.ts` | Owner/admin без лимита; сборщики — закреплённая пятёрка Лукина, другие клиенты без этого лимита |
| Остатки/резерв/маршрут | `fbs-stock-allocation.spec.ts`, `fbs-stale-rescan-reservation.spec.ts`, `fbs-picked-stock-proof.spec.ts`, `fbs-stock-transfer.spec.ts` | Сверить API и таблицу заявки; включить сценарий исходный/целевой SKU |
| Печать/подтверждение/списание | `fbs-print-order-scope.spec.ts`, `fbs-print-stale-kiz.spec.ts`, `fbs-print-ack-billing.spec.ts`, `print-job.service.spec.ts` | Повтор запроса не печатает/не списывает ещё раз; тестовый принтер только с разрешением |
| Автостатусы и уведомления | `fbs-request-auto-status.integration.spec.ts` на изолированной БД и candidate runtime | Сохранить ручной статус и поведение выключенного флага |
| FBO | `fbo-two-stage.integration.spec.ts`, `fbo-picked-reservation.spec.ts`, `fbo-archived-shipping.spec.ts` | `FboTwoStageScreenTest`, `FboPackingProgressTest`, `FboScanStateTest` |
| Палет-сортировка | `pallet-sorting-session.spec.ts`, `pallet-sorting-stock.spec.ts`, `pallet-sorting-terminal-route.spec.ts` | `PalletSortingRestoreConsentTest`, `PalletSortingAutoSubmitTest` |
| Состав выпуска | `python -m unittest discover -s scripts/tests -p test_release_baseline.py` из `wms/` | verify → materialize → check-candidate; свежий image ID обязателен |

Android-тесты находятся в
`apps/android-tsd/app/src/test/java/pro/logoff/wms/tsd/`.
Для Python-тестов задать `BASELINE_TEST_TMP` каталогом внутри рабочей `work/`.

## Команды

Из `wms/apps/api/`: `node node_modules/vitest/vitest.mjs run --maxWorkers=1 --minWorkers=1`.
Некоторые интеграции требуют переменные тестовых БД; без них полный зелёный отчёт
не означает прохождение этих интеграций. Из `wms/apps/web/` — та же команда Vitest.
Из `wms/apps/android-tsd/` — `gradle :app:testLogoffDebugUnitTest`.
При затрагивании общего Android-кода добавить тесты других затронутых flavors.

Для проверки **собранного** API выставить абсолютные пути:

```text
FBS_RUNTIME_CONTROLLER=<candidate>/modules/tsd/tsd-device.controller.js
FBS_RUNTIME_ENTRY=<candidate>/modules/marketplace-connections/marketplace-connections.service.js
```

Запустить `tsd-fbs-capability.spec.ts` и `fbs-tsd-sticker-number.spec.ts`.
Кандидату нужны совместимые зависимости; не подменять его файлы локальными
ради успешного импорта. В PR фиксировать источник зависимостей и пропущенные проверки.

При каждой правке: тест воспроизводит проблему до исправления → проходит после →
общие тесты → сверка артефакта → PR → проверка опубликованного контейнера.
Физический результат на ТСД/принтере отмечать отдельно от автоматических тестов.
