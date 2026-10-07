# Откуда начинать работу с нашей WMS

Текущий выпуск: PR323, 26.09.2026. API
`sha256:1ce3f6acbfd09b562fcf48bd7a57cda6d6208c1f8f051e8baad8e5dbf413029f`.
Baseline `2026-09-26-relabel-close`; цепочка переклейки/актуализации №1323 проверена без записи в БД.
Web обновлён: явный поиск товарооборота без фоновой полной истории. APK215 и флаги сохранены.

Единственная рабочая папка на этом компьютере — `D:\WMSFF\_Kof` и её подпапки.
Не использовать прежний каталог OneDrive. Продукт находится в `wms/` относительно
корня этого Git-репозитория. Временные файлы — в `D:\WMSFF\_Kof\work`.

Перед изменениями читать [индекс](wms/docs/README.md),
[текущий выпуск](wms/docs/current-production.md) и
[порядок выпуска](wms/docs/release-workflow.md).
Старая рабочая копия или успешная сборка исходников не являются доказательством
соответствия production. Проверять актуальный image ID перед каждым выпуском.

Для нашей WMS фактическая интеграционная ветка на 25.09.2026 —
`feature/wb-print-check`, а не `main` и не номинальная `feature/our-vm`.
Новые изменения — отдельная `fix/` или `feature/` от согласованной актуальной базы,
затем тесты и PR. Не пушить непосредственно в интеграционную/защищённую ветку.
Не переключаться на `main`/`master`. Конфликты не разрешать без инструкции пользователя.
Проданная WMS не входит в baseline `our-wms`; не переносить туда его файлы и флаги.

Перед правками перечислить файлы/функции и влияние на проданную WMS. Для багов
добавлять воспроизводящий автоматический тест, проверять его до/после исправления.
До коммита выполнять необходимые тесты; пропуски указывать отдельно.
Не расширять рефакторинг за пределы задачи.

При изменении FBS/переклейки/печати обязательно проверять одновременно:
передачу capability через контроллер, экран без наклейки заказа, счётчик Ozon,
последовательный отбор WB, отдельную печать целевого ШК. Тестировать фактический
собранный артефакт. Проверка только TypeScript уже пропускала регресс.

Снимок `wms/baselines/our-wms/2026-09-26-relabel-close` сохраняет runtime после PR323 (закрытие переклейки и поиск товарооборота; маршруты FBS и Ozon215 сохранены):
новый маршрут к исходному коробу сохранён, потерянная печать восстановлена.
Он не означает завершённого сведения TypeScript с runtime: `sourceParityVerified=false`.
Не заменять production полной локальной сборкой до отдельной сверки расхождений.
Проверка `release_baseline.py check-candidate` обязательна для выпусков от этого
снимка; при новой серверной версии сначала обновить проверенную базу.


Latest verified release: PR326, ФОТ. Baseline `wms/baselines/our-wms/2026-09-26-payroll`. API `sha256:9228a39f63d7ea929418635d9b1564cacb560a18eae8b2b00d47def3720d7a53`, web `sha256:21fab23236192311d421c4ae8bf170a32caee99c6e9aa2ce58d4f004ba3bbc15`. APK215 unchanged; WMS_PAYROLL_ATTENDANCE_ENABLED=true only on our WMS. Eight additive Payroll tables; historical import completed with August row48 excluded. Source parity remains false.


Latest verified release: PR328, payroll navigation and audited time corrections. Baseline `wms/baselines/our-wms/2026-09-26-payroll-navigation`. API `sha256:a9684a191ca599ba7180c769fc5d33e9583af885ff794426c7d4765d9117cb7f`, web `sha256:33e9a07f126cbccc9804ea1af0e270175d1c8d1829063df629233ad5940f6097`. APK215, flags and historical payroll records unchanged. Source parity remains false.

Latest verified release: PR330, payroll payment summary. Baseline `wms/baselines/our-wms/2026-09-26-payroll-payment-summary`. Web `sha256:e9dcce013f1ca121d7c05ca2a89e7a91175bda42c65c2b7e1d0bce96481065c4`; API/APK/flags unchanged. Source parity remains false.

Latest verified release: PR332, payroll editor, dates and sorting. Baseline `wms/baselines/our-wms/2026-09-26-payroll-editor`. Web `sha256:693a0d1f72469302bd77233790260e31de44a9621a9411c19cdf335930342f57`; API export module updated; APK/flags unchanged. Source parity remains false.

