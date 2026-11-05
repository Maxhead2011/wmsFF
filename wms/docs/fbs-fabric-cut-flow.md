## Уточнение процесса 05.11.2026: списание по скану — кандидат, не опубликован

По решению Катерины отдельный этап CUT_FABRIC и кнопка «Нарезано» отменены.
Резерв создаётся при выдаче задания из рулонов; один успешный скан товара
подтверждает один готовый отрез и списывает его длину. Неверный ШК не списывает
ткань. Абсолютный счётчик защищает от повторного списания при повторе запроса.
`fabric-fbs-scan.ts` сохраняет производство и скан в одной транзакции. Для Ozon
сохраняется поштучный состав, включая смешанные заказы. Старый отдельный endpoint
confirm-fabric-cut отклоняет обращения без изменения данных. Неопубликованные
экран и кнопки Android удалены; используется обычный экран сканирования.

Проверено после подключения отмены: API 4433 passed / 9 skipped; TypeScript прошёл.
Целевые проверки — 40 passed, включая 8 PostgreSQL-сценариев. Отмена после паузы
освобождает ненарезанный резерв; повтор не возвращает списанные метры. Освобождение
подключено к отмене клиентской заявки и подтверждённой отмене WB/Ozon; ошибка
транзакции отменяет и смену статуса, и освобождение резерва. LOGOFF Android прошёл.

Release preparation update 2026-11-05 (not published): exact runtime overlay prepared,
13 changed/added modules; runtime Ozon 16, regression 30 and PostgreSQL 8 passed.
Full sequential integration: 60 passed / 107 skipped. LOGOFF unit tests and
unsigned release 253 build succeeded. Token patch helper: 3 tests passed after
correcting the test dependency root. No production changes made by this work.

Signing backup verified as PrivateKeyEntry, alias logoff-tsd-servers; secrets
remain outside Git. Certificate SHA256:
70715AF4C2EA269D393F9CFB15806AEEE920445A22AAC16248E76D621BEDE5DA.
This is distinct from the historic main-app certificate 52916D77... .
Verified user-supplied APK255 at /video/static/downloads/logoff-tsd-receipt-255.apk:
package pro.logoff.wms.tsd, 0.1.255-receipt-time, SHA256
5cc40334f3559932d36510dae9200895fd0fe8419bea3802cb295907cc000a19.
Its certificate matches the supplied backup. Server source254 was preserved and
the released ReceiptScanSnapshot changes reconstructed in an isolated copy.
All 4607 classes match after normalizing dex offsets, pool indices and debug
line numbers; non-code ZIP payload including manifest/resources matches byte
for byte (signature files excluded). Raw strings compared losslessly.

The candidate now preserves source255 server selection, per-server database/session
isolation, shared network client and receipt scan evidence. LOGOFF256 adds only
the fabric capability on this Android base. 328 Android tests passed, release
build succeeded, signed APK verified against the APK255 certificate. The old
certificate installation is not claimed upgrade-compatible. Physical TSD update
has not been tested. Keys/passwords are not tracked. PR target feature/la_panthera.
Full candidate service boot and release checks are still required; not published.

Опубликован PR866 (05.11.2026): отключённая серверная основа FBS из рулонов. WMS_FBS_FABRIC_CUT_ENABLED=false; выдача заданий и Android ещё не подключены, проблема готовых отрезов этим выпуском не закрыта. API sha256:451665ebbe686df5fb0ed19596cf68db06d58d7e538a74fe3a20d3f4f2621b04. Точный overlay12; runtime18, disabled-container, baseline8, health и хеши проверены. Остальные флаги, web, APK, данные и контейнеры сохранены; sold не менялся. База 2026-11-05-fabric-foundation-disabled; sourceParityVerified=false.

# FBS: производство отрезов под заказ

Статус 05.11.2026: PR866 в `feature/la_panthera` готовит **отключённую серверную основу**. Не является выпуском рабочего сценария нарезки на ТСД.
Проверенная серверная база — PR864, baseline `2026-11-05-wb-fbo-pause`; image ID API/web совпали с манифестом при чтении сервера.

## Готовые изолированные модули

