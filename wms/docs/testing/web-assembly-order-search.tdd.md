# Поиск номера заказа для повторной печати

Задача Константина: добавить поиск по номеру заказа в веб-раздел «Сборка заказов».
Ветка: `fix/web-assembly-order-search-20260905`, создана от текущей рабочей ветки пилота SKU.
Production не изменялся. Предлагаемая база PR: `fix/fbs-box-scan-route-consistency`.

## Изменения и риск

| Файл / функция | Изменение | Риск |
| --- | --- | --- |
| `apps/web/src/components/order-assembly/OrderAssemblyPanel.tsx`: `reload`, `searchOrder`, форма истории | Отдельный ввод номера, серверный поиск, сброс дат, ошибки, защита от устаревшего ответа | Только история; обработчик КИЗ и механизм печати сохранены |
| `apps/web/src/lib/api.ts`: `fetchWebOrderAssemblyHistory` | Необязательный query `orderId` | Старый вызов без номера сохраняет URL |
| `apps/api/src/modules/marketplace-connections/marketplace-connections.controller.ts`: `webOrderAssemblyHistory` | Передаёт необязательный query | Существующие guards/permissions сохранены |
| `apps/api/src/modules/marketplace-connections/marketplace-connections.service.ts`: `webOrderAssemblyHistory` | Точный номер в WHERE до take300; валидация | Общий код: при переносе в проданную ВМС требуется проверка. Старый вызов и клиентские ограничения проверены тестами |
| `apps/api/test/web-assembly-order-search.spec.ts` | 7 регрессионных тестов | Только тесты |
| `apps/web/src/components/order-assembly/OrderAssemblyPanel.spec.ts` | 2 теста формы и API-клиента | Только тесты |
| `apps/web/test/order-search-browser.mjs` | Локальный браузерный сценарий с синтетическим API | Реальные данные и принтеры не используются |

Поиск относится к доступной истории `FbsWebKizStickerPrint`, а не ко всем заказам, никогда не печатавшимся этим механизмом. Частичное совпадение не используется, номер хранится строкой. Сам поиск выполняет GET; повторная печать — прежний POST по найденному ID. Остатки, статусы заказов, резервы, Android и схема БД не менялись.

## TDD и проверки

RED до правки production-кода: API 6 failed / 1 passed (нет orderId в WHERE/контроллере, старый заказ не найден, нет валидации); Web2 failed (нет поля и query). Тесты действительно исполнялись. Отдельный RED-коммит не делался: правило пользователя требует зелёных тестов перед каждым коммитом.

GREEN:

- API: `node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1 --reporter=json --outputFile=C:/WMSFF2207/tmp/order-search-api-tests.json` — **860/860**.
- Web: `node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1` — **36/36**.
- В обоих приложениях: `node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` — PASS (проектный lint).
- API TypeScript build — PASS; Web TypeScript + `node node_modules/vite/bin/vite.js build` — PASS.
- Прямой запуск установленного Vitest использован потому, что bundled pnpm попытался переустановить node_modules; переустановка не разрешалась и не выполнялась.
- Vite предупреждает об отсутствующих статических fonts/images и больших chunks; к поиску эти предупреждения не относятся, соседний код не менялся.

## Проверка браузером

`node test/order-search-browser.mjs`, Chromium/Edge headless, локальный Vite `127.0.0.1:5187`; тестовая авторизация и перехваченные API-ответы. Playwright берётся из `WMS_QA_PLAYWRIGHT`, executable из `WMS_QA_BROWSER` (или установленные defaults).

PASS: старый заказ, сброс ограничивающей даты, поиск только GET, существующий reprint POST и формирование двух этикеток (без физического принтера), отсутствие результата, API503 с понятной ошибкой, очистка старой таблицы при ошибке, игнорирование задержанного ответа после сброса. Нет JS pageerror. Ширины1440/768/375: поле поиска помещается на экран. Скриншоты просмотрены; кнопке сброса задана минимальная высота44px.

Ограничения: полный production-E2E и физическая печать не выполнялись. Нет baseline для визуального сравнения, полного accessibility-аудита и замеров Web Vitals. Coverage запускался, но `@vitest/coverage-v8` отсутствует; процент80% не подтверждён, зависимости без согласования не добавлялись.