Latest verified release: PR334, payroll employee card. Baseline `wms/baselines/our-wms/2026-09-26-payroll-card`. Web `sha256:f71d461f6762387b3ef16471e0862daf0bda734e4ee76b530a86e9026007bd64`; API/APK/flags unchanged. Source parity remains false.

Latest verified release PR337 (27.09.2026): administrator physical KIZ resolution. Baseline `wms/baselines/our-wms/2026-09-27-admin-physical-kiz`; API `sha256:8d84800a7dbc197451799055bb3b0659dd1dd1a0f57b94cbf3e7963c7f8fc921`. Two inventory modules changed, WMS_INVENTORY_PHYSICAL_RESOLUTION_ENABLED=true only on our WMS. All other flags, web and APK215 preserved. Source parity remains false.

Latest verified PR339: baseline `wms/baselines/our-wms/2026-09-27-completed-fbo-history`, API `sha256:487a1cb0235e22d037643835be01f9e320243a9f97949d80b2a185afc06368f5`. Completed FBO history no longer blocks physical inventory confirmation. One runtime helper changed; flags/web/APK unchanged.


Published PR341 (27.09.2026): own ADMIN/OWNER ACCEPT_AS_IS now permits FBS continuation when the privileged picker personally accepted unchanged system stock. API `sha256:dbc95e8faadbb7188e4637a41ef95b55d336977ea1e7f02367f33f455570afc0`; baseline `2026-09-27-admin-accept-audit`. Existing our-WMS flag only; two runtime modules (validator and authenticated-role call-site). Saved BOX294 acceptance passed read-only on candidate and production; WORKER rejected. API2870, web247, TypeScript passed; 97 skipped, dedicated DB suite unavailable. Stock, KIZs, web, APK215 and other containers unchanged. Source parity false. Rollback `logoff-api:before-admin-accept`.

Latest verified release: PR343, tablet attendance. Baseline wms/baselines/our-wms/2026-09-27-attendance343. API sha256:d67de6f69a8ebd5902a913be8662f67ab0e79b6c8d775dc9987bcf8ea13b8c90; web sha256:597d5e296a51dcbf0d353321461255d3c55e4b8de0225f2732afdbfaf955e71b. New Attendance tables and sequence, WMS_ATTENDANCE_DEVICE_ENABLED=true only on our WMS. Previous flags and APK215 unchanged. API2885/web248/Android72 tests, server rollback smoke and runtime hashes passed; physical camera pending. Source parity remains false.

Latest verified release PR348: baseline `2026-09-28-kiz-sorting`; API `sha256:9a3ec430469e30afeb1620b1a75852815976eba477325d5c06fcb9778313a9a9`. Two KIZ modules only, sorting admin reuse flag enabled; other services preserved. 30 runtime tests and actual-unit read-only proof verified; physical scan pending.


Latest verified release PR356: baseline `wms/baselines/our-wms/2026-09-28-inventory-weekly`; API `sha256:882d31805242c776406f5f9fb8ed7e6887a33b07be9343c9abe14457dcc89c6c`, web `sha256:0c52bd5273ae6e32eaeefe356bcb71e6440e3e266e3b50a4f21815ef01b6eba2`. Weekly inventory review, descriptive KIZ errors, positive locations only. Existing flags and APK215 unchanged; sold WMS untouched; source parity false.


Latest verified release PR358: baseline `wms/baselines/our-wms/2026-09-28-client-display`; API `sha256:09a4f4cc84a4ad1bb08279f8c2c236ab679accf7f1a50131c8e990647cd10cfb`, web `sha256:d204e622e626f793f63d733fa9efea41e701f3f77d2e10a506f8c8a138c83d59`. Client product display for assembly/packing, APK216. Existing flags preserved; new display flag true only on our WMS; sold WMS untouched; source parity false.


Latest verified release PR364: baseline `wms/baselines/our-wms/2026-09-28-cabinet-fast`; API `sha256:2c5e58b7d57ac148e1bb8e6068c305b52679210eba74a68f8d2401da8a6a5ea2`, web `sha256:ebd933aef735ee17d2721121a939c715797c14c7e958fbdd7f1abff9f9cc358c`. Cabinet-only compact responses and expanded product display settings at the top. Existing flags and APK216 unchanged; sold WMS untouched; source parity false.


