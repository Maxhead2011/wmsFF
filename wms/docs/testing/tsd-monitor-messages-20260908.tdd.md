# Сообщения из мониторинга на ТСД — 08.09.2026

Этот документ фиксирует этап разработки. Последующая разрешённая публикация описана в [tsd-messages-162-release.md](tsd-messages-162-release.md).

Константин: написать сообщение в ВМС, показать крупным окном на ТСД, кнопка «ОК — прочитано».

## Результат и границы

- Ветка `feature/tsd-monitor-messages`, основана на `2c1fd9e` — актуальном коде LOGOFF APK161.
- Только WMSFF2207. Production, остатки, задания, КИЗы и статусы заказов не изменялись.
- Ничего не опубликовано. Для выпуска нужны проверенный PR, API+web и новый подписанный LOGOFF APK с повышением версии. Сейчас собран только debug APK, версия/ссылки скачивания не менялись.
- Предлагаемый PR: `feature/tsd-monitor-messages` → `fix/sorting-recorded-source-20260908` (база предыдущего PR76). Перед выпуском обновить remote refs и сверить актуальный production, не выкатывать целиком этот checkout.

## Как работает

Мониторинг ТСД → карточка устройства → «Сообщение». Текст 1–2000 символов, журнал последних 50 сообщений. Старое приложение явно требует обновления.

Сообщение адресуется точному heartbeat-идентификатору и сотруднику, находившемуся на устройстве при отправке. При смене сотрудника сообщение не передаётся новому пользователю. Непрочитанное сохраняется в БД и будет доступно исходному сотруднику при следующем подключении на том же ТСД. Нет фонового push в закрытое приложение: доставка через существующий heartbeat (обычно раз в 5 секунд при работающем приложении и связи).

Крупное полноэкранное окно поверх Activity сохраняет нижележащие поля/задание. Аппаратные клавиши сканера не подтверждают прочтение; требуется нажатие экранной кнопки. При ошибке подтверждения окно остаётся с предложением повторить. При выходе из учётной записи окно закрывается. Обработчик регистрируется только при `BuildConfig.FLAVOR == logoff`.

## Хранение / права / API

Без миграции: `TsdOperation.operationType=monitor_message`, `status=ACCEPTED` означает сохранение сообщения, **не прочтение**. Текст, отправитель и адресат в payload. Только `reviewedAt`/`reviewedByUserId` означают явное подтверждение получателем. Сообщения исключены из ленты складских операций; не создают ошибок `NEEDS_REVIEW`.

- GET/POST `/api/v1/administration/tsd-monitor/devices/:deviceCode/messages` — только владелец мониторинга (`administrationEnabled`, `system:admin`, не клиент/демо).
- POST принимает `{text, requestId}`; UUID повторной попытки обеспечивает идемпотентность через уникальный `operationKey`.
- POST `/api/v1/tsd/monitor/heartbeat` с `monitorMessages:true` — добавляет `message` в ответ. Получение не пишет `reviewedAt`.
- POST `/api/v1/tsd/monitor/messages/:id/read` — `stock:write`, сервер проверяет идентичность устройства из токена и адресата. Чужая отметка запрещена, повтор своей безопасен, первоначальное время не затирается.

## Файлы / функции / риск

| Файлы | Изменение | Риск |
|---|---|---|
| `apps/api/src/modules/tsd/tsd-monitor-messages.ts` | send/list/next/ack, идентичность, идемпотентность | Средний: адресация; тесты двух пользователей/устройств и повторов |
| `tsd-device.service.ts`, `tsd-device.controller.ts` в том же каталоге | capability heartbeat, отдельное подтверждение | Средний: обратная совместимость; старые команды не менялись |
| `apps/api/src/modules/administration/administration.service.ts`, `administration.controller.ts` | отправка/история, исключение сообщений из складской ленты | Низкий; права проверяются сервером |
| `administration-internal-api.service.ts` | два счётчика реестра +2/+1 | Низкий; проверено существующими тестами |
| `apps/android-tsd/app/src/main/java/pro/logoff/wms/tsd/MainActivity.java`, `network/WmsApi.java` | heartbeat, подтверждение, lifecycle | Средний; только LOGOFF |
| `MonitorMessageOverlay.java`, `MonitorMessageState.java` в каталоге ТСД | окно/очередь/повторы/смена аккаунта | Средний; физический ТСД нужен для окончательной проверки UI |
| `apps/web/src/components/monitoring/TsdMonitoringPanel.tsx`, `TsdMessagesDialog.tsx`, `tsd-monitoring.css`, `apps/web/src/lib/api.ts` | кнопка, форма, история | Низкий; браузерные проверки на синтетических данных |
| Новые тесты API/Android/web и локальная HTML-fixture | регрессии и browser QA | Не влияют на production |

