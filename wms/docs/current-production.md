# Опубликовано PR512 / 08.10.2026 — компактная упаковка ФБО, APK219

[Сценарий](fbo-compact-packing.md), [запись выпуска](releases/fbo-compact-packing-20261008.json).
API `sha256:e45f6338a89e1fbe08e878d80811bf5209a11ce397c5f94140ed4a6f9276718c`; web `sha256:835462a2792073b16ee3b9352edc7022b4ee14ca001f8ee42f8bbd30ecbd7232`.
Baseline `2026-10-08-fbo-compact-packing`, sourceParityVerified=false.
WMS_FBO_COMPACT_PACKING_ENABLED=true только нашей ВМС. APK219 с прежней подписью
нужно установить поверх текущего приложения; старые ТСД совместимы.
После подтверждения упаковки передаются абсолютные счётчики и короба без всей
истории КИЗов; поле сканирования сохраняется. Отбор/ФБС/проданная ВМС не изменены.
3156 API тестов, по232 Android теста в6 вариантах,2 runtime проверки прошли.
API141 пропущены, отдельный KIZ integration исключён. Сверка с откатом совпала:
1462977→82487 байт,136→26мс формирования ответа. Это не физический scan-to-ready замер.
Проверены health, хеши API/пакета, подпись APK и сохранность остальных флагов.
Миграций и изменений складских данных нет. Откат: logoff-api:before-compact-packing-20261008,
logoff-web:before-compact-packing-20261008 и прежнее значение флага.

# Опубликовано PR509/510 / 08.10.2026 — индекс доступности приёмок

[Схема и проверки](receipt-stock-index.md), [запись выпуска](releases/receipt-stock-index-20261008.json).
API `sha256:5725c2d33e7548b431b1e3fdaa8c004a951a04c17692d804d6f5079dee28d6e3`. Baseline `2026-10-08-receipt-stock-index`, sourceParityVerified=false.
WMS_RECEIPT_STOCK_INDEX_ENABLED=true только на нашей ВМС. Добавлена таблица
ReceiptStockIdentity и транзакционные триггеры; физические остатки не изменены.
Web/APK218/остальные флаги/проданная ВМС сохранены.
Сверка постоянного индекса: 319 недоступных коробов, 1421 правило, весь план ФБО
совпали со старым расчётом. План 5339→1717 мс; проверки короба ФБС 29–77→4–6 мс.
Это компоненты сервера, не время полного сканирования. API3149/web398 прошли;
API141/web2 пропущены, отдельный KIZ DB suite исключён. Миграция и конкурентные
записи проверены в отдельном PostgreSQL. Первая миграция откатилась по таймауту;
исправленная групповая загрузка завершилась. Откат API: logoff-api:before-receipt-stock-index-20261008.

# Published PR507 / 08.10.2026: FBO receipt approval plan scope

API sha256:91cc1fb9ac47b6af22bc0f0c4da578f8aa9111a97f5f7d01172c3bbc9fad0216. Baseline `2026-10-08-fbo-receipt-plan`; sourceParityVerified=false.
Only `modules/tsd/fbo-fbs-reservations.js` changed from the fresh live base sha256:7536d590a09322e160611f23e81fbb7d5f8d9ea5969e69386dd76c02c37f97a4.
Request 1813: 231 lines, full snapshot 6344 ms after publication (candidate 6584 ms); mandatory rollback, no business records changed. Existing client approval and FBS reservations preserved. Web/APK218/flags/sold WMS unchanged.
3126 API tests passed, 141 skipped; dedicated KIZ integration suite excluded because an isolated database was unavailable. Scoped TypeScript passed.

# Опубликовано PR505 / 08.10.2026 — серии печати и телефон

[Сценарий и проверки](print-series-phone-layout.md), [запись выпуска](releases/print-phone-20261008.json).
Серия коробов отправляется одним заданием; Windows-агент печатает один многостраничный документ.
На телефоне заявки занимают ширину экрана, меню сворачивается, широкие блоки прокручиваются,
масштабирование браузера разрешено. Требуется обновить оба скрипта агента из опубликованного ZIP.

API `sha256:7536d590a09322e160611f23e81fbb7d5f8d9ea5969e69386dd76c02c37f97a4`;
web `sha256:2ba4b44a40bdf6051645f43449effdcb92ec240b7f5366a056e6b4a7e057b527`.
Baseline `2026-10-08-print-phone`, sourceParityVerified=false. Флаг
WMS_PRINT_SERIES_ENABLED=true только в нашей ВМС. Исправления PR501/503 сохранены;
APK218, остальные флаги, схема БД и проданная ВМС не изменены.
3129 API / 398 web тестов, 9 тестов готового API, 8 проверок агента,
проверка упаковки и 6 сценариев опубликованного Web прошли. API141/web2 пропущены;
отдельный KIZ DB integration исключён. Физические принтер и телефон пока не проверены.
Откат: `logoff-api:before-print-phone-20261008`, `logoff-web:before-print-phone-20261008`
и прежнее значение нового флага. Данные склада и задания печати при публикации не создавались.

# Published PR503 / 08.10.2026: bounded TSD receipt approval

[Change and checks](tsd-receipt-scoped-20261008.md). API sha256:100c581357a3e892a6aa021f7111b03338519ee094d67ea11edff7039c2c13dc.
Per-box FBS/FBO checks preserve client approval and shared locks without reading unrelated receipt history.
Published live checks: 38-101 ms; no business records changed. Web/APK218/flags/sold WMS unchanged.
Baseline `2026-10-08-tsd-receipt-scoped`; sourceParityVerified=false.

# Published PR501 / 08.10.2026: FBO window controls

[FBO window verification](fbo-window-controls-20261008.md). Web sha256:6b9bca6b3394eb7d5a4b387d267090834495249dd73764e699334ae3ed56b353.
Minimize/restore, close during reads and persisted-operation reconciliation verified on published code with isolated API fixtures.
395 web tests passed, 2 skipped; TypeScript and existing multi-window browser suite passed. API/APK218/flags/sold WMS unchanged.
Baseline `2026-10-08-fbo-window-controls`; sourceParityVerified=false.

# Published PR498 / 08.10.2026: single React runtime

[Incident and review](single-react-incident-20261008.md). Web sha256:41b53ba7bea7475d139d8366e2a9b08064fde9904c64619b63fe5c4563bb5e6c.
Requests/FBS/FBO/monitoring/administration verified in la_panthera, Soul and modern.
API/APK218/flags unchanged. Baseline `2026-10-08-single-react`; sourceParityVerified=false.

# Опубликовано PR494 / 07.10.2026 — согласование приёмок

[Описание и проверки](receipt-stock-approval.md). Клиент подтверждает собственную
приёмку; имя/время фиксируются в истории. Пока не подтверждено, товар исключён из
остатков и отбора ФБС/ФБО. Хранение начисляется с физической приёмки.
Включено только для Лукина / ФФ Москва; 29 прежних приёмок сохранены доступными.

API `sha256:b6a46b789d318c44837b823169ca60f169c01fe76fe42f1e3363b62b7b242d41`, web `sha256:1097a5ae42c410f54439f4c3ac066ed857398e9275c0a1e9f6bce0e8951dd0c2`.
Baseline `2026-10-07-receipt-approval`, sourceParityVerified=false.
WMS_RECEIPT_APPROVAL_ENABLED=true; остальные флаги/APK218/sold WMS не изменены.
Проверены runtime-хеши, health, права клиента, подтверждение в rollback-транзакции,
реальный браузер и общие тесты. Физические остатки не изменялись.

# Опубликовано PR492 / 07.10.2026 — журнал выгрузок и ожидание размещения ФБО

[Описание и проверки](cabinet-export-and-fbo-placement.md).
Excel фиксирует точные строки, фильтры, пользователя и IP запроса. ФБО допускает
подтверждённый приход за 7 суток без палет-сорта с ожиданием размещения.
LOGOFF ТСД218 опубликован; установка поверх старой версии.

API `sha256:4b83320f4ec8250aeb8bab8843a1db69e22c84363a372ab4908bb30f4ffeb8c8`, web `sha256:926bc59fbb684076283200ec073352e3ac568ecefec7231be2680cfd60530e9e`.
Baseline `2026-10-07-cabinet-fbo`, sourceParityVerified=false.
Флаги, схема, бизнес-записи и sold WMS не изменены. Проверены health, все хеши,
подпись APK, read-only приёмка0610. Откат: `logoff-api:before-cabinet-fbo-20261007`
и `logoff-web:before-cabinet-fbo-20261007`.