Latest verified web release PR374: baseline `2026-09-28-la-panthera`. Web sha256:5cee65f8c9b91255ee1beb174ef3c232942dfa51559d22c8e457181da47ca570; API sha256:d503835845d4684bb5388552dc9304aa4cfd61e71b40bb3f1b393247bc8a9b2c unchanged. la_panthera opt-in theme and bundled Inter. APK216/sold WMS unchanged; source parity false.


Latest verified web release PR377: baseline `2026-09-28-la-panthera-contrast`. Web sha256:e0c20c3932d110e206e3e7c85748f2dcca61193029e542d6657ad1765258f20d; API sha256:a83204a8bb4819193a11ba7ba8a3b462c960ef772fc9d659c88a122dfd531f62 unchanged. la_panthera opt-in theme and bundled Inter. APK216/sold WMS unchanged; source parity false.


Latest verified web release PR381: baseline `2026-09-28-la-panthera-complete`. Web sha256:97781c96c22ef56db57f31f301477b164cde4b525da76e8d5025e5cb19da16dc; API sha256:a83204a8bb4819193a11ba7ba8a3b462c960ef772fc9d659c88a122dfd531f62 unchanged. la_panthera opt-in theme and bundled Inter. APK216/sold WMS unchanged; source parity false.


Latest verified web release PR385: baseline `2026-09-28-panther-loader`. Web sha256:d6670224e2817dbcd893912ac1ae5ed773a10771b58c3dcec3278a026d2aae48; API sha256:a83204a8bb4819193a11ba7ba8a3b462c960ef772fc9d659c88a122dfd531f62 unchanged. la_panthera opt-in theme and bundled Inter. APK216/sold WMS unchanged; source parity false.


Latest verified release PR396: baseline `2026-09-29-request-batch-theme`. Web sha256:2262deb8564c040b6186b4c4016e738fd4cf7f56a1796d547a6b9ebc6fee7248; API sha256:7334f195b90d4d8e4f4915993974511c8ce49b3198f6a46569b0edabd799b2db. Request archive/bulk actions in all themes; navigation/visual changes opt-in la_panthera. APK216/sold WMS unchanged; source parity false.


Latest verified release PR400: baseline `2026-09-29-request-polish`. Web sha256:6fb21ea4193cd208c1a989ea81b41b87a1cba9ea928394738611091360c171c0; API sha256:277d5a2c9c5dc21acb28df6d4197688cdb81c4bbf3ca8db4290a5340d855986b. Request archive/bulk actions in all themes; navigation/visual changes opt-in la_panthera. APK216/sold WMS unchanged; source parity false.


Latest verified release PR402: baseline `2026-09-29-reconciliation-navigation`. Web sha256:e17e49f27e77dce52f86e18386cf8fc29d9bd3e1102e181ad059c00d036f1fc9; API sha256:277d5a2c9c5dc21acb28df6d4197688cdb81c4bbf3ca8db4290a5340d855986b. Request archive/bulk actions in all themes; navigation/visual changes opt-in la_panthera. APK216/sold WMS unchanged; source parity false.


Latest verified release PR404: baseline `2026-09-29-fbs-zone-colors`. Web sha256:95ef7bb7954cf2ff21060cfcd25f408b455158f41b97109ee09cc9b78086fa71; API sha256:277d5a2c9c5dc21acb28df6d4197688cdb81c4bbf3ca8db4290a5340d855986b. Request archive/bulk actions in all themes; navigation/visual changes opt-in la_panthera. APK216/sold WMS unchanged; source parity false.


Latest verified release PR406: baseline `2026-09-29-ordinary-pick-reviews`. Web sha256:299f32d7fb3eb66ab08bc4bb22bb870226cf3d9250e628ba03090ad658ea7034; API sha256:aba843bb78a45c4a1f06a25315f53210b8eaad6992d44f1bc02dfff97a8208e5. Request archive/bulk actions in all themes; navigation/visual changes opt-in la_panthera. WMS_FBS_UNMARKED_PICK_CLOSE_ENABLED=true only on our WMS; APK216/sold WMS unchanged; source parity false.