В коде стоят `// ADDED` / `// FIX`, в проверках `// TEST`. Рефакторинга остатков/сборки нет. Общие Android-файлы компилируются обоими flavor, но активация и capability ограничены LOGOFF. Проданный сервер и APK не менялись.

## TDD / фактические команды

RED: API `vitest run test/tsd-monitor-messages.spec.ts` и web `vitest run src/components/monitoring/TsdMessagesDialog.spec.tsx` падали на отсутствующих модулях до реализации. Красные коммиты не делались: правило Константина запрещает коммит до зелёных тестов.

Первый полный API: 1494 теста, 3 падения реестра новых маршрутов. После точечного обновления двух счётчиков — **1502/1502 PASS** (добавлены дополнительные проверки).

GREEN:

```powershell
# cwd apps/api
./node_modules/.bin/vitest.cmd run --maxWorkers=2 --minWorkers=1
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node ../../node_modules/typescript/bin/tsc -p tsconfig.json
node --test --experimental-test-coverage --test-coverage-include=**/tsd-monitor-messages.js test/tsd-monitor-messages.integration.cjs
# cwd apps/web
./node_modules/.bin/vitest.cmd run --maxWorkers=2 --minWorkers=1
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node ../../node_modules/typescript/bin/tsc -p tsconfig.json
./node_modules/.bin/vite.cmd build
# Gradle (configured local JDK17/SDK)
gradle :app:testLogoffDebugUnitTest :app:testFfullhabDebugUnitTest :app:assembleLogoffDebug --no-daemon --console=plain
```

- 27 целевых API-тестов, включены в 1502 общих.
- 61 web-тест (3 новых).
- 58 Android-тестов на каждом flavor (2 новых).
- 3 дополнительных Node integration-теста жизненного цикла **с stateful тестовым журналом, не PostgreSQL**. Покрытие скомпилированного класса: строки 100%, ветви 95.24%, функции 100%. Это не покрытие всего проекта/Android UI.
- API typecheck/build, web typecheck/build, LOGOFF debug APK — PASS.
- Vite предупреждает о больших чанках и отсутствующих локальных font/image assets; эти старые файлы не менялись.

## Browser QA

Локально `vite --host 127.0.0.1 --port 5179 --strictPort`; запуск `node test/tsd-messages-browser.cjs` из apps/web, `PLAYWRIGHT_MODULE` указывает на настроенный bundled Playwright. Headless Edge, только mock HTTP и фиктивный сотрудник.

PASS: 375/768/1440 px без горизонтального overflow, отправка/статус ожидания, обновление readAt, 503 и повтор с тем же UUID, блокировка старого приложения, нет page errors. Скриншоты в `C:/WMSFF2207/reports/tsd-monitor-messages-20260908`.

Визуальная регрессия: INCONCLUSIVE — прежнего эталона этого нового окна нет. Полный аудит WCAG/Core Web Vitals не проводился. Это проверка рабочего сценария, а не утверждение о полной доступности.

Перед публикацией/после установки на тестовый физический ТСД проверить: получение во время сканирования, сохранение ШК/КИЗ под окном, Enter сканера, переход между Activity/сворачивание, обрыв Wi-Fi при ОК, перезапуск приложения и смена сотрудника. На реальном ТСД эти UI-сценарии пока не прогонялись.
