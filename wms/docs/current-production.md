# Published PR334: payroll employee card / 26.09.2026

API unchanged: `sha256:91f592f9ea0420cecefd508b0c3bf64c9ffc1385d35070fe3d601a3832896cd6`. Web: `sha256:f71d461f6762387b3ef16471e0862daf0bda734e4ee76b530a86e9026007bd64`.
Independent settings selection; card opens in view mode with edit/save/cancel. Current rates and individual conditions shown independently of report dates. Web246 tests, TypeScript and actual overlay browser checks passed. Exact live API/web/APK/flags verified. Baseline `2026-09-26-payroll-card`. Source parity remains false. Rollback web: `logoff-web:before-payroll-card`. No API/database/APK changes.

## Previous release

# Published PR332: payroll editor, dates and sorting / 26.09.2026

API: `sha256:91f592f9ea0420cecefd508b0c3bf64c9ffc1385d35070fe3d601a3832896cd6`. Web: `sha256:693a0d1f72469302bd77233790260e31de44a9621a9411c19cdf335930342f57`.
Employee card/rate isolation, explicit save messages, all-staff sorting and dd.mm.yyyy in UI/exports. Web245, API2844 passed/97 skipped; KIZ integration suite excluded because its local DB is not configured. TypeScript/build and actual candidate browser/export checks passed. Exact live API/web/APK/flags verified. Baseline `2026-09-26-payroll-editor`. Source parity remains false. Rollback web: `logoff-web:before-payroll-editor`. Single API export delta; APK unchanged. Imported 17 September handling operations / 30750 RUB with payment REVIEW; historical hourly entries preserved.

## Previous release

# Published PR330: payroll payment summary / 26.09.2026

API unchanged: `sha256:a9684a191ca599ba7180c769fc5d33e9583af885ff794426c7d4765d9117cb7f`. Web: `sha256:e9dcce013f1ca121d7c05ca2a89e7a91175bda42c65c2b7e1d0bce96481065c4`.
Employee name, period amount and payment phone/bank shown together; paid/unpaid/review distinguished. Web244 tests, TypeScript and browser fixture passed. Exact live API/web/APK/flags verified. Baseline `2026-09-26-payroll-payment-summary`. Source parity remains false. Rollback web: `logoff-web:before-payroll-payment-summary`. No API/database/APK changes.

## Previous release

# Published PR328: FOT navigation and corrections / 26.09.2026

API `sha256:a9684a191ca599ba7180c769fc5d33e9583af885ff794426c7d4765d9117cb7f`.
Web `sha256:33e9a07f126cbccc9804ea1af0e270175d1c8d1829063df629233ad5940f6097`.
Standalone FOT submenu, back navigation, explicit manual entry, start/end columns and audited editing of historical/manual times. Paid records must be reviewed before correction. No migration or historical data changes. Verified 31 cards, 1263 rows, total 354401550 kopecks; PDF/Excel and branch isolation passed. API2844 passed/97 skipped, web242, TypeScript and browser regression checks passed. APK215 unchanged.
Baseline `2026-09-26-payroll-navigation`; source parity remains false. Rollback: `logoff-api:before-payroll-navigation`, `logoff-web:before-payroll-navigation`.

## Previous release

# Published PR326: ФОТ / 26.09.2026

API `sha256:9228a39f63d7ea929418635d9b1564cacb560a18eae8b2b00d47def3720d7a53`.
Web `sha256:21fab23236192311d421c4ae8bf170a32caee99c6e9aa2ce58d4f004ba3bbc15`.
New workforce module enabled only on our WMS. Additive migration `20260926150000_payroll_attendance`. Imported 1263 historical rows into ФФ Москва, total 3,544,015.50 RUB; August row48 excluded, name aliases pending. All monthly totals reconciled. API2841 passed/97 skipped, Web240, TypeScript, browser and runtime/export/access checks passed. APK215 and other containers unchanged.
Baseline `2026-09-26-payroll`; source parity remains false. Rollback images: `logoff-api:before-payroll-attendance`, `logoff-web:before-payroll-attendance`. Rollback retains new payroll data/tables.

## Previous release

# Published PR323: turnover / 26.09.2026

API `sha256:1ce3f6acbfd09b562fcf48bd7a57cda6d6208c1f8f051e8baad8e5dbf413029f`.
Web `sha256:3695f20eab55822b447412a77adf06be31bec7ee229ed65b8daa0434d48358fd`.
Relabel/recount proof without duplicate deduction; no automatic full-history load and stale responses ignored. APK215, flags, database and other containers unchanged. API2815 passed/94 skipped, Web238, TypeScript passed; runtime delta and public hashes verified. Baseline `2026-09-26-relabel-close`; source parity remains false.
Rollback: `logoff-api:before-turnover-relabel`, `logoff-web:before-turnover-relabel`.