Latest verified release PR408: baseline `2026-09-29-compact-request-columns`. Web sha256:4d3bb184e13764d8bfbced614cb042986b24c4da16b1174e37889afc43c6f771; API sha256:aba843bb78a45c4a1f06a25315f53210b8eaad6992d44f1bc02dfff97a8208e5. Compact request columns in every theme; API and previous behavior unchanged. APK216/sold WMS unchanged; source parity false.


Latest verified release PR410: baseline `2026-09-29-la-panthera-light`. Web sha256:eb0e9d15040e6512d3363ec3d87f99c2c280c9d47f709be4886cb244332880bb; API sha256:aba843bb78a45c4a1f06a25315f53210b8eaad6992d44f1bc02dfff97a8208e5. Opt-in Dark/Light style for la_panthera; API and previous behavior unchanged. APK216/sold WMS unchanged; source parity false.


Latest verified PR412: baseline `2026-09-29-kiz-physical-review`; API `sha256:78c06803de1b44099824175217cceb2e6899066de9e485cc6954971b49691957`. PR412: explicit administrator/owner KIZ reuse with a later audited physical sorting return when historical WB status is unavailable. Two API modules only. WMS_KIZ_PHYSICAL_REVIEW_ENABLED=true only on our WMS. Runtime tests33, API2929/web343 passed;115/2 skipped; isolated PostgreSQL suite excluded. API TypeScript passed. Live physical proof verified read-only. Exact runtime hashes, health, flags and unchanged web/APK/other containers verified. No business records changed. Source parity false. Rollback logoff-api:before-kiz-physical-review.


Latest verified release PR414: baseline `2026-09-29-request-action-menus`. Web sha256:fe944ebb4ba1486f1284e91a6dfae3f2aa529ece11e69943299bd413ef217a4e; API sha256:78c06803de1b44099824175217cceb2e6899066de9e485cc6954971b49691957. Compact FBO/FBS action menus; API and previous behavior unchanged. APK216/sold WMS unchanged; source parity false.


Latest verified release PR416: baseline `2026-09-29-request-wrap`. Web sha256:83443774025472e37c58d4ef7249bf7219088a84117f49d95b8310c7b3bbb227; API sha256:78c06803de1b44099824175217cceb2e6899066de9e485cc6954971b49691957. Approved simplified list/online menus and full label wrapping; API unchanged. APK216/sold WMS unchanged; source parity false.


Latest verified release PR418: baseline `2026-09-29-request-four-rows`. Web sha256:124f6f71375505e845600ce174efc7fb4aefb7c66474133513bb78bfb7f4a958; API sha256:78c06803de1b44099824175217cceb2e6899066de9e485cc6954971b49691957. Four equal centered menu rows; CSS only; JS/API unchanged. APK216/sold WMS unchanged; source parity false.


Latest verified release PR420: baseline `2026-09-29-fbs-equal-tiles`. Web sha256:bab947a845a51d3a02eef205658b2114474e9eef11bd725b754c58d0c533a438; API sha256:78c06803de1b44099824175217cceb2e6899066de9e485cc6954971b49691957. Equal-height FBS navigation tiles; CSS only; JS/API unchanged. APK216/sold WMS unchanged; source parity false.


Latest verified release PR422: baseline `2026-09-29-fbo1550-route`. API sha256:ff9265aa3b693bba2038053967ba690dcac36d325ec621eb7265a746e3fd348a; web unchanged. Scoped remaining-route preference for request1550 only; picked/packed progress unchanged. No DB migration; one audited SystemSetting. APK216/flags/sold WMS unchanged; source parity false.


Latest verified release PR424: baseline `2026-09-29-payroll-compact`. Web sha256:0b41f6ce4ae558cee000289e724e41acfb3cb48f436fd9f94d3a43213fe8ecf0; API sha256:ff9265aa3b693bba2038053967ba690dcac36d325ec621eb7265a746e3fd348a. Compact attendance editor; handlers/API unchanged. APK216/sold WMS unchanged; source parity false.

Latest API baseline PR431: 2026-09-30-kiz-released-review; sourceParityVerified=false. RELEASED physical-return review only, single API module; web and sold WMS unchanged.

Latest API baseline PR433: 2026-09-30-fbs-active-bootstrap; sourceParityVerified=false. Active FBS bootstrap and canonical shipment identity; one-module exact delta, web/APK/sold WMS unchanged.

