# Индекс проверок

Подготовленный режим [счёта по сданным заявкам](billing-done-requests.md):
API `src/modules/billing/billing-done-requests.spec.ts` и `billing-period.spec.ts`,
web `BillingPeriodGenerationDialog.spec.tsx`; выключенный флаг, права, дата сдачи,
прежние даты услуг, общий черновик, смешанные/оплаченные документы, повтор и устаревший расчёт.

При изменении общей точки входа проверять все связанные строки, а не только новый
экран. Наличие имени в коде не заменяет вызов сценария. Production-данные не использовать
для тестовых записей/списаний. Интеграционные БД — отдельные, пропуски явно указывать.

| Изменяемая область | Проверки API (`apps/api/test/`) | Android / другие проверки |
| --- | --- | --- |
| FBS экран, capability, контроллер | `tsd-fbs-capability.spec.ts`, `fbs-tsd-sticker-number.spec.ts` — также на реальном runtime | `FbsAssemblyUiTest`, `OzonLabelSafetyTest` |
| Переклейка и её печать | `tsd-relabel-print.spec.ts`, `tsd-relabel-label.spec.ts`, `fbs-physical-kiz-relabel.spec.ts`, `pick-instruction-relabel-barcode.spec.ts` + предыдущая строка | `FbsRelabelExternalPrintActivityTest`, `FbsRelabelPrintUiTest`, `RelabelPrintGateTest`, `FbsKizRelabelTest` |
| Несколько единиц и последовательная сборка | `tsd-fbs-capability.spec.ts` с runtime-путями, `fbs-online-remaining-progress.spec.ts`, `fbs-box-scan-route-consistency.spec.ts` | `FbsSequentialPickTest`, восстановление после повторного ответа |
| Очередь заявок и роли | `fbs-lukin-batch.spec.ts`, `fbs-terminal-queue.service.spec.ts` | Owner/admin без лимита; сборщики — закреплённая пятёрка Лукина, другие клиенты без этого лимита |
| Остатки/резерв/маршрут | `fbs-stock-allocation.spec.ts`, `fbs-stale-rescan-reservation.spec.ts`, `fbs-picked-stock-proof.spec.ts`, `fbs-stock-transfer.spec.ts` | Сверить API и таблицу заявки; включить сценарий исходный/целевой SKU |
| Печать/подтверждение/списание | `fbs-print-order-scope.spec.ts`, `fbs-print-stale-kiz.spec.ts`, `fbs-print-ack-billing.spec.ts`, `print-job.service.spec.ts` | Повтор запроса не печатает/не списывает ещё раз; тестовый принтер только с разрешением |
| Автостатусы и уведомления | `fbs-request-auto-status.integration.spec.ts` на изолированной БД и candidate runtime | Сохранить ручной статус и поведение выключенного флага |
| FBO | `fbo-two-stage.integration.spec.ts`, `fbo-picked-reservation.spec.ts`, `fbo-archived-shipping.spec.ts` | `FboTwoStageScreenTest`, `FboPackingProgressTest`, `FboScanStateTest` |
| Палет-сортировка | `pallet-sorting-session.spec.ts`, `pallet-sorting-stock.spec.ts`, `pallet-sorting-terminal-route.spec.ts`, `pallet-sorting-admin-access.spec.ts`, `pallet-sorting-policy.spec.ts` | `PalletSortingRestoreConsentTest`, `PalletSortingAutoSubmitTest`; web `workspaces.admin-sorting.spec.ts`, `PalletSortingPanel.spec.tsx`; `owner-sorting-web-overlay.test.cjs` checks OWNER/ADMIN in actual menu and screen |
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

Запустить `tsd-fbs-capability.spec.ts`, `fbs-tsd-sticker-number.spec.ts`,
`tsd-relabel-print.spec.ts`, `tsd-relabel-routes.spec.ts` и `fbs-lukin-batch.spec.ts`.
Кандидату нужны совместимые зависимости; не подменять его файлы локальными
ради успешного импорта. В PR фиксировать источник зависимостей и пропущенные проверки.

При каждой правке: тест воспроизводит проблему до исправления → проходит после →
общие тесты → сверка артефакта → PR → проверка опубликованного контейнера.
Физический результат на ТСД/принтере отмечать отдельно от автоматических тестов.


la_panthera full coverage: web/test/build-la-panthera-coverage.cjs --check (47 component stylesheet inventory), la-panthera-contrast.browser.cjs (26 representative views; optional RUNTIME_CSS), la-panthera-hover.browser.cjs (scale/red gradient, stable neighbour, reduced motion, classic isolation). Browser fixtures do not substitute for an authenticated full-screen walkthrough.


