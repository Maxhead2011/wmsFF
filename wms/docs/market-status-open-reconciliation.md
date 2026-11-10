# Сверка сдачи ФБС при пропущенных локальных стадиях

Подготовлено 10.11.2026, пока не опубликовано. Ветка `fix/market-status-open-reconciliation`.

При включённом `WMS_FBS_ACTION_STATUS_ENABLED` подтверждение передачи всех связанных заказов WB/Ozon переводит обычную исходящую заявку из SUBMITTED, IN_REVIEW, APPROVED, IN_WORK или PACKED в DONE. В историю записывается фактический исходный статус. Остатки, списания, задания и факты печати не изменяются; промежуточная упаковка не выдумывается.

Сохраняются проверки идентичности кабинетов/заказов, полноты ответа, всех активных привязок, MOVING, demo, повторной/аварийной сборки, актуальности наблюдения и CAS. DONE/CANCELLED/REJECTED не открываются заново. При выключенном флаге прежнее ограничение PACKED сохранено.

Планировщик расширяет выборку только для ФБС WB/Ozon. ФБО остаётся на прежней проверке PACKED и физической отгрузки. Lamoda и Яндекс не добавляются в планировщик.

Ручная кнопка называется «Проверить статусы открытых заявок» и поясняет область выбранного склада и доступов. API возвращает `needsAttention`: успешный HTTP-ответ с блокирующим условием отражается в «Требуют внимания». При неполной передаче явно сообщается, что подтверждены не все заказы. Отсутствие привязки ФБО, отметки загрузки WB и VALIDATION_ERROR Lamoda не скрываются как обычное ожидание.

Регрессии: тесты воспроизвели отказ ранних стадий, молчаливый пропуск и пропуск в планировщике до исправления. Проверяются оба МП, четыре ранние стадии, изоляция проданной ВМС, частичная передача, повторная сборка, конкурирующее изменение, запрет изменения конечных статусов, права и перенос привязки. Перед публикацией требуется проверка свежего runtime и отдельного кандидата: sourceParityVerified=false.

Проверено: API 4744 passed / 9 skipped (отдельные `*.integration.spec.ts` с БД исключены); web 625 passed / 2 skipped; web typecheck прошёл. API typecheck: три ошибки в неизменённых Ozon label test/Yandex FBY; независимая компиляция HEAD до правки воспроизводит те же три ошибки. Кандидат четырёх модулей подготовлен из baseline PR985: все токены старого исходника совпали с runtime, 38 сценариев скомпилированных функций прошли. Изменения бизнес-данных и публикация не выполнялись.

## Release candidate verification (2026-11-10)

Merged current PR985/986 with both documentation records preserved by user approval. API 4760 passed / 9 skipped; web 625 passed / 2 skipped. Dedicated database integration suites excluded. Exact current-runtime API4/web2 overlay passes 38 compiled helper scenarios and six actual-module browser checks. Full candidate startup/reload and published CSS controls24 pass. Runtime/source parity remains false; no full source replacement.