## Previous release

# Published PR321: turnover / 26.09.2026

API `sha256:16ed6b5fb0440b41b1093e6ae4748e486feffad7b9185e8c53b41cc45933a326`.
Web `sha256:d6cd84011bca7995d92eabd27785c16fd71d3549e6ca1e64e46fedba74f31b05`.
Boxless deduction, archived current-stock exclusion, independent stock/statistics loading. APK215, flags, database and other containers unchanged. API2806 passed/94 skipped, Web236, TypeScript passed; runtime delta and public hashes verified. Baseline `2026-09-26-turnover`; source parity remains false.
Rollback: `logoff-api:before-turnover-321`, `logoff-web:before-turnover-321`.

## Previous release

# Published PR319: direct FBS reserved box route

API `sha256:e86c2e3beee1fcee76e5833a45c9c572338be740156501d01470a1a0881d75a2`. Published 25.09.2026 23:33 MSK.
Only tsd-assembly.service.js changed; environment, web and APK215 unchanged.
Request 1368 / order 5864079913 verified against real instruction: 1 unit, FFL_LKB0909_356, PALET_SORT_140.
2801 API tests passed, 94 skipped; TypeScript and four candidate route tests passed.
Baseline `2026-09-25-direct-route`; sourceParityVerified=false. Rollback `logoff-api:before-fbs-direct-route-319`.

## Previous releases

# Current published release PR317: bounded FBS box scans

API `sha256:45d6c29e16eb49035603749f58ef0272fa3e414eea269a5ee3f0a7f9bbe4acf4`. Published 25.09.2026 22:25 MSK.
`WMS_FBS_BOX_SCAN_BOUNDED_ENABLED=true`; all other environment and containers unchanged. Web/APK215 retained. Baseline `2026-09-25-fbs-box-scan`; sourceParityVerified=false. Runtime hash set and health verified. Rollback: `logoff-api:before-fbs-box-scan-317`.

## Earlier releases

# Current published release PR315 / LOGOFF215

API `sha256:a72064a45a06563f59e1051dbf1feddec037683685fb9f73dc061c3f3c58d00f`.
Web `sha256:a70b61112fc7c03ba29eacb86ccc249c6ec7dfb16b34fca3dd8e5c432c05d756` (public site preserved, APK downloads only).
APK215 SHA256 `405e13998427f8dd2b24f03d7cb89d99997a3eba9410486fe21f4a6cd11e38fd`.
Baseline: `2026-09-25-ozon-lines`. Migration applied; `WMS_OZON_MULTILINE_PICKING=true` only on our WMS. 46 runtime tests; public hashes and health verified. Terminal installation not verified. Source parity remains false.

## Historical releases

# Current published release PR313: light public website / APK214 unchanged

Web image: `sha256:41c8224ac636afde20e72e3123d640093ada1e447e3af43d1f9f74000709cde3`.
API remains `sha256:57c41c094bf9e3e45eea8adca8e7d666b17cc2f24432b52cbb149b6e1c5f2cf6`.
Only the external MarketingLanding component changed. All pre-existing public
assets/downloads retained; operational JS unchanged except consistent versioned ESM URLs.
Public page, mobile menu and login entry verified. 234 web tests, TypeScript,
7 release guard tests passed. API container and APK unchanged.
Web overlay: `baselines/our-wms/2026-09-25-public-site-light`; combine with the
PR311 web baseline, never replace current web with the earlier archive alone.
API baseline remains `2026-09-25-fbs-display`; sourceParityVerified remains false.
Rollback image: `logoff-web:before-public-light-20260925`.

## Previous published release PR311 / APK214

API sha256:57c41c094bf9e3e45eea8adca8e7d666b17cc2f24432b52cbb149b6e1c5f2cf6
Web sha256:475778f6b2d1fd9b51378d9c0db682d2f0f8345acfb69c64451cc4beedb4c18f
APK214 de67aee47f3f419e8e89e4a4a13974f945f988d9bd58bb51a4fd6e7261e771aa

Historical release notes below. Current baseline: 2026-09-25-fbs-display.

# Current release: PR309, 25.09.2026