- `fabric-fbs-ledger.ts`: непрерывные отрезы из отдельных рулонов, резерв целых миллиметров, абсолютное подтверждённое количество, повтор операции, освобождение только ненарезанного; проверка целостности сохранённых распределений.
- `fabric-fbs-order.ts`: резерв всех строк заказа целиком; контроль неизменности состава, раздельная идентичность кабинета, заказа, заявки и товарной строки.
- `fabric-fbs-store.ts`: существующая транзакционная блокировка `fabric.rolls.v1:<clientId>`, сохранение прочих полей JSON.
- `fabric-fbs-confirmation.ts`: порядок блокировок «заявка → ткань → задание», проверка владельца/устройства/заявки/склада/позиции; запись доказательства производства вызывается внутри той же транзакции. Сам модуль не вызывает маркетплейс и не создаёт фиктивных сканов.
- `fabric-fbs-protection.ts`: защита резервов от другого расхода, точное соответствие доказательства нарезки заказу отгрузки. Защита не зависит от флага выдачи новых заданий.
- `fabric-fbs-availability.ts`: точное сопоставление существующих артикулов ткани, проверка цельных отрезов; незавершённый исторический расход блокирует только свой материал/цвет/склад.

## Дополнительно проверено 05.11.2026

- `fabric-fbs-production.ts`: PACKING, аудит FABRIC_FBS_CUT и событие заявки в одной транзакции. Аудит содержит уменьшение объёма сырья для хранения.
- `fabric-fbs-assignment.ts`: резерв всех строк и назначение в одной транзакции; флаг установки, capability и настройки клиента; проверка склада, SKU, длины и общего количества позиции заявки.
- Новый `POST /tsd/fbs/tasks/:id/confirm-fabric-cut` получает владельца заказа из задания, проверяет сотрудника, устройство, филиал и блокировку инвентаризации. Заголовок `X-TSD-Fabric-Capability: fabric-cut-v1` отдельный от прежнего physical-pick-v1. Ответ cutUnits/cutMm/replay; клиентская обработка пока не подключена.
- Пять PostgreSQL test cases проверяют повтор, rollback, конкуренцию подтверждений/резервов и атомарную запись PACKING/аудита. Только отдельная локальная БД localhost:55469/kiz_duplicate_tests; production не используется для тестовых записей.
- `scripts/releases/fbs-fabric-cut/patch-material-writers.py` готовит три runtime-only модуля из проверенных SHA256 PR864. Четыре регрессии воспроизведены на старом snapshot; все шесть проверок проходят на кандидате. Защищены зарезервированные метры, credits привязаны к task/request/connection/order, учтена история хранения. Это ещё не полный release candidate.

## Обязательно закончить до включения рабочего сценария

### В работе: интеграция ТСД после PR867

Ветка `feature/fbs-fabric-cut-integration`, целевой PR — `feature/la_panthera`.
Добавлены исходники экрана CUT_FABRIC для LOGOFF, явное подтверждение одной
нарезанной единицы с абсолютным количеством и сохранением operationId до сети.
Ответ confirm-fabric-cut возвращает экран задания; прямые scan/complete вызовы
проверяют завершение нарезки. Подтверждение не заменяет ШК/КИЗ.
Эта интеграция **не опубликована и не готова к включению**: очередь, смешанный
состав Ozon, повторное назначение и отгрузка требуют завершения и сквозных тестов.
Особенно проверить автоматическое освобождение «нетронутого» задания: отсутствие
скана ещё не означает отсутствие произведённых отрезов. Отключение флага при
существующих резервах тоже требует отдельной защиты. Нельзя включать capability
и флаг в рабочей версии до завершения этих путей.

Промежуточно прошли 15 тестов task-state/endpoint и TypeScript `tsc --noEmit`.
Android подтверждение и сохранение запроса проверяются FbsFabricCutTest и
FbsPendingActionTest, включая реальный рендер MainActivity.

Запись PACKING подключена к отдельному серверному подтверждению. **Выдача задания и экран Android ещё не подключены**. Runtime-защита подготовлена отдельно и на сервере не установлена. Сквозной рабочий сценарий не завершён.

1. Готово в исходниках: запись PACKING и аудита в одной транзакции, rollback и конкуренция проверены на PostgreSQL.
2. Подключить проверку материала и резерв к очереди и назначению задания с точным составом всех строк Ozon, включая смешанные заказы. Не подменять сырьё готовым AVAILABLE.
3. Сохранить КИЗ, сканирование товара и штатное завершение; явное подтверждение нарезки не выдавать за скан.
4. Кандидат защиты runtime-only material writers подготовлен. Проверить полный сценарий отгрузки WB/Ozon, отмены и повторного задания; тест planner не заменяет проверку полного пути отгрузки.
5. Ввести отдельный флаг и настройку клиента. Проверить отключение с существующими резервами.
6. Добавить шаг «Нарезано» в LOGOFF Android с устойчивым operationId и capability, обновить UI метража. Sold flavor не менять.
7. Сверить новый production, собрать точный runtime overlay, проверить API/web/Android, PostgreSQL и артефакты; PR в `feature/la_panthera`, затем публикация и обновление baseline.

## Данные, требующие отдельной сверки