Latest API baseline PR435: 2026-09-30-fbs-saved-names; sourceParityVerified=false. Saved warehouse names, exact single-module delta. Web/APK/sold WMS unchanged.


Latest verified release PR437: baseline `2026-09-30-panthera-windows`. PR437: opt-in la_panthera operational windows retain the current page, minimize to one right-edge dock and preserve forms across navigation. WB tiles2-15 are square, tile1 spans two rows with clients; narrow screens reflow. Web355/API2939 passed, 2/115 skipped; dedicated KIZ DB suite excluded. TypeScript, before/after browser regression, actual runtime and published Requests/FBS/FBO smoke passed. API/APK/flags/sold WMS unchanged. Concurrent Soul card CSS retained. Source parity false. Rollback logoff-web:before-panthera-windows.


Latest verified release PR439: baseline `2026-09-30-panthera-multi`. PR439: la_panthera minimize control aligned in the existing action toolbar. Separate retained instances allow multiple independent request windows from one workspace. Browser tests reproduce old misalignment and verify separate drafts, restore/close and theme isolation. Web355/API2939 passed, 2/115 skipped; dedicated KIZ DB suite excluded. TypeScript, actual runtime and published section smoke passed. API/APK/flags/sold WMS unchanged; source parity false. Rollback logoff-web:before-panthera-multi.


Latest verified release PR442: baseline `2026-09-30-receipt-channel-event`. PR442: receipt channel/membership changes atomically invalidate WB stock plans through the durable existing queue. API3010 passed/83 skipped; TypeScript and exact one-module delta verified. Web/APK216/flags/sold WMS unchanged from PR441. Source parity false. User-authorized FBO-only directions applied to FFL_LKB2409 (with ten corrected memberships) and current FFL_LKB2709; no physical stock movements, nine archived boxes preserved. Old active FBS order access retained.

Latest API release PR447: baseline2026-10-02-fbo-plan (API only), sourceParityVerified=false. Bounded WB links and coalesced FBO reads; flagWMS_FBO_PLAN_COALESCE_ENABLED=true only on our WMS. Web/APK/sold unchanged. See current-production.md for test limitations and verification.

Latest API PR449 baseline2026-10-02-fbo-cache: snapshot-local box-decision reuse. Full request1626 handler with Konstantin permissions2247ms after deployment;496boxes unchanged. Source parity false; see current-production.md.

Latest API PR451 baseline2026-10-02-fbo-recovery-retry: administrative retry after rollback, ordinary actions unchanged. Source parity false; see current-production.md.

Latest API PR453 baseline2026-10-02-fbo-recovery-route: omit discarded routes during recovery, bounded retry with409. Actual1568preview/apply rolled back successfully after publication; source parity false.

Latest API PR457: baseline `2026-10-02-fbo-finish-catalog`; opt-in unchanged billing catalog reads during FBO FINISH. Both request1568 completion paths and exports verified with mandatory rollback. Source parity false; web/APK/sold WMS unchanged. See current-production.md.

Latest API PR461: baseline2026-10-03-kiz-unfinished-release, physical review of cancelled never-shipped KIZ. Source parity false; see current-production.md.


Latest verified release PR485 / 05.10.2026: LOGOFF APK217 separates whole-box and partial FBO picking. Baseline `wms/baselines/our-wms/2026-10-05-fbo-picking-217`; API/web application/flags/sold unchanged. Android216 base reproducible; 678 tests passed; signature and public SHA verified. API source parity remains false. See current-production.md.


Latest verified release PR488 / 06.10.2026: payroll filtered summaries, employee/time/cargo corrections and guarded audit undo. Baseline `wms/baselines/our-wms/2026-10-06-payroll-corrections`. WMS_PAYROLL_CORRECTIONS_ENABLED=true only on our WMS. Five API modules changed, schema/APK/sold unchanged; sourceParityVerified=false. See current-production.md.


Latest verified PR492: baseline 2026-10-07-cabinet-fbo, sourceParityVerified=false. Cabinet export audit and recent FBO receipt placement; APK218. Flags/schema/sold unchanged. See current-production.md.


Latest verified PR494: baseline 2026-10-07-receipt-approval, sourceParityVerified=false. Client receipt approval enabled only for Lukin / FF Moscow. Existing 29 receipts grandfathered; storage physical quantities unchanged. APK218/sold unchanged. See current-production.md.
