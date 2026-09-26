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