# Опубликовано PR490 / 07.10.2026 — планшет учёта времени 0.4.0

APK: https://wms.logoff.pro/downloads/logoff-attendance-0.4.0-pilot.apk
VersionCode 7; SHA256 `28e77833b3e692aaae423ee2f46ee595cfe26cefd9bc04207476c016a5c3cba0`.
Адаптивные экраны, крупные имена/действия, сохранение черновика при возврате/повороте,
видимая кнопка сохранения, локальная история работ и доставки. Обновление поверх старого
приложения с тем же ключом. Тихая установка отсутствует. Физический планшет пока не проверен.
92 Android tests, lintDebug, assembleRelease и проверка APK прошли.

Web `sha256:bf4632ada0da13bf1fab7c2847a374b4cc676b2b3345f978f33d1423977c4d84`:
добавлен только версионный APK в downloads; все остальные файлы сверены по SHA256.
API `sha256:961d496898b8e5fbdf809afdcce4197795f9ed6de0fb6cf7fcbb91ac8d717c05` сохранён;
baseline `2026-10-06-payroll-corrections` остаётся актуальным для API, sourceParityVerified=false.
БД, флаги, ТСД217 и sold WMS не изменены. Откат web: `logoff-web:before-attendance040-20261007`.
[Запись выпуска](releases/attendance-adaptive-040.json).

## Опубликовано PR488 / 06.10.2026 — исправления и история ФОТ

Исправлен фильтр сводки выплат (PR487): пустые суммы скрыты. В редакторе смены
можно выбрать правильного сотрудника, а у погрузки/разгрузки — участников,
время и объёмы. В настройках: История изменений → выбрать → Отменить изменение.
[Сценарий и ограничения](payroll-corrections.md), [запись выпуска](releases/payroll-corrections-20261006.json).

Новый флаг `WMS_PAYROLL_CORRECTIONS_ENABLED=true` только в нашей ВМС. Оплаченные
и изменённые позже записи защищены от отката; старые события без снимка доступны
для просмотра. Миграции БД нет, рабочие записи при выпуске не менялись.

API `sha256:961d496898b8e5fbdf809afdcce4197795f9ed6de0fb6cf7fcbb91ac8d717c05`; web `sha256:3471d224cc152b9ac7bdea36469b2fa607dc56a7f53883136d6bb580ec41e374`.
Снимок `baselines/our-wms/2026-10-06-payroll-corrections`; sourceParityVerified=false.
Изменены ровно пять API-модулей, web сохраняет прежние файлы и APK217/attendance.
3096 API + 387 web тестов прошли; 141/2 пропущены, отдельная KIZ DB suite исключена.
Отдельно прошли 18 PostgreSQL-тестов, 9 на готовом API и браузерный сценарий
на публикуемом JS. TypeScript и серверная история (только чтение) проверены.
Первый запуск автоматически откатился из-за рабочей папки проверочного скрипта;
повторная публикация успешна. Проданная ВМС не изменена.

## Опубликовано PR485 / 05.10.2026 — ТСД217

Отбор ФБО LOGOFF разделён на «Сборку целых коробов» и «Частичный отбор».
[Сценарий и тесты](fbo-two-stage-picking.md), [запись выпуска](releases/fbo-separated-picking-217.json).
Подпись совместима с216; 678 Android-тестов прошли. Воспроизводимость базового APK216
проверена по всем неподписанным записям; остальные классы217 сохранены.
Физический скан на ТСД ещё не проверен. Обновление устанавливается поверх текущего приложения.

API `sha256:fb456470d653863bf080da21a1eef7284de775f06e6f2221d8ae63cc4d1fabcf` сохранён без перезапуска; web `sha256:cab415deba5d10f5c920f86480d85601ec9a7876789da4a7d12e3fe45de14d86` меняет только три файла downloads.
Веб-приложение, флаги, конфигурация, БД и проданная WMS не изменены.
Снимок `baselines/our-wms/2026-10-05-fbo-picking-217` содержит свежий API runtime,
его неизменность проверена baseline guard. API sourceParityVerified=false;
это не разрешение полной сборки API/web из исходников. Откат web: `sha256:7d2b02b61b91203417468dc808432711eaaa407533268b270b6108cf73a70f36`.

# Published PR472 / 04.10.2026

<!-- FIX: permanent client/branch closure and signed documents preserve original finances. -->
«Биллинг → Клиенты и расчёты»: выбрать клиента, даты и активный филиал.
Закрытие требует предварительной проверки и основания; неоплаченные счета сохраняют долг.
Доначисление/уменьшение — отдельный документ с причиной и автором; поздняя работа — отдельный счёт.
Флаг `WMS_BILLING_PERIOD_CLOSE_ENABLED=true` только в нашей WMS.
Миграция `20261003220000_billing_period_close` применена атомарно и записана в Prisma history;
хеши исходных BillingInvoice/Item/Payment/Charge в транзакции не изменились.
Первый запуск остановлен lock timeout и полностью откатился; повтор после проверки блокировок успешен.
API `sha256:7ff2c21d01327774b1ff328cc9c842ec25b02eef031dbda79753050676dbbd3e`;
web `sha256:9af39b73ad64bb3930496e46f4ff3b47c6d28d2adfaf25238c6eb5a173f910ce`.
10 API-файлов, 29 новых JS chunks, 1714 старых assets сохранены. API569/web1744.
Перед выпуском сохранён новый live FBO TSD runtime из API `3ef0489614fe...`; он не изменён overlay.
Полные runtime/public hashes, offline candidate, два браузерных сценария и health прошли.
GET history/invoices/settlements200; гипотетические signed previews201; запись документов не выполнялась.
INV-202609-0007: оплата450000 и долг100535,37 сохранены. Новых closes/corrections0.
API3059/web372 passed, API132/web2 skipped; отдельная KIZ DB suite исключена.
TypeScript/Prisma validate/Vite прошли. Изолированный PostgreSQL проверил защиту, конкурентные строки,
взаимную блокировку до исправления и exact publication SQL с откатом финансового вмешательства.
Проданная WMS/FFULHAB/APK/compose и прочие контейнеры не менялись. Source parity false.
Локальная копия `C:/WMSFF2207/baselines/our-wms-runtime-period-close-20261004`;
current pointer обновлён; полный эталон01.10 неизменён.
До появления новых документов rollback images `logoff-api:before-billing-period-close-20261004`
и `logoff-web:before-billing-period-close-20261004`. После использования корректировок нельзя выключать
их учёт старым runtime: нужен совместимый расчёт и восстановление вперёд.
[Запись выпуска](releases/billing-period-close-20261004.json).

# Published PR469 / 03.10.2026

<!-- FIX: register hides settled clients while preserving unfinished calculations. -->
«Клиенты и расчёты» скрывает полностью рассчитавшихся клиентов, включая архивных.
Долг, невыставленные услуги, черновики, работа без начисления и нерешённые проверки
сохраняют строку. Один аванс строку не удерживает и не вычитается из долга.
Документы и деньги не менялись. Фильтр относится к реестру, не к удалению клиентов.
API `sha256:e7aa81ff68a153426ea7fdd4efc8a994f3119f107ee8b4b2d58ce4bdefd6a67b`;
web `sha256:7fab10dcd44ce9813cd63689ea03fbc7ad4e5b461c57950ceec8e59bd8200532`.
Один API-модуль, сообщение пустого списка, 29 новых JS chunks; 1685 старых assets сохранены.
Полные runtime/public hashes, offline candidate, browser и health прошли.
READ ONLY сравнение: 44 → 8 строк, скрыты 36 рассчитавшихся, из них 9 архивных;
суммы оставшихся и issues идентичны. Published GET settlements200, 5644ms;
invoices200, прежняя оплата INV-202609-0007 450000 и остаток100535,37 сохранены.
API3036/web368 passed, API132/web2 skipped; KIZ DB-suite требует отдельной БД.
TypeScript API/web прошёл. Проданная WMS/FFULHAB/APK/compose и другие сервисы не затронуты.
Source parity false; опубликован только проверенный overlay актуального runtime.
Локальный runtime: `C:/WMSFF2207/baselines/our-wms-runtime-settlements-visible-20261003`
(API564/web1715); current pointer обновлён, полный эталон 01.10 сохранён.
Rollback: `logoff-api:before-billing-settlements-visible-20261003`,
`logoff-web:before-billing-settlements-visible-20261003`.
[Запись выпуска](releases/billing-settlements-visible-20261003.json).

# Published PR467 / 03.10.2026

