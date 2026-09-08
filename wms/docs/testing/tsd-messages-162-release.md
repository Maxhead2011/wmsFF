# Выпуск сообщений ТСД 162 — WMSFF2207

Константин разрешил публикацию 08.09.2026. Только wms.logoff.pro; FFULHAB не публикуется.

## Артефакт

- LOGOFF versionCode **162**, versionName **0.1.163-messages**; applicationId `pro.logoff.wms.tsd`, minSdk24 без изменений.
- Подписанный APK: **2258797 байт**, SHA256 `b61fe7c58c830c5306a7f0e96220332b5877518c689b600fcc58d7b3d42b9528`.
- Сертификат прежний: SHA256 `52916d7797ade50cc1c50bba8787b9d2307b1e5dfd4ea725bd7c3be0e64f989b`.
- После публикации: `/downloads/logoff-tsd-messages-162.apk`; `/downloads/logoff-tsd.apk` и `/downloads/logoff-tsd.json` указывают на тот же выпуск.

## Безопасное наложение

Функциональный коммит `d703079`, ветка `feature/tsd-monitor-messages`, PR в `fix/sorting-recorded-source-20260908`. База содержит предыдущий PR76 (merge `2161a5990f5c7213a1b73ac0ce9c844626cd501b`).

Действующие образы, проверенные перед сборкой:

- API `sha256:02746e4f2111650651d6f37437c5d36132da90b25047a2ea2029730ec9c8cef8`.
- Web `sha256:8bcefda0902c4fbf8f4cff05c62e45da931908581f890c32527ec0c8eb62a724`.

API исходники извлечены из работающего контейнера. Web исходники последнего выпуска взяты из `/tmp/sorting-recovery-release-20260907/apps/web`; проверочная сборка дала **тот же index.html и хеши всех его собранных assets**, что действующий сайт. На эти исходники наложен только diff функции. Различие CRLF в одном контроллере обработано через whitespace-only matching; содержательных конфликтов не было, three-way/автоматическое слияние не применялось.

Сценарии:

- `infra/scripts/tsd-messages-release.sh`: prepare → stage → test → publish EXPECTED_HEAD.
- `infra/scripts/tsd-messages-postgres.sh`: изолированная проверка реальной PostgreSQL; обязательный `sql-passed` перед publish.
- `infra/tsd-messages-release.Dockerfile`: extends actual live images; API меняет только 6 TS/JS-модулей, web сохраняет все старые hashed bundles и APK.
- `infra/scripts/tsd-messages-artifacts.cjs`: разрешённые исходники, хеши APK, сохранение всех прежних файлов, неизменность runtime Config.

Кандидаты:

- API `sha256:44178623ff5e3646732ba5e5d3541db9839e21109b17e23d5790b503d46482e3`.
- Web `sha256:c0d1214a0b71ecdb54d6e756cf3d8b83da8d659aa83d91d1a5305116e69ab98b`.

## Проверки и ограничения

Локально повторно пройдены: **1502 API-теста, 61 web-тест, 3 stateful integration-теста, 7 проверок состава выпуска, 58 Android-тестов каждого flavor**. API/web typecheck/build и signed LOGOFF release build прошли. Подпись/manifest APK проверены apksigner/aapt.

Полный тестовый прогон кандидата и реальная PostgreSQL запускаются отдельными обязательными шагами; фактические результаты сохраняются в защищённом каталоге backup ниже, маркеры `tests-passed` и `sql-passed` обязательны. PostgreSQL тест использует отдельную внутреннюю сеть и отдельную БД `tsd_messages_test`: производственная **схема без данных**, один вымышленный сотрудник и сообщения. Проверяет concurrent send, JSON-фильтр адресата, сохранение после переподключения, запрет чужого подтверждения и неизменность первого readAt. Тестовый контейнер останавливается после проверки.

Первый кандидатный прогон обнаружил 3 падения старых sorting-fixtures, оставшихся в базовом image. Применены **те же шесть read-only test mounts из утверждённого выпуска 161** (без изменения тестов или бизнес-кода); новый полный прогон использует исходный комплект предыдущего релиза плюс проверки сообщений. Первая попытка сохранена как `api-tests-old-fixtures.json`. Никакие падающие тесты не исключались.

Итог кандидата: **1526 PASS, 0 FAIL**, 3 stateful integration PASS. Изолированная PostgreSQL PASS: concurrentSendRows=1, explicitRead=true, reconnectPreserved=true, foreignAckRejected=true, stockWrites=0. Маркер `sql-passed`: `2026-09-08T12:01:48Z`; тестовый контейнер остановлен.

Физический ТСД не подключён: нативный UI на устройстве не проверен. Известное ограничение — при недоступности API подтверждения окно просит повторить ОК; статус «прочитано» не выставляется без ответа сервера. Доставка через heartbeat при работающем приложении, не через системный push.

## Публикация и откат

Все действия до `publish` выполняются без переключения production. `publish` разрешается только после MERGED PR с точным HEAD, зелёных тестов, проверки артефактов и неизменившихся текущих image ID. Публикуются API и web через `--no-deps --no-build`; БД/Redis/аналитика/другие контейнеры не перезапускаются.

Backup: `/opt/logoff-wms-backups/tsd-messages-162-20260908` — DB dump, исходные env/compose (секретные, не для Git), хеши, результаты тестов и фактическое `published-at`.
Staging: `/opt/logoff-wms-releases/tsd-messages-162-20260908`.
Откат: теги `infra-api:before-tsd-messages-162-20260908`, `infra-web:before-tsd-messages-162-20260908`; возврат образов, **не восстановление БД поверх новых рабочих операций**. Автоматический rollback при неуспешной проверке после переключения ограничен теми же исходными/кандидатными image ID.

После переключения обязательно: health, публичный index, 401 без авторизации на новых POST, metadata/hash обоих APK, неизменность env/compose и ID/start time посторонних контейнеров. Итог публикации фиксируется в `published-at` и комментарии PR; этот документ описывает процедуру, сам по себе не доказывает выкладку.