## PR396: заявки и la_panthera

- `apps/api/test/client-requests.service.spec.ts`: архив DONE/CANCELLED/REJECTED, явный статус и доступные клиенты.
- `apps/web/src/components/client-requests/requestBatch.test.ts`: источники хранения, noBox только без источника, упаковка, частичные результаты.
- `apps/web/test/request-release.browser.cjs`: фактический runtime; архив, массовая сдача, сортировка, Excel, WB-статус, пантера при сетевой загрузке. Запуск с `RUNTIME_CANDIDATE` на проверенном каталоге кандидата.
- `apps/web/test/sidebar-groups.browser.cjs`, `sidebar-favorites.browser.cjs`: независимые группы и пользовательские быстрые ссылки.
- `apps/web/src/lib/networkLoading.test.ts`: параллельные fetch, чтение тела и ошибки.
- `apps/web/src/components/client-requests/requestZoneTones.test.ts`: большинство активных заказов, границы 12/19 часов, срочные равенства.

Публикация PR396: Web 328, API 2893, 8 baseline-тестов пройдены; пропуски 2/113, отдельная DB-серия KIZ исключена. Снимок `2026-09-29-request-batch-theme`, source parity false.


## PR400: форма, статусы и безопасная массовая сдача

- `apps/web/test/request-release.browser.cjs`: сворачивание всей формы в трёх темах, сохранение ввода, конкретный статус, цвета таймеров 1/15/20 часов и большинства shipped-заказов.
- `apps/web/src/components/client-requests/requestBatch.test.ts`: БЕЗ КОРОБА, единственный достаточный источник, неоднозначный/недостаточный остаток и сохранение выбора.
- `apps/api/test/request-stock-source.runtime.cjs`: фактический упакованный API; недостаточный остаток и незавершённая сборка запрещены без корректировок; достаточный источник разрешён; DTO сохраняет флаг.
- `apps/api/test/stock-operations.service.spec.ts`: те же ограничения на уровне исходников.

Web334/API2895 прошли; 2/113 пропущены, отдельная KIZ DB-серия исключена. TypeScript, браузерные сценарии и runtime-проверки прошли. Снимок `2026-09-29-request-polish`, source parity false.


## PR402: сверка и быстрые ссылки

`apps/web/test/reconciliation-theme.browser.cjs`: графитовый контейнер, заголовок/дата, пустое и заполненное состояния, другие темы и печать. `sidebar-favorites.browser.cjs`: переход без раскрытия группы, drag в обе стороны, клавиатура, сохранение порядка и изоляция пользователей; NAV_RUNTIME позволяет проверить фактический опубликованный адаптер. Web334/API2895 passed, 2/113 skipped; отдельная KIZ DB-серия исключена.


PR404: `apps/web/test/fbs-zone-colors.browser.cjs` — реальные CSS, три цвета кнопок/таймеров, hover, изоляция тем и печати, верхняя строка выбора и нижняя строка действий, компактная высота и перенос на 390px.

## PR406: ordinary picking, reviews and notifications

- `apps/api/test/ordinary-unmarked-pick.spec.ts`: new flag, complete/unmarked/SOS/source guards and found/packed labels.
- `fbs-request-auto-status.integration.spec.ts`: isolated PostgreSQL concurrent retry and all-or-nothing stock shipment; `FBS_RUNTIME_AUTO_STATUS_ENTRY` and `FBS_RUNTIME_ENTRY` repeat against published JS.
- `ordinary-pick.runtime.cjs`: image module loading and disabled-flag isolation; `tsd-fbs-capability.spec.ts` with `FBS_RUNTIME_CONTROLLER` passed all 11 tests on this runtime.
- `KizReviewQueuePanel.test.tsx`, `markAllNotifications.test.ts`: collapsed cases, seven days, complete pagination, new arrivals and partial failures.
- `reviews-notifications.browser.cjs`, `monitoring-notifications.browser.cjs`: actual adapter interactions and CSS; favorites regression also passed.
- Production public page: HTTP200 and zero JavaScript errors. Full hashes, health, APK216 and all preexisting flags verified.


## Compact request columns / all themes

- `apps/web/src/components/client-requests/ClientRequestColumns.test.tsx`: request identity/supply grouping and client above composition.
- `apps/web/test/compact-request-columns.browser.cjs`: actual release runtime; 11 themes, two request columns, combined due/status and actions/process, existing navigation/status callbacks, 390px mobile overflow. Set `RELEASE_ROOT` to the candidate release directory.
- Web/API general suites, TypeScript, baseline verify/materialize/check-candidate and exact web image hash delta before publication. API is unchanged.