Исправлены ошибка 500 «Клиенты и расчёты» и подстановка полной оплаты вместо
введённого поступления в «Приход ДС». Подробности начислений ограничены датами
услуг, историческая FBS-проверка сохранена в лёгкой проекции. READ ONLY/RepeatableRead,
timeout30s, долг по всем выставленным счетам филиала и отдельный аванс сохранены.
Галочка распределяет только введённую сумму; история поступлений включает оплаченные
счета и отменённые записи. Прежние фильтр статуса и кнопка по сданным заявкам сохранены.
API `sha256:6c7be0f55b5334f80d8d78880beead3b19967b2018d5dba13ec633f00b2ecbf2`;
web `sha256:30fbd82b11b051a579f2b00b2f4bef1170570b6ba035297a66b85cdbaeab49cb`.
Два API-файла, 29 новых JS chunks, 1656 прежних assets сохранены. Compose не менялся.
Другие сервисы/sold WMS/FFULHAB/APK не затрагивались. Source parity false.
Коррекция по подтверждению владельца: INV-202609-0007, проведено 450000 ₽,
остаток 100535,37 ₽, ISSUED; первоначальный ошибочный платёж отменён и сохранён.
Есть before/after audit; dry run с rollback и проверка после commit прошли.
Published GET settlements и invoices вернули 200; запись оплаты/история/остаток проверены.
Повторная проверка под рабочей нагрузкой: settlements 22304 мс, оба GET вместе
63124 мс. Это HTTP-время; 2853 мс ниже относится к отдельному READ ONLY кандидату.
API3034/web367 passed, TypeScript, Vite, 5Node+1Python, browser, offline candidate,
полные хеши runtime/public assets/health прошли. READ ONLY кандидат2853ms.
Локальная копия: `C:/WMSFF2207/baselines/our-wms-runtime-partial-receipt-20261003`
(API564/web1686); указатель `baselines/OUR_WMS_CURRENT_RUNTIME.json` обновлён.
Полный эталон 01.10 не менялся. Runtime rollback отдельно от денежной коррекции:
`logoff-api:before-billing-settlements-timeout-20261003`,
`logoff-web:before-billing-settlements-timeout-20261003`.
[Описание](billing-partial-receipt-fix.md), [запись](releases/billing-partial-receipt-20261003.json).

# Published PR465 / 03.10.2026

«Биллинг → Счета → Статус счёта»: Все статусы / Черновик / Выставлен / Оплачен /
Отменён. Доступен в списке и темах, выбор сохраняется, метрики тем учитывают статус.
API и документы не изменялись; прежняя кнопка счёта по сданным заявкам сохранена.
Web `sha256:019e9c307cb64eb4da299c8643f1b59607416ca257e6aeb363682720ecfa6587`;
API остаётся `sha256:f541c929317c030370f40d360c25bc19f0cf69ea568762b8f18fbdd64cfbcf3a`.
1627 прежних assets сохранены, новый граф 29 JS-файлов. Пересоздан только web.
Локальный runtime: `C:/WMSFF2207/baselines/our-wms-runtime-invoice-status-20261003`
(API564/web1657), указатель `baselines/OUR_WMS_CURRENT_RUNTIME.json` обновлён.
Source parity false: только точечные изменения поверх свежего runtime.
Полный эталон 01.10 не менялся; sold WMS/FFULHAB не затрагивались.
Web365/API3033 passed, TypeScript/Vite, Node/Python guards, browser actual graph,
server candidate/full hash verification/public graph/health прошли.
Откат: `logoff-web:before-billing-invoice-status-20261003`.
[Описание](billing-invoice-status-filter.md), [запись выпуска](releases/billing-invoice-status-20261003.json).

# Published PR463 / 03.10.2026

«Биллинг → Счета → Создать счёт по сданным заявкам»: обе даты выбирает оператор,
отбор по последнему переходу в «Сдано» (МСК), единый новый черновик на клиента/филиал
из утверждённых начислений всех услуг. Все существующие счета, включая черновики,
сохраняются: охваченные заявки и пересекающиеся периоды исключаются с номером счёта.
Пропущенные начисления не восстанавливаются автоматически; исключения видны в расчёте.
Флаг `WMS_BILLING_DONE_REQUESTS_ENABLED=true` включён только в нашей WMS.

API `sha256:f541c929317c030370f40d360c25bc19f0cf69ea568762b8f18fbdd64cfbcf3a`;
web `sha256:28b7131de8ddd6bd02b2062a58872f1eb98ad57e95e7e3784143769c31291007`.
Точный delta: шесть API-файлов из свежего runtime, новый граф из 29 JS-файлов.
1598 прежних web assets сохранены; остальные контейнеры/APK/sold WMS/FFULHAB не менялись.
Откат: `logoff-api:before-billing-done-requests-20261003`,
`logoff-web:before-billing-done-requests-20261003`; compose-before.yml в каталоге выпуска.

API 3033 passed / 132 skipped, web 364 passed / 2 skipped; отдельная KIZ DB suite
исключена. TypeScript, Vite, 3 Node + 3 Python release tests, browser actual graph,
offline candidate smoke и published HTTP read-only preview прошли. Реальный расчёт
01–02.10: 60 сданных заявок, 72 существующих счета, 87 исключений, новых документов 0.
Сверка до/после: финансовые поля всех 5458 счетов и все 51375 строк неизменны.
Health, все API-хеши/прежние web assets/новый public graph и флаг проверены.

Проверенная локальная копия runtime:
`C:/WMSFF2207/baselines/our-wms-runtime-done-requests-20261003`
(API564/web1628 файлов), указатель `baselines/OUR_WMS_CURRENT_RUNTIME.json`.
Исходный полный серверный эталон 01.10 сохранён без изменений. Source parity false:
полную локальную сборку публиковать нельзя; перед следующей правкой сверить сервер.
[Описание](billing-done-requests.md), [запись выпуска](releases/billing-done-requests-20261003.json).

## Предыдущие выпуски

# Published PR461 / 03.10.2026

Cancelled unfinished KIZ reuse: physical admin confirmation, RELEASED/non-completed tasks in closed requests, no shipment history, exact saved WB cancellation and later per-mark sorting/movement proof. Fresh contradictory WB evidence rejects. Full task/evidence saved before conditional removal of old KIZ binding. Current review still needs manager approval. Sold WMS unchanged; existing flags only.

API `sha256:2638fbfc2e62e83d75bcd6ddbaf5bf7b1c3fc781f36a9b1f9a1dc757ad4aa8cc`. Baseline `2026-10-03-kiz-unfinished-release`; rollback `logoff-api:before-kiz-unfinished-release`. One module changed from fresh563-file runtime containing parallel payroll releases. Web/APK/other containers unchanged. Source parity false; do not replace with historical TypeScript build.

11new compiled tests and12previous returned-KIZ regressions passed. Regression failed before patch. Real request1676 KIZ validated with mandatory transaction rollback; binding unchanged afterwards. Local API2989passed/129skipped; separate KIZ database integration excluded. Health and runtime hashes checked after publication.

# Published PR457 / 02.10.2026

Завершение упаковки FBO: существующий неизменившийся справочник услуг и тариф
клиента читаются без повторного upsert. Исправлен наблюдавшийся источник конфликтов
и тайм-аутов для №1568. Флаг `WMS_FULFILLMENT_CATALOG_READ_FIRST=true` включён
только в нашей WMS; исходные флаги сохранены, проданная WMS не затронута.

API `sha256:e144daf31ad40c114c7b16561e06b5e3b3338e198fe17bfe0c0ffc143950b960`.
Web `sha256:347633f1079ad90a969e216911a1a83b59ea1acec2e19e4bada36fd0b061db2d` без изменений.
Baseline: `wms/baselines/our-wms/2026-10-02-fbo-finish-catalog` (API, 563 файла).
Точный delta — одна функция `ensureStandardFulfillmentService` в
`modules/stock/stock-operations.service.js`. APK и остальные контейнеры сохранены.
Откат: `logoff-api:before-fbo-finish-catalog`. Source parity остаётся false.

API 3014 passed / 129 skipped; отдельная KIZ DB suite исключена. TypeScript
с актуальным изолированным Prisma-клиентом прошёл. Два регрессионных теста
фактической функции падают до исправления и проходят после; девять прежних
runtime-тестов recovery проходят в собранном образе без сети.
На опубликованном API оба способа завершения №1568 проверены с обязательным
откатом: обычный 4220 мс, административный 3795 мс. Оба Excel на 585 единиц:
42 товарные строки и 191 строка распределения по коробам. Повторный запрос
не дублирует начисления. Тестовые изменения полностью отменены; заявка
сохранена в CONTROL, а не закрыта автоматически. Health и все хеши проверены.