Прочитанный текущий реестр Бушковой содержит 32 незавершённых события расхода на 275 м (29 айвори, 3 красных). Это **не доказательство**, что нужно дополнительно списать 275 м из нынешних рулонов. Исторические события и метры не менялись в этой задаче. У остальных цветов этот признак отсутствует; проверка не должна блокировать весь клиентский учёт.

## Проверки

Первоначальные 62 unit-теста дополнены production/assignment/API/PostgreSQL/runtime проверками. В общем прогоне обнаружено отсутствие нового маршрута в справочнике внутренних API; счётчик и описание исправлены. Последовательный integration-прогон: 57 passed, 107 skipped (нет окружений для прочих интеграций). Тест переноса КИЗ имел ошибки в параллельном общем прогоне, но отдельно и в последовательном integration проходит. Длинный последовательный общий прогон пересёкся с редактированием production.spec и не является финальным.

Итоговые проверки текущего промежуточного состояния: 4408 passed / 9 skipped в общем наборе без integration-файлов; отдельно integration 57 passed / 107 skipped. Все 105 проверок fabric-fbs, включая PostgreSQL и runtime-кандидат, прошли. Финальный API build и git diff --check прошли. Это не подтверждает ещё отсутствующий сквозной сценарий Android/выдачи.

Логи: `D:/WMSFF/_Kof/work/fbs-fabric-unit-final2.log`, `D:/WMSFF/_Kof/work/fbs-fabric-integration-final.log`. RED runtime: `D:/WMSFF/_Kof/work/fabric-runtime-writers-red.log`. APK не менялся. Рабочая ветка `feature/fbs-fabric-cut-flow`, PR866 в `feature/la_panthera`.

## Отдельный отключённый выпуск

Пакет содержит восемь новых fabric-fbs helpers и точечные дополнения четырёх существующих JS-модулей: API handler, controller, capability decorator и справочник API. `prepare-disabled.py` сохраняет существующую runtime-функцию `withFbsTsdCapability`; полная замена локальным dist запрещена. Счётчик runtime справочника увеличивается на один (107 → 108), без переноса отличающегося локального значения.

`WMS_FBS_FABRIC_CUT_ENABLED=false` задан в образе. Очередь, Android, настройки клиентов, остатки и материал writers не изменяются этим пакетом. Проданная WMS не публикуется. Нельзя включать флаг до завершения списка выше.

Кандидат от PR864 прошёл `check-candidate` (ровно 12 JS). Реальные модули кандидата прошли 18 существующих проверок capability/переклейки и `disabled-runtime.cjs`: загрузка модулей, metadata маршрута, сохранение личности, отказ старым ТСД и отказ до чтения/записи БД при отключении. `release-disabled.py` проверяет image, полный состав файлов и неизменность compose перед заменой только API; при ошибке возвращает старый образ. Факт публикации фиксируется отдельно в current-production.
## Проверка кандидата интеграции нарезки 05.11.2026 — не опубликован

Ветка `feature/fbs-fabric-cut-integration`, предполагаемая цель PR — `feature/la_panthera`.
Подключены исходники очереди WB/Ozon, экран CUT_FABRIC, подтверждение нарезки,
откладывание с сохранением резерва и сканов, доказательство PACKING при отгрузке.
`fbs-fabric-queue.ts` проверяет включение поштучного состава Ozon до резерва;
обычные товары клиента остаются на прежнем пути. `fabric-fbs-shipment-proof.ts`
исключает уже отгруженные WB-задания и проверяет принадлежность производства заказу.

Проверки: API без integration — 4436 passed / 9 skipped; integration последовательно
на отдельной локальной БД — 57 passed / 107 skipped. TypeScript прошёл.
Android LOGOFF прошёл; в Ffullhab два падения ReceiptPlacementActivityTest и
ReceiptProgressActivityTest воспроизводятся также на исходном 9bbd7a40 без изменений.
Параллельный общий запуск integration дал три падения KIZ identity transfer;
отдельно на исходной и изменённой версии, а также последовательно они проходят.
Это ограничение тестового запуска, не доказательство ошибки production.

До выпуска остаются: обработка отмены отложенного задания и отмены на маркетплейсе,
сквозная проверка повторного назначения, точный runtime overlay (sourceParityVerified=false),
проверки собранного API/подписанного APK. Нельзя включать режим на основании одних unit-тестов.
Повторная read-only сверка сервера: API sha256:451665ebbe686df5fb0ed19596cf68db06d58d7e538a74fe3a20d3f4f2621b04;
web sha256:b62f4d4b5d6f7f0f067d75ad9240b724d3160fdcc278f283ef171cc0780627e3.
Production, флаги и бизнес-данные в ходе проверки не менялись.
