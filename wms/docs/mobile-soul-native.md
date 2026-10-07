# Нативный LOGOFF WMS / Soul — кандидат 04.10.2026

Рабочий модуль: `apps/android-mobile-logoff`, ветка `feature/mobile-soul-correction-history-20261004`
(продолжение `feature/mobile-soul-native-20261004`).
Исходная версия 0.5.3 (22) обнаружена в незакоммиченной рабочей папке
`C:/WMSFF2207/repository/wms/apps/android-mobile`; по разрешению Константина
сделана отдельная копия только общей части и конфигурации LOGOFF.
Оригинал не изменён. Мобильный модуль `apps/android-mobile` в серверной ветке
имеет более старую версию и НЕ является базой этого обновления.

Точки входа:

- `MainActivity` → `SoulHomeFragment` → `SoulMenu`: нативные группы и прежние экраны;
- `SettlementsFragment` → `MobileApi.settlements` → `billing/settlements`;
- `SettlementsFragment` → `MobileApi.closedPeriods` → `billing/period-close` (GET);
- `SettlementsFragment` → `MobileApi.invoiceCorrections` → `billing/period-close/corrections`
  (GET): последние 2000 записей по клиенту/филиалу за все даты, раскрытие по 25;
  `CorrectionHistoryPresentation` сохраняет знак серверной суммы и неизвестные типы;
- `OpenClawFragment` → `wms-ai/openclaw/{status,jobs}`; сохранённые requestId,
  серверная история, явная проверка результата, без автоматического повтора POST;
- `ThemeStore` и XML-ресурсы: Soul светлая/тёмная, системный serif вместо
  отсутствующего лицензированного файла Cambria.

Это промежуточный кандидат, НЕ полное покрытие всех функций веб-ВМС.
Точная матрица ограничений и команда проверки — в `apps/android-mobile-logoff/README.md`.
Новые мутации биллинга не подключены. На сервер ничего не опубликовано.
Не использовать debug APK для обновления: его подпись отличается. Для release
найден исходный ключ вне проекта; его сертификат совпал с APK пользователя.