[Подробности и ограничения](testing/fbo-finish-catalog-conflict.md).

## Previous release

# Published PR455 / 02.10.2026

«Биллинг → Клиенты и расчёты»: суммы по клиенту/активному филиалу, расшифровки
до начисления/заявки/заказа/тарифа/счёта и очередь проверок. Новый GET
`/billing/settlements` читает PostgreSQL в RepeatableRead READ ONLY. Флаг
`WMS_BILLING_SETTLEMENTS_ENABLED=true` включён только в нашей WMS.
Миграций, корректировок начислений и изменений остатков нет. Проданная WMS
не затрагивалась. Поиск выполненной работы без начисления покрывает подтверждённую
FBS-обработку WB/Ozon; это не полный контроль FBO/хранения/доставки.

API `sha256:1b186bf6e015f0144c973bff8b67b1825739b2774d7556666bab53d8a8157764`;
web `sha256:347633f1079ad90a969e216911a1a83b59ea1acec2e19e4bada36fd0b061db2d`.
Точный delta: три новых billing-settlements модуля, подключение BillingModule,
запись каталога API; существующие расчётные сервисы не заменялись. Сайт сохраняет
1537 прежних assets, добавляет новый граф и CSS. Остальные контейнеры и APK
сохранены. Откат: `logoff-api:before-billing-settlements-20261002`,
`logoff-web:before-billing-settlements-20261002`; compose-before.yml в каталоге выпуска.

API 2956 / web 360 passed, 115 / 2 skipped; отдельная KIZ DB integration исключена.
После объединения повторно проверена актуальная интеграционная версия:
API 3006 / web 361 passed, 129 / 2 skipped; отдельная KIZ DB suite исключена.
TypeScript API/web, 6 тестов выпуска, offline runtime smoke, actual runtime browser,
полные опубликованные хеши и health 200 прошли. GET без входа возвращает 401.
Read-only проверка в опубликованном API: 44 строки, 52 проверки, 23 случая
WORK_WITHOUT_CHARGE за 1–2 октября на активном складе владельца.
Исправленный тест воспроизводит прежний отказ реестра на 42 144 начислениях.

Свежий локальный runtime API/web:
`C:/WMSFF2207/baselines/our-wms-runtime-billing-settlements-20261002`.
Архивы и каждый файл проверены `release_baseline.py verify`; эталон 01.10 не менялся.
[Машинная запись выпуска](releases/billing-settlements-20261002.json),
[описание и ограничения](billing-settlements.md). `sourceParityVerified=false`.
Перед следующим выпуском читать свежие image ID; полный source build по-прежнему
не заменяет опубликованный runtime.

## Previous release

# Published PR453 / 02.10.2026

Follow-up to PR451: real recovery still exhausted serialization retries. recoverInTransaction now uses executeAction without unused route calculation. apply keeps3fresh transactions, waits50/100ms between retries, and reports409with repeat-preview guidance on exhaustion. All permissions, revision checks, inventory validators and receipts preserved.

API `sha256:3278a1e6c2f0f959324f5f0000c546b960927ef96793ad49663171c88807cfe7`; baseline `2026-10-02-fbo-recovery-route`; rollback `logoff-api:before-fbo-recovery-route`. Only2runtime modules changed. Source parity false; web/APK/flags/sold WMS unchanged.

2989 local API tests passed,129skipped; dedicated KIZ DB integration excluded.4new runtime regressions and5prior retry tests passed. Actual preview/apply for1568 intoFFL_LKBFBO0110_013 succeeded on published image in1346ms with mandatory outer rollback; persisted unit remainsPICKED. Before-fix smoke also passed during a quiet interval: contention is intermittent, not claimed impossible. Health and560file hashes verified.

# Published PR451 / 02.10.2026

Administrative FBO recovery no longer retries within an aborted transaction. The recovery-scoped service propagates P2034 to FboProblemsService.apply, which rolls back and retries the whole operation using the same preview receipt. Ordinary actions retain three attempts. Request1568 business data unchanged.

API `sha256:b5241036c24526715e4d880950f98f3ecf18fda00e6fea16be1ad390afc94209`; API-only baseline `2026-10-02-fbo-recovery-retry`; rollback `logoff-api:before-fbo-recovery-retry`. Web/APK/flags/other containers unchanged. Sold WMS not deployed. sourceParityVerified=false; only modules/tsd/fbo-two-stage.service.js changed, not a full source rebuild.

2989 local API tests passed,129 skipped; dedicated KIZ database integration excluded. Five compiled runtime checks passed: PACK_UNITS, CLOSE_PICK, ordinary retry bounds, non-conflict propagation and outer retry with a single receipt. Regression reproduced25P02 before correction. Runtime checks simulate transactions without business writes; real user operation still requires retry after publication. Published health and all560runtime hashes verified.

# Published PR449 / 02.10.2026

Follow-up to PR447: live terminal requests still required8–11seconds. CPU profiling isolated repeated per-box marking/composition decisions. Cache only within one snapshot, keyed by box object and every contained SKU demand. Recalculate when demand changes; no cross-request cache. Same our-WMS-only flag, sold unchanged.

API `sha256:7713bd2033c56cb079b9ee2c1147be454cb3f87b177dca573cefb62c0b0388fb`. API-only baseline `2026-10-02-fbo-cache`; sourceParityVerified=false; rollback `logoff-api:before-fbo-cache`. Web/APK/other containers unchanged.

2987 API tests passed,129 skipped; dedicated KIZ database integration excluded. TypeScript limitation from pre-existing local payroll Prisma types remains. New regression failed before/pass after; compiled route comparison passed12fixtures. Same-transaction comparison №1626 matched496boxes;5.14→1.42seconds. Full getDeviceRequestPlan with actual Konstantin permissions succeeded after publication in2247ms,301505-byte response. This is server-handler verification, not a physical-device UI test. No business writes. Published hashes/health/flag verified.

# Published PR447 / 02.10.2026

FBO route timeout: bounded shipped-order lookups and in-flight plan coalescing with independent caller authorization. Same request/context shares only an unfinished calculation; no settled cache. Flag WMS_FBO_PLAN_COALESCE_ENABLED=true only on our WMS; sold WMS unchanged.

API `sha256:8243c12ea763172e91c493b5142b0b7bc82948e1ee8cb221abb84feb02b322df`. Baseline `2026-10-02-fbo-plan` contains API only. Web/APK and other running containers unchanged by PR447. Source parity remains false. Rollback `logoff-api:before-fbo-plan`.

Validation: 2985 API tests passed across full run and two environment-corrected reruns;129 skipped; dedicated KIZ database integration excluded. Six new source tests (two reproduced the old failure) and three compiled-runtime tests passed. TypeScript check blocked by stale local Prisma types for pre-existing payrollBreak/handling fields; no errors reported in changed modules. Read-only same-transaction route comparison for1626 matched exactly:496 boxes;shipped links32727→7215. Published read-only calculation5366ms. Health, all560 runtime file hashes and flag verified. No business data changed.

# Published PR442 / 30.09.2026

PR442: receipt channel/membership changes atomically invalidate WB stock plans through the durable existing queue. API3010 passed/83 skipped; TypeScript and exact one-module delta verified. Web/APK216/flags/sold WMS unchanged from PR441. Source parity false. User-authorized FBO-only directions applied to FFL_LKB2409 (with ten corrected memberships) and current FFL_LKB2709; no physical stock movements, nine archived boxes preserved. Old active FBS order access retained.

API `sha256:c44796f1b9a7ce9ecbfba629c868e8195aa73da91f2e547f43b2e32a034db6a7`; web `sha256:fe8830d5764458a7e35cf722ec99f5d443fb98429805f7c9202cdf255a443abb`. Baseline `2026-09-30-receipt-channel-event`.

# Published PR441 / 30.09.2026

Receipt directions and FBO/FBS reservation protection. API `sha256:f21ecba233d3e5f6cf01de4594f906786e1456bf9bd0c8b4450852cfd7afa252`; web `sha256:fe8830d5764458a7e35cf722ec99f5d443fb98429805f7c9202cdf255a443abb`. Baseline `2026-09-30-receipt-channels`. API3007/83 skipped, web355/2 skipped, exact runtime8 and browser checks passed. Flag WMS_RECEIPT_CHANNELS_ENABLED=true only on our WMS. APK216 and sold WMS unchanged; source parity false. Business policies have not yet been applied at this snapshot.

# Published PR439 / 30.09.2026

