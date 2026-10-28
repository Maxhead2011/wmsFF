# Счётчики активных заявок FBO

Опубликовано 28.10.2026 через PR729. Итоговый baseline: `2026-10-28-fbo-counts`.
База исходников: 110c728f / PR722, опубликованный baseline по паспорту —
`2026-10-28-lamoda-inline`. Перед выпуском обязательна новая сверка сервера:
`sourceParityVerified=false`, полная сборка не является кандидатом выпуска.

## Поведение

Карточки FBO WB и FBO Ozon показывают число активных заявок WMS.
Поданные, на рассмотрении, согласованные, в работе и упакованные входят;
DONE, CANCELLED, REJECTED не входят. Это число заявок, а не единиц товара,
коробов, направлений или ещё не преобразованных в заявку планов.
Ozon определяется сохранённой связью ozonShipment. Lamoda/FBY исключены;
WB исключает связанные и исторические FBS, а также старые FBS/DBS-заголовки.

Новый GET `/client-requests/fbo-active-counts` наследует `client-requests:read`,
использует ClientScopeService и тот же warehouseScopeWhere, что список заявок.
Лимит списка в 200 строк не применяется, составы/файлы заявок не загружаются.
Веб обновляет результат раз в минуту, при фокусе и смене рынка/филиала/сессии;
устаревшие ответы отбрасываются. Ошибка показывается отдельно от нуля.

## Файлы и влияние

- client-requests.service.ts: activeFboCounts — только чтение.
- client-requests.controller.ts: защищённый маршрут до динамического ID.
- administration-internal-api.service.ts: описание и число маршрутов.
- web/lib/api.ts: fetchFboActiveCounts.
- FboWorkspace.tsx: запрос, жизненный цикл, FboActiveCount с существующим CSS FBS.
- fbo-active-counts.spec.ts / FboActiveCount.spec.tsx: автоматические проверки.

Серверный WMS_MARKETPLACE_WORKSPACES_ENABLED и веб VITE_MARKETPLACE_WORKSPACES_ENABLED
сохраняют выключенное по умолчанию поведение проданной WMS. Общие модули
заявок затронуты добавлением маршрута; существующие операции не изменены.
Схема, остатки, статусы, APK и печать не меняются.

## Проверки

Новый API-тест сначала упал из-за отсутствующего метода, после реализации прошёл.
Проверяются >200 заявок, различение рынков/legacy FBS, ограничения клиента и
филиала, отключённый флаг без обращения к БД, загрузка/ошибка/нулевой счётчик
и склонения. Полный API: 3854 passed / 155 skipped; web: 525 passed / 2 skipped.
Два dedicated KIZ DB integration suite исключены: отдельная БД не настроена.
TypeScript API/web и Vite build прошли. У сборки есть предупреждение о размере
чанков >500 kB. Проверка на опубликованном сайте пока не выполнялась.


## Кандидат выпуска после согласованного слияния

База — PR727/728 (77eec949), API ab1165557e6c, web 793e5412ba90.
При обнаружении параллельного веб-релиза подготовка была остановлена проверкой
образа; новый кандидат пересобран поверх него. Действующая Lamoda импортируется
из опубликованного модуля, включая удаление заявок и проверку дефицита.
Точный delta: 3 API JS + index.html и 2 новых веб-ресурса. Новая схема не нужна.
Полные тесты после объединения: API3875/web530,155/2 skipped; TypeScript API/web.
Кандидат: PostgreSQL5 и запуск полного API; браузер счётчиков5 и регрессия
маркетплейсов/Lamoda50 с синтетическим API. Никакие рабочие заявки тесты не меняли.
Скрипты воспроизводимости — scripts/releases/fbo-counts-20261028.

После публикации: health/public hashes passed, browser5 with synthetic API passed; live authenticated count endpoint returned 200 (WB2/Ozon3 in current actor scope), anonymous401. Rollback tags: logoff-api:before-fbo-counts-20261028 and logoff-web:before-fbo-counts-20261028. Other containers unchanged.