[PR309](https://github.com/Maxhead2011/wmsFF/pull/309), merge adb8d2ca. Bounded 30-second inventory confirmation. Six runtime tests; API 2761 passed / 94 skipped. All previous KIZ and printing changes retained.

# Опубликованная база нашей WMS

Обновлено **25.09.2026 после PR307**. Интеграционная ветка `feature/wb-print-check`.
[PR307](https://github.com/Maxhead2011/wmsFF/pull/307), merge `3c20d0e5`.
Это привязка точечного выпуска, а не заявление о полном совпадении исходников с runtime.

| Компонент | Фактическая версия |
| --- | --- |
| API image | `sha256:edaed8c4b41b55a5cda87a4590dc0b32d5a6f2e667ed0627e22e0f3137426444` |
| Web image | `sha256:5bdcb162e03f2539795b379bcdc6644888e07fc7dcdbfc9456ed93c254a5193d` |
| Android LOGOFF | `213 / 0.1.213-relabel-external-print` |
| APK SHA-256 | `2537deeaa0079d3cf121132e1d42efff32c7e5e636f1e40509e144ee8ff8a295` |

PR307 меняет только три модуля КИЗов: отменённая принятая поставка допускает решение администратора при неизвестном погашении. Продажа и погашение блокируются. Проверки: 18 runtime, API 2763 passed / 92 skipped; DB-интеграция исключена. Остальные файлы после PR305 сохранены по хешам.

Текущий [снимок](../baselines/our-wms/2026-09-25-fbs-display/README.md) сохраняет
последний выпуск с маршрутом WMS к исходному коробу и восстановленной печатью.
В промежуточном API `be2a182a...` снова потерялись функции PR302 и маршруты/DI
переклейки. PR305 восстановил три файла, остальные 530 файлов API и весь web
оставлены без изменения. APK 213 не пересобирался. Старые снимки сохранены.

Проверки PR305: API 2761 passed / 94 skipped (kiz-duplicate.integration исключён
без тестовой БД), runtime 33, baseline guard 8. Health и wiring работающего
контейнера проверены, станция 2409 онлайн. Новая физическая печать после PR305
пока не подтверждена. [Описание](releases/relabel-regression-after-213/README.md).

PR302 восстановил потерянные вызовы контекста и очереди печати переклейки, а также
закреплённую пятёрку Лукина. APK 213 разрешает скан нового ШК без ACK станции.
ADMIN/OWNER видят все заявки. Текущая пятёрка не пополняется до полного завершения.

Проверки PR302: API 2754 passed / 94 skipped; DB-dependent kiz-duplicate.integration
не запускался без тестовой БД. Android LOGOFF 216, FFULLHAB 216; runtime 26;
baseline guard 8. Подпись APK совпадает с 212, health и публичные хеши проверены.
**Сборка 213 принята пользователем 25.09.2026:** «все заработало, проверили на трех
последовательно обновленных тсд». Это успешная отправная точка для следующих
изменений нашей WMS. Подтверждение относится к проверенному рабочему сценарию,
а не ко всем возможным функциям системы.
[Детали и состав исправления](releases/relabel-print-runtime-context/README.md).

## Что подтверждено

- Пользователь после PR300: «озон работает корректно».
- Реальный контейнер: capability нового ТСД проходит через 9 действий сборки.
- Проверка артефакта: ответ Ozon без вызова загрузчика наклейки, счётчик единиц,
  блокировка преждевременного завершения; сохранена последовательная сборка WB.
- Android: 215 тестов; API: 2750 прошли, 94 пропущены; web: 227 прошли;
  runtime: 12 проверок. Пропуски не считаются успехом. БД-интеграции требуют
  отдельной тестовой БД. Эти результаты относятся к PR300.
- Настройки `WMS_TSD_PHYSICAL_PICK_CONFIRMATION`, `WMS_OZON_TSD_UNIT_SCANS`,
  `WMS_FBS_SEQUENTIAL_PICK_ENABLED` включены. Полный список **булевых** WMS-флагов
  находится в манифесте; секретная конфигурация туда не включена.

## Что ещё не сведено

`sourceParityVerified=false`. Историческая сверка перед PR302 показала:

| Слой | Только на сервере | Только локально | Различаются | Совпадают |
| --- | ---: | ---: | ---: | ---: |
| Активные TypeScript-файлы API | 80 | 14 | 52 | 398 |
| API runtime относительно локальной сборки | 80 | 11 | 46 | 407 |

Контейнерные исходники также не равны исполняемому коду автоматически.
Веб/Android исходники не объявляются воспроизводимыми по одному номеру версии.
Схемы и миграции сохранены как файлы; состояние применения миграций в БД этим
снимком не подтверждается. Снимок не является резервной копией БД или Docker image.

Следующие изменения начинают с сохранённого runtime и явно проверяемого изменения
нужных файлов. Для перехода к полной сборке из TypeScript нужно отдельно переносить
и тестировать расхождения по модулям; массовая подмена текущих исходников серверной
папкой не выполнялась. Проверка состава выпуска ловит потерю файлов, но не заменяет
поведенческие тесты внутри намеренно изменяемого файла.

Проданная WMS не обследовалась и не обновлялась. У неё отдельная база и конфигурация.