PR439: la_panthera minimize control aligned in the existing action toolbar. Separate retained instances allow multiple independent request windows from one workspace. Browser tests reproduce old misalignment and verify separate drafts, restore/close and theme isolation. Web355/API2939 passed, 2/115 skipped; dedicated KIZ DB suite excluded. TypeScript, actual runtime and published section smoke passed. API/APK/flags/sold WMS unchanged; source parity false. Rollback logoff-web:before-panthera-multi.

Web `sha256:607e51b40f86b03b08f2e1e2e003744e264426a3757258b2fdf3ed98d5b54e3e`; API `sha256:d976a490b412d33585d24a0eddb6392ea7304e5b50c2ae9699ffadd3f72327dc`.
Baseline `2026-09-30-panthera-multi`.

# Published PR437 / 30.09.2026

PR437: opt-in la_panthera operational windows retain the current page, minimize to one right-edge dock and preserve forms across navigation. WB tiles2-15 are square, tile1 spans two rows with clients; narrow screens reflow. Web355/API2939 passed, 2/115 skipped; dedicated KIZ DB suite excluded. TypeScript, before/after browser regression, actual runtime and published Requests/FBS/FBO smoke passed. API/APK/flags/sold WMS unchanged. Concurrent Soul card CSS retained. Source parity false. Rollback logoff-web:before-panthera-windows.

Web `sha256:05edd360afae5837ff5d586093cd054b790e6b4097a5533be2f9ebc885011954`; API `sha256:d976a490b412d33585d24a0eddb6392ea7304e5b50c2ae9699ffadd3f72327dc`.
Baseline `2026-09-30-panthera-windows`.

# Published PR435 / 30.09.2026

PR435: saved seller warehouse identity in FBS fallback display. Two fields in one API module. API2939/115 skipped, four runtime tests, TypeScript, baseline8 and live45-order read-only proof passed. Health/hashes/flags verified; web/APK/sold WMS unchanged. Source parity false. Rollback logoff-api:before-fbs-saved-names.

Baseline: 2026-09-30-fbs-saved-names.

# Published PR433 / 30.09.2026

Fast active FBS display skips historical loading; historical shipment identity restored from durable columns. API-only exact delta. API2939 passed/115 skipped, three runtime regressions, TypeScript and live read-only checks passed. Published health/hashes/flags verified; web/APK/sold WMS unchanged; sourceParityVerified=false. Rollback logoff-api:before-fbs-active-fast.

Baseline: 2026-09-30-fbs-active-bootstrap.

# Published PR431 / 30.09.2026

PR431: RELEASED historical KIZ bindings may be archived by authenticated physical review only with proven post-shipment return, closed historical request and shipment history. Active bindings and missing proof remain blocked. API-only one-module delta; web/APK/flags/sold WMS unchanged. API2933 passed/115 skipped, 12 runtime tests, TypeScript and live read-only return proof passed; dedicated KIZ database suite excluded. sourceParityVerified=false. Rollback logoff-api:before-kiz-released-review.

API sha256:a27867a356fdfd534bd9a7c6e9fa70eacbecb7d4dcf2324f6c54a801861070d7; web sha256:3687e663dd006cd194de3f8a25c1d9ad56f7033481368250298086a37f32bfb0.
Baseline: 2026-09-30-kiz-released-review (API).

# Published PR424 / 29.09.2026

PR424: compact attendance editor in opt-in la_panthera. Max width720, content height, two-column fields and inline actions; narrow-screen stacking. Save/delete/time calculation unchanged. Web351 passed/2 skipped, TypeScript, source and actual runtime browser checks passed. API PR422, APK216, flags and sold WMS unchanged. Exact hashes/health verified; source parity false. Rollback logoff-web:before-payroll-compact.

Web `sha256:0b41f6ce4ae558cee000289e724e41acfb3cb48f436fd9f94d3a43213fe8ecf0`; API `sha256:ff9265aa3b693bba2038053967ba690dcac36d325ec621eb7265a746e3fd348a`.
Baseline `2026-09-29-payroll-compact`.

## Previous release

# Published PR422 / 29.09.2026

PR422: request-scoped FBO remainder route. Setting activated only for request 1550; preferred receipt FFL_LKB2409. Whole reconciled boxes first, largest useful partial balances next; current unpicked demand and local pallet context retained. Application under request row lock: 1019 picked units preserved; remaining814, route144->134 boxes, whole75/606units->77/624units, no shortage. Two API modules only; web, APK216, flags and sold WMS unchanged. API2933 passed/115 skipped; dedicated KIZ DB suite excluded. TypeScript and read-only actual runtime comparison passed. Exact hashes/health verified; source parity false. Rollback logoff-api:before-fbo1550-remainder-route (preference becomes dormant on old runtime).

API `sha256:ff9265aa3b693bba2038053967ba690dcac36d325ec621eb7265a746e3fd348a`; web `sha256:bab947a845a51d3a02eef205658b2114474e9eef11bd725b754c58d0c533a438`.
Baseline `2026-09-29-fbo1550-route`.

## Previous release

# Published PR420 / 29.09.2026

PR420: equal-height FBS navigation headers and aligned counters, with client list in a separate row. Shared marketplace UI across themes. CSS-only delta; all JS, API PR412, APK216, flags and sold WMS unchanged. Web351/2 skipped; 72 browser theme/viewport/client-list cases passed. Exact hashes/health verified; source parity false. Rollback logoff-web:before-fbs-equal-tiles.

Web `sha256:bab947a845a51d3a02eef205658b2114474e9eef11bd725b754c58d0c533a438`; API `sha256:78c06803de1b44099824175217cceb2e6899066de9e485cc6954971b49691957`.
Baseline `2026-09-29-fbs-equal-tiles`.

## Previous release

# Published PR418 / 29.09.2026

PR418: four equal request menu rows, 56px high and full width, with centered labels/icons and identical theme-aware backgrounds. Native Documents/More disclosures retained. CSS-only delta; all JS, API PR412, APK216, flags and sold WMS unchanged. Web351/2 skipped; source and actual runtime checks across 11 themes plus Light, FBO/FBS, geometry, colours, centering, keyboard/callbacks passed. Exact hashes/health verified; source parity false. Rollback logoff-web:before-request-menu-four-rows.

Web `sha256:124f6f71375505e845600ce174efc7fb4aefb7c66474133513bb78bfb7f4a958`; API `sha256:78c06803de1b44099824175217cceb2e6899066de9e485cc6954971b49691957`.
Baseline `2026-09-29-request-four-rows`.

## Previous release

# Published PR416 / 29.09.2026

PR416: approved request and online menus. Online replaces Route; downloads grouped in Documents; obsolete manual/emergency/source-selection actions removed. Edit/cancel moved inside Online with original permission/status predicates and confirmation. Long names and narrow action labels wrap fully. Web351 passed/2 skipped, TypeScript, source and actual runtime browser across 11 themes plus Light; 8 list callbacks and online toolbar actions verified. API PR412/APK216/flags/schema/sold WMS unchanged. Exact image/public hashes and health verified. Source parity false. Rollback logoff-web:before-request-title-wrap.

Web `sha256:83443774025472e37c58d4ef7249bf7219088a84117f49d95b8310c7b3bbb227`; API `sha256:78c06803de1b44099824175217cceb2e6899066de9e485cc6954971b49691957`.
Baseline `2026-09-29-request-wrap`.

## Previous release

# Published PR414 / 29.09.2026

PR414: compact FBO/FBS request actions with Documents and More disclosures; unique route, explicit edit/cancel, manual stages and administrator recovery. Existing callbacks retained. Web347/API2929 passed, 2/115 skipped; dedicated KIZ DB suite excluded. TypeScript and actual runtime browser checks across 11 themes plus Light passed, including 13 callbacks, keyboard and permissions. API PR412/APK216/flags/schema/sold WMS unchanged. Full hashes/health verified; source parity false. Rollback logoff-web:before-request-action-menus.

Web `sha256:fe944ebb4ba1486f1284e91a6dfae3f2aa529ece11e69943299bd413ef217a4e`; API `sha256:78c06803de1b44099824175217cceb2e6899066de9e485cc6954971b49691957`.
Baseline `2026-09-29-request-action-menus`.

## Previous release

# Published PR412 / 29.09.2026

PR412: explicit administrator/owner KIZ reuse with a later audited physical sorting return when historical WB status is unavailable. Two API modules only. WMS_KIZ_PHYSICAL_REVIEW_ENABLED=true only on our WMS. Runtime tests33, API2929/web343 passed;115/2 skipped; isolated PostgreSQL suite excluded. API TypeScript passed. Live physical proof verified read-only. Exact runtime hashes, health, flags and unchanged web/APK/other containers verified. No business records changed. Source parity false. Rollback logoff-api:before-kiz-physical-review.