## la_panthera Light

- `apps/web/src/components/layout/themeStyle.test.ts`: Dark default, user-isolated Light persistence, invalid/denied storage.
- `apps/web/test/la-panthera-light.browser.cjs`: 30 operational views, text contrast >=4.5:1, exact zone colours, Dark restoration and print exclusion.
- `apps/web/test/theme-style-runtime.browser.cjs`: actual packaged App, adjacent selector, persistence on reload, theme/user switches and selector fitting narrow header. Set RELEASE_ROOT to the release directory.
- `apps/web/test/build-la-panthera-light.cjs --check`: generated colour-only coverage remains current; images and print styles excluded. Palette tuning in la-panthera-light-tuning.css.

## Request action menus (our modern fulfillment contour)

- `RequestActionMenus.test.tsx`: FBO/FBS grouping, unique route, separate orders navigation, administrator-only recovery, legacy opt-out. Three regression assertions failed before the change.
- `test/request-action-menus.browser.cjs`: source and actual runtime React table (RELEASE_ROOT), 13 distinct callbacks with the same request ID, keyboard disclosures, 11 themes including la_panthera Dark/Light, terminal status and administrator restrictions.
- Enabled by existing `VITE_FBO_WORKSPACE_ENABLED`; no server workflow changes. Sold/legacy contour retains its original layout with the flag disabled.
- Web 347 passed / 2 skipped; API 2929 passed / 115 skipped. `kiz-duplicate.integration.spec.ts` requires a dedicated local database and was excluded after its missing-configuration failure. Web TypeScript passed.
- Published as PR414 after actual runtime browser checks, exact public/image hashes and health checks. API PR412 retained. Source/runtime parity remains false; use the surgical runtime release workflow.


## Request label wrapping and simplified menus

- `request-action-menus.browser.cjs`: long Novosibirsk title in a narrow column, no clipped title or overflowing action labels, 12 retained callbacks, 11 themes plus Light; source and actual runtime.
- `RequestActionMenus.test.tsx`: modern menu excludes manual stages and emergency controls even for administrators; legacy opt-out unchanged. Regression failed before the fix.
- CSS and existing runtime adapter only; no API changes.


## Approved request list and online menus

- `RequestActionMenus.test.tsx`: Online replaces Route; composition downloads move into Documents; manual, emergency, source-selection and standalone instruction actions removed from modern list.
- `onlineRequestToolbar.test.tsx`: original download callbacks, optional edit/cancel, unchanged status predicates, assembly body retained.
- `request-action-menus.browser.cjs`: source and actual runtime; 11 themes plus Light; eight retained list callbacks, online documents/WMS boxes/edit/cancel/refresh/close, denied actions absent, no clipped labels.
- Web351 passed/2 skipped; TypeScript passed. API unchanged.


## Four equal request menu rows

- Browser regression checks four vertically sequential controls, equal width/56px height, identical background/text colour, horizontal and vertical centering for FBS/FBO and all themes. Failed against PR416 before CSS fix. Existing keyboard and callback tests retained.
- CSS-only release; JavaScript/API/APK unchanged.

PR447: `fbo-plan-timeout.spec.ts` and `fbo-plan-timeout.runtime.cjs` cover concurrent plan reads, caller denial, retry/freshness, context isolation and bounded shipped-order lookup.

PR449: `fbo-route-decision-cache.spec.ts` / `.runtime.cjs`: snapshot-local decisions, all contained SKU demands, flag isolation and12 compiled ordering comparisons.

PR451: fbo-recovery-transaction-retry.spec.ts / .runtime.cjs cover external transaction ownership, unchanged ordinary retry and single outer receipt.

PR453: fbo-recovery-route.runtime.cjs verifies no route within recovery, unchanged ordinary route and409after bounded retries; real1568rollback smoke passed after publication.

kiz-unfinished-cancelled.runtime.cjs: cancelled never-shipped binding, physical proof, negative cases; previous kiz-released-review.runtime.cjs unchanged.


PR492: API3109/141 skipped, web390/2 skipped, Android454; exact runtime tests и браузерный smoke в scripts/releases/cabinet-fbo-20261007. [Ограничения](cabinet-export-and-fbo-placement.md).


PR494: API3118/141 skipped, web391/2 skipped, runtime5, actual browser и PostgreSQL rollback; kiz-duplicate.integration требует отдельной тестовой БД.


PR496: API3120/141 skipped, web394/2 skipped, runtime2, actual browser и PostgreSQL READ ONLY; kiz-duplicate.integration требует отдельной тестовой БД.