Baseline: `2026-09-29-kiz-physical-review`. API `sha256:78c06803de1b44099824175217cceb2e6899066de9e485cc6954971b49691957`.

# Published PR410 / 29.09.2026

PR410: la_panthera now offers an independent Dark/Light style selector next to the theme. Dark remains default; style persists per browser/user, isolated from other themes and accounts. Light uses pale teal/white surfaces, dark text and pastel accents; request zones and original panther remain visible. Web343/API2929 passed, 2/115 skipped; dedicated KIZ DB suite excluded. TypeScript, 30-view contrast >=4.5:1, print exclusion, actual App persistence/theme/user checks and request table browser checks passed. Main selector, CSS and versioned import paths only; API/APK216/flags/schema/sold WMS unchanged. Full hashes/health verified; source parity false. Rollback logoff-web:before-la-panthera-light.

Web `sha256:eb0e9d15040e6512d3363ec3d87f99c2c280c9d47f709be4886cb244332880bb`; API `sha256:aba843bb78a45c4a1f06a25315f53210b8eaad6992d44f1bc02dfff97a8208e5`.
Baseline `2026-09-29-la-panthera-light`.

## Previous release

# Published PR408 / 29.09.2026

PR408: compact request table in all 11 themes. Two identity columns, client above composition, due date above status, actions above process. Existing actions and permissions retained. Web340 passed/2 skipped, API2929 passed/115 skipped (DB-dependent cases skipped, dedicated KIZ DB suite excluded), TypeScript and 11-theme actual-runtime mobile/desktop checks passed. Only request markup, CSS and versioned import paths changed. API, APK216, flags, schema and sold WMS unchanged. Full image/public hashes and health verified; source parity false. Rollback logoff-web:before-compact-request-columns.

Web `sha256:4d3bb184e13764d8bfbced614cb042986b24c4da16b1174e37889afc43c6f771`; API `sha256:aba843bb78a45c4a1f06a25315f53210b8eaad6992d44f1bc02dfff97a8208e5`.
Baseline `2026-09-29-compact-request-columns`.

## Previous release

# Published PR406 / 29.09.2026

PR406: ordinary WB unmarked non-SOS picking shows found/packed, then atomically ships stock and closes the complete request. Our-WMS flag only. Reviews collapsed individually over seven days. Mark-all-read uses existing scoped endpoints and full history pagination. Gold bell/count and monitoring top row in la_panthera. API2929/web339 passed, 91/2 skipped; isolated PostgreSQL24 plus packaged runtime24 passed; dedicated KIZ duplicate DB suite excluded. TypeScript, actual runtime browser, all hashes and health verified. APK216, schema, sold WMS unchanged; source parity false. Rollback logoff-api:before-ordinary-pick-reviews and logoff-web:before-ordinary-pick-reviews.

Web `sha256:299f32d7fb3eb66ab08bc4bb22bb870226cf3d9250e628ba03090ad658ea7034`; API `sha256:aba843bb78a45c4a1f06a25315f53210b8eaad6992d44f1bc02dfff97a8208e5`.
Baseline `2026-09-29-ordinary-pick-reviews`.

## Previous release

# Published PR404 / 29.09.2026

PR404: compact FBS selection controls along the top and action buttons below; matching green/amber/red request palette for zone buttons and elapsed timers. CSS-only, two files changed, all JavaScript/API unchanged. Desktop/narrow layout and actual runtime CSS browser tests passed, including other themes and print isolation. Web334/API2895 passed; 2/113 skipped, dedicated KIZ DB suite excluded. Full hashes and health verified; APK216, flags, schema, sold WMS unchanged. Source parity false. Rollback logoff-web:before-fbs-zone-colors.

Web `sha256:95ef7bb7954cf2ff21060cfcd25f408b455158f41b97109ee09cc9b78086fa71`; API `sha256:277d5a2c9c5dc21acb28df6d4197688cdb81c4bbf3ca8db4290a5340d855986b`.
Baseline `2026-09-29-fbs-zone-colors`.

## Previous release

# Published PR402 / 29.09.2026

PR402: graphite reconciliation surface, readable teal heading and subtle border in la_panthera. Personal shortcuts no longer expand their original navigation group; edit mode supports drag reorder in both directions and keyboard arrows, persisted per user in browser storage. Original groups and authorization remain intact. Web334/API2895 passed, 2/113 skipped, dedicated KIZ DB suite excluded. Browser source/runtime regressions and TypeScript passed. Full hashes and health verified; API277d5, APK216, flags, schema, sold WMS unchanged. Source parity false. Rollback logoff-web:before-reconciliation-nav.

Web `sha256:e17e49f27e77dce52f86e18386cf8fc29d9bd3e1102e181ad059c00d036f1fc9`; API `sha256:277d5a2c9c5dc21acb28df6d4197688cdb81c4bbf3ca8db4290a5340d855986b`.
Baseline `2026-09-29-reconciliation-navigation`.

## Previous release

# Published PR400 / 29.09.2026

PR400: complete creation form collapse with draft retention, exact status filters and stage sort labels in every theme. Safe batch DONE recognizes no-box sentinels and selects only a sole sufficient source; server strict stock guard rejects shortages and incomplete assembly without adjustments. Request majority colors include shipped orders until WMS terminal; individual timers use actual order age. Softer route/FBS buttons in la_panthera. Based on PR398 runtime, preserving OWNER sorting access. Web334/API2895 passed, 2/113 skipped, dedicated KIZ DB suite excluded. Browser tests and packaged API fixture passed; complete runtime/public hashes and health verified. APK216, schema, flags, sold WMS unchanged. Source parity remains false. Rollback logoff-web:before-request-polish and logoff-api:before-request-polish.

Web `sha256:6fb21ea4193cd208c1a989ea81b41b87a1cba9ea928394738611091360c171c0`; API `sha256:277d5a2c9c5dc21acb28df6d4197688cdb81c4bbf3ca8db4290a5340d855986b`.
Baseline `2026-09-29-request-polish`.

## Previous release

# Published PR398 / 29.09.2026 — OWNER sorting access

OWNER now sees and can open «Сортировка и перемещение», matching the existing server authority. Both OWNER and OWNER+ADMIN expose the same37 sections. Two web authorization checks and explanatory message changed; versioned29-module import graph retains current requests/themes. Web `sha256:aeda927dca4331f4978a15c96a4cbdc9fd0dd5142042d66d1fececfffb557218`. API/APK216, flags, data and sold WMS unchanged.

Validation: OWNER menu and screen failures reproduced before fix; web331 passed/2 skipped, API2917 passed/113 skipped; isolated KIZ integration suite unavailable. Web TypeScript, actual runtime menu/screen/role/demo checks, exact delta, public artifact hashes and health passed. Baseline `2026-09-29-owner-sorting`; source parity false. Rollback `logoff-web:before-owner-menu-20260929`.

## Previous release

# Published PR396 / 29.09.2026

PR396: request status sorting, collapsed Excel assembly, sequential bulk DONE with per-request results and strict no-source-only noBox. Cancelled and rejected requests are archived in all themes. Russian WB status badge. la_panthera: graphite/cyan navigation, independent collapsible groups, user-scoped browser favorites, toned request identities, original panther during fetch/body loading, dark panels and muted gradients. Runtime based on Soul Winx PR395 and API a83204; two web behavioral modules plus import graph/CSS, one API module with two archive predicates. Full hashes and public health verified; APK216, flags, schema and sold WMS unchanged. Web328/API2893 passed; 2/113 skipped and dedicated KIZ DB suite excluded. TypeScript and browser/runtime tests passed. Source parity remains false; full source rebuild must not replace production. Rollbacks: logoff-web:before-request-batch-theme and logoff-api:before-request-batch-theme.

Web `sha256:2262deb8564c040b6186b4c4016e738fd4cf7f56a1796d547a6b9ebc6fee7248`; API `sha256:7334f195b90d4d8e4f4915993974511c8ce49b3198f6a46569b0edabd799b2db`.
Baseline `2026-09-29-request-batch-theme`.

## Previous release

# Published PR385: la_panthera / 28.09.2026

PR385: la_panthera web contrast correction across 27 representative component states, larger dashboard/FBS labels, saturated icons and dark gradients. Original diploma GIF loader with reduced-motion still frame; readable graphite supply group headings, buttons and warehouse badges. Parallel spirit Cambria release (previous web 9636e1f3), API PR375, APK216, settings and other containers preserved. 281 web and 2891 API tests passed, 113 skipped; dedicated KIZ DB suite excluded. Browser contrast/isolation/print and runtime graph/font checks passed. Source parity false; runtime CSS overlay only. Rollback logoff-web:before-panther-loader.

Web `sha256:d6670224e2817dbcd893912ac1ae5ed773a10771b58c3dcec3278a026d2aae48`; API `sha256:a83204a8bb4819193a11ba7ba8a3b462c960ef772fc9d659c88a122dfd531f62`.
Baseline `2026-09-28-panther-loader`.

## Previous release

# Published PR381: la_panthera / 28.09.2026

PR381: la_panthera web contrast correction across 26 representative component states and 47 module stylesheet audit, larger dashboard/FBS labels, saturated icons and dark gradients. Red gradient navigation hover with reduced-motion support; compact dark payroll editor. Parallel spirit PR378/380 (previous web da2baf1a), API PR375, APK216, settings and other containers preserved. 281 web and 2891 API tests passed, 113 skipped; dedicated KIZ DB suite excluded. Browser contrast/isolation/print and runtime graph/font checks passed. Source parity false; runtime CSS overlay only. Rollback logoff-web:before-la-panthera-complete.

Web `sha256:97781c96c22ef56db57f31f301477b164cde4b525da76e8d5025e5cb19da16dc`; API `sha256:a83204a8bb4819193a11ba7ba8a3b462c960ef772fc9d659c88a122dfd531f62`.
Baseline `2026-09-28-la-panthera-complete`.

## Previous release

# Published PR377: la_panthera / 28.09.2026

PR377: la_panthera web contrast correction across 17 representative screens, larger dashboard/FBS labels, saturated icons and dark gradients. API PR375, APK216, settings and other containers preserved. 281 web and 2891 API tests passed, 113 skipped; dedicated KIZ DB suite excluded. Browser contrast/isolation/print and runtime graph/font checks passed. Source parity false; runtime CSS overlay only. Rollback logoff-web:before-la-panthera-contrast.

Web `sha256:e0c20c3932d110e206e3e7c85748f2dcca61193029e542d6657ad1765258f20d`; API `sha256:a83204a8bb4819193a11ba7ba8a3b462c960ef772fc9d659c88a122dfd531f62`.
Baseline `2026-09-28-la-panthera-contrast`.

## Previous release

# Published PR375: archive empty FBO boxes / 28.09.2026

API `sha256:a83204a8bb4819193a11ba7ba8a3b462c960ef772fc9d659c88a122dfd531f62`. Two-module overlay on PR372; web/APK216, configuration, other containers and previous flags preserved. `WMS_FBO_EMPTY_BOX_ARCHIVE_ENABLED=true` only for our WMS. After individual FBO picking and shipment history capture, genuinely empty active boxes are archived and detached from pallet-sort in the same transaction. Permanent boxes, nonzero balances, marks and active bindings remain protected. Default/sold behavior unchanged.

Validation: API2915 passed,113 skipped; separate KIZ integration suite unavailable. TypeScript passed. Eight regression/guard tests. Actual candidate processed12 PALET_SORT_141 boxes with idempotence, then rolled back; original12 active boxes and placements verified. After publication, these exact12 boxes were archived in a Serializable transaction with fresh scope/stock/mark/task checks and audit records. No stock/KIZ/history mutation. Before-state backup `/opt/logoff-wms-releases/dovoz-relabel-20260917/pallet141-before-archive.json`. Post-commit12 archived and0 placements verified. Runtime hashes/health verified.

Baseline `2026-09-28-fbo-empty-boxes` is API-only with web hash metadata; retain current web independently. Source parity remains false. Rollback image d5038358 / `logoff-api:before-fbo-empty-box-archive`; rolling back code does not undo audited box archival.

## Previous release

# Published PR374: la_panthera / 28.09.2026

PR374: opt-in la_panthera web theme with self-hosted Inter (SIL OFL), graphite panels and violet accents. Existing section layout retained. Android, printing, Excel, API image and other containers unchanged. Full web274 tests, TypeScript and actual runtime graph/browser/font loading passed. Public index, entry, CSS, WOFF2 and license hashes verified. Source parity false; source-reference remains historical. API runtime captured from verified PR372 snapshot. Rollback: logoff-web:before-la-panthera.

Web `sha256:5cee65f8c9b91255ee1beb174ef3c232942dfa51559d22c8e457181da47ca570`; API `sha256:d503835845d4684bb5388552dc9304aa4cfd61e71b40bb3f1b393247bc8a9b2c`.
Baseline `2026-09-28-la-panthera`.

## Previous release

# Published PR372: bounded FBS assignment retries / 28.09.2026

API `sha256:d503835845d4684bb5388552dc9304aa4cfd61e71b40bb3f1b393247bc8a9b2c`. One-method overlay on live OpenClaw image51484e2; all other runtime files preserved. `WMS_FBS_ASSIGNMENT_BUSY_GUARD_ENABLED=true` only for our WMS. Busy employee/device requests return Conflict without releasing the active lock or accumulating retries. The original operation is not forcibly cancelled; its historical hang remains unproven. API restart during publication cleared in-memory pending requests.

Validation: 2907 API tests passed, 113 skipped; dedicated KIZ database suite excluded. TypeScript and actual candidate enabled/disabled, exclusion and recovery tests passed. After publication the device-context request for Marifat returned the correct closed-request response for1508 in107ms. Physical open-request picking remains to be confirmed on TSD. No stock or KIZ changes; web, APK216, configuration and other containers unchanged. Sold WMS untouched. Rollback image51484e2 / tag `logoff-api:before-marifat-assignment-wait`.

Baseline `2026-09-28-fbs-assignment-wait` captures API runtime and records web hashes without a web archive; retain current web independently. Source parity remains false.

## Previous release

# OpenClaw опубликован 28.09.2026

Наша WMS: [PR355](https://github.com/Maxhead2011/wmsFF/pull/355),
[PR363](https://github.com/Maxhead2011/wmsFF/pull/363),
[PR366](https://github.com/Maxhead2011/wmsFF/pull/366), база `feature/wb-print-check`.
API image `sha256:51484e2ea51ba0ea5594fd0dcd741cfdd2363681fbe7f33333191ae8c93c09b8`.
Web нашего выпуска `sha256:cdaa134f2f0806b28310ae7ec872f7104840967042cfbbb2218beb7b3d36c019`;
последующее оформление уже дало web `sha256:912149dad82a9c0683326f4a66a797b077b65a6fd9e34b9ab3f33f0743ec43cf`.
В последнем web сохранены entry `openclaw-20260928-0.js`, новый помощник и его маршруты.
Перед следующим выпуском заново считать фактические image ID.

OpenClaw 2026.9.6, Node 24.19.0, модель `openai/gpt-5.6-sol`, ChatGPT/Codex OAuth.
Сервис `wms-openclaw` включён при загрузке. API получает приватную конфигурацию из
`/etc/wms-openclaw/wms-api.env`; доступ разрешён действующим владельцам и администраторам.
Прокси применяется только к OpenClaw. Firewall разрешает 18789/tcp только через мост
нашей сети `infra_default` из 172.18.0.0/16 к 172.18.0.1. Публичного слушателя нет.

Проверено через работающий API: задание `d8293e10-adb1-466f-95ec-4a700c4f4c85`
завершено `DONE`, команда выполнена один раз, повтор requestId вернул тот же ответ.
Клиенту отказано 403, прежнему чату — 409. Временные проверочные сессии закрыты.
Первое сетевое задание осталось UNKNOWN без повторения; файл им не создан.

Снимок API содержит 554 файла. `sourceParityVerified=false`: полная пересборка
не разрешена. Проверенный локальный снимок:
`C:/WMSFF2207/baselines/openclaw-published-20260928`.
Серверный снимок и отчёты:
`/opt/logoff-wms-releases/openclaw-wms-20260928/published-baseline`,
`published.json`, `end-to-end.json`. Для следующего кандидата применять
`release_baseline.py --baseline <этот снимок>` и сверять свежий image ID.
Предыдущие снимки ниже являются историей.

Тесты актуальной интеграционной базы: API 2905 passed / 113 skipped, web 280 passed, 6 Node и 11 Python проверок,
TypeScript web и изолированный серверный кандидат. KIZ integration suite требует
выделенную тестовую БД и не запускался на production. Резервные образы:
`logoff-api:before-openclaw-20260928`, `logoff-web:before-openclaw-20260928`.
Поздний откат не должен затирать последующие выпуски интерфейса.

# Published PR364: cabinet loading / 28.09.2026

API `sha256:2c5e58b7d57ac148e1bb8e6068c305b52679210eba74a68f8d2401da8a6a5ea2`; web `sha256:ebd933aef735ee17d2721121a939c715797c14c7e958fbdd7f1abff9f9cc358c`.

Published PR364: cabinet-only compact stock projection and issued/paid invoice list without unused charge metadata. Product display settings expanded above branch tiles and all-client overview; loading/errors visible. Same database snapshot confirms identical balance quantities and visible invoice totals/payments/items. Stock payload 74.7MB to7MB, invoice50.9MB to1.4MB; server6.5s to4.1s and6.7s to0.33s respectively. API2872/web271 passed;113 API tests skipped. Four runtime API modules only; latest Spirit CSS, other assets, flags, APK216 and other containers preserved. Sold WMS untouched. Source parity false.

Baseline `2026-09-28-cabinet-fast`.

## Previous release

# Published PR358: client product display / 28.09.2026

API `sha256:09a4f4cc84a4ad1bb08279f8c2c236ab679accf7f1a50131c8e990647cd10cfb`; web `sha256:d204e622e626f793f63d733fa9efea41e701f3f77d2e10a506f8c8a138c83d59`.

Published PR358: per-client selection of name, article, barcode, size and color in assembly/packing WMS and Android TSD. Default behavior retained until explicitly configured. WMS_CLIENT_PRODUCT_DISPLAY_ENABLED=true only on our WMS. SystemSetting storage, no migration or preference writes during release. Raw scanner fields, cached plans, print labels and Excel unchanged. API2868/web266/Android220 passed; API113 skipped. Runtime and browser graph checks passed; APK216 signature matches215 and DEX checks passed. Public assets/APK, exact API/web hashes, settings read and unauthenticated HTTP401 verified. Sold WMS and other containers untouched. Source parity remains false; source reference historical. Physical TSD interaction pending.

Baseline `2026-09-28-client-display`.

## Previous release

# Published PR356: weekly inventory review / 28.09.2026

API `sha256:882d31805242c776406f5f9fb8ed7e6887a33b07be9343c9abe14457dcc89c6c`; web `sha256:0c52bd5273ae6e32eaeefe356bcb71e6440e3e266e3b50a4f21815ef01b6eba2`.

Published PR356: inventory default reads bounded to seven days under the existing our-WMS physical-resolution flag; exact-ID historical access and global full-inventory movement lock retained. Both live admin reconciliation and legacy FBS queries are bounded. Audit error details identify SKU/counts and conflicting physical KIZ identities. Quick lookup hides zero-balance locations. API delta is two files against payroll352; web delta preserves the newer Spirit warm build e764be7 and consistently renames its shared module graph to avoid a second React runtime. All other runtime hashes, old web assets, APK215, flags, config and other containers unchanged. No operational data writes or new migration. API2884/web265 tests and TypeScript passed; 113 skipped, dedicated KIZ integration DB unavailable. Eight runtime flag combinations and nine browser notification/navigation scenarios passed. Published read-only dashboard plus detail checks took 798ms. Source parity remains false; source reference is historical, not a complete build source.

Baseline `2026-09-28-inventory-weekly`.

## Previous release

# Published PR352: payroll corrections / 28.09.2026

API `sha256:edaec90e3b3b9e777c0dc9d4f3083a4ad9fe60036a454c6e0022f016b629797b`; web `sha256:c958929305d4139a6f884cd2f6742a598c2cb307701d36a613aef01505e7a04e`. Shift time/lunch editing, audited cancellation, initial employee rates. Additive migration and generated Prisma Client deployed. Spirit PR350/351, KIZ PR348, FBS, flags and APK215 preserved. Exact runtime/public asset hashes and health verified. Candidate migration/CRUD checked in isolated database. API2899 passed/94 skipped, dedicated KIZ database suite excluded; web260 passed. Dark physical camera capture remains unresolved; APK unchanged.

Baseline `2026-09-28-payroll352`; source parity false. Live Prisma schema captured separately. Old API ignores cancelled shifts: rollback after user cancellations requires reconciliation.

## Previous release

# Published PR348: sorting KIZ review / 28.09.2026

PR348 опубликован 28.09.2026. API `sha256:9a3ec430469e30afeb1620b1a75852815976eba477325d5c06fcb9778313a9a9`. Только два модуля КИЗов; WMS_KIZ_SORTING_ADMIN_REUSE_ENABLED=true. Web, APK, остальные контейнеры и настройки сохранены. 30 runtime-тестов passed, точные хеши и health проверены. Read-only проверка рабочего API подтверждает поступление КИЗа заявки1494 через сортировку после прежней отгрузки. Разрешение администратора и физический повторный скан ещё не выполнялись. Source parity всей системы остаётся false.

Baseline `2026-09-28-kiz-sorting`.

## Previous release

# Published PR346: handling review / 27.09.2026

API `sha256:12fa527baadc9a49bee0422932e49311dd96f2a8ddc32cbc4a34f0a18af92f38`; web `sha256:a0d4dec5f81901fee35ffa90533051b2610fd5c6a53e39deed1062b4e439df86`. One-off operation tariff, correction/cancellation of REVIEW handling and employee activity filter. No migration; previous flags and APK215 unchanged. PR345 waves retained. Verified exact runtime hashes, public web assets, health and candidate transaction rollback. Tests: API2894 passed/94 skipped (dedicated KIZ duplicate suite excluded), web255, Android72, TypeScript and Android lint. Attendance APK0.2.2 built; physical UI validation pending. Baseline `2026-09-27-handling346`; source parity remains false.

## Previous release

# Published PR343: tablet attendance / 27.09.2026

API `sha256:d67de6f69a8ebd5902a913be8662f67ab0e79b6c8d775dc9987bcf8ea13b8c90`; web `sha256:597d5e296a51dcbf0d353321461255d3c55e4b8de0225f2732afdbfaf955e71b`. FOT settings: device registration, photo requests and disputed marks. Additive Attendance migration; device flag enabled only on our WMS. API2885, web248, Android72 tests passed; 94 API tests skipped and dedicated KIZ DB suite excluded. Candidate registration/shift/photo-request/revocation verified with rollback on server DB; exact deployed hashes and HTTP assets verified. APK215 unchanged; attendance0.2.1 installed by user, camera pending physical verification. Baseline `2026-09-27-attendance343`; source parity remains false.

## Previous release

# Published PR341 (27.09.2026): own ADMIN/OWNER ACCEPT_AS_IS now permits FBS continuation when the privileged picker personally accepted unchanged system stock. API `sha256:dbc95e8faadbb7188e4637a41ef95b55d336977ea1e7f02367f33f455570afc0`; baseline `2026-09-27-admin-accept-audit`. Existing our-WMS flag only; two runtime modules (validator and authenticated-role call-site). Saved BOX294 acceptance passed read-only on candidate and production; WORKER rejected. API2870, web247, TypeScript passed; 97 skipped, dedicated DB suite unavailable. Stock, KIZs, web, APK215 and other containers unchanged. Source parity false. Rollback `logoff-api:before-admin-accept`.

## Previous release

# Published PR339: completed FBO history / 27.09.2026

API `sha256:487a1cb0235e22d037643835be01f9e320243a9f97949d80b2a185afc06368f5`. Historical PACKED units of COMPLETED FBO no longer block an administrator recount; explicit active bindings remain protected. One runtime module changed; all flags, web and APK retained. API2860, web247, TypeScript passed; full current BOX_0222 confirmation with five KIZs verified on the published image and rolled back. No recount required for the saved 18:45 scans. No history/billing mutation. Baseline `2026-09-27-completed-fbo-history`; source parity false. Rollback `logoff-api:before-completed-fbo`.

## Previous release

# Published PR337: administrator physical KIZ confirmation / 27.09.2026

API `sha256:8d84800a7dbc197451799055bb3b0659dd1dd1a0f57b94cbf3e7963c7f8fc921`. Opt-in `WMS_INVENTORY_PHYSICAL_RESOLUTION_ENABLED=true` only on our WMS. Two inventory modules changed; all other runtime files, existing flags, web and APK215 preserved. Confirmed old registration conflicts can be corrected without duplicate destination stock; current assembly and newer-movement guards remain. API2859, web247, TypeScript and two real-data rollback checks passed. Baseline `2026-09-27-admin-physical-kiz`; 544 API files and 413 web files verified. Source parity remains false. Rollback: `logoff-api:before-admin-physical-337`. No migration.

## Previous release

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
