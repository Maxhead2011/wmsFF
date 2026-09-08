# Выпуск LOGOFF ТСД 161 и исправления сортировки

Константин разрешил публикацию 08.09.2026. Только WMSFF2207 / wms.logoff.pro.

Основной фикс: `7f9e537`. [Описание поведения и TDD](sorting-free-source-auto-kiz-20260908.tdd.md).
PR: `fix/sorting-free-source-auto-kiz-20260908` → `fix/sorting-recorded-source-20260908`.

## Дополнительные файлы выпуска

- `apps/android-tsd/app/build.gradle.kts`: только versionCode/versionName LOGOFF; другие flavors не меняются.
- `apps/web/public/downloads/logoff-tsd.apk` и `.json`: подписанный APK и актуальный канал обновления.
- `infra/scripts/tsd-default-update.test.cjs`, `tsd-default-update-verify.cjs`: версия и checksum нового артефакта.
- `infra/sorting-scan-release.Dockerfile`, `infra/scripts/sorting-scan-release.sh`: минимальные образы поверх действующих API/web, проверки, backup и rollback.
- `infra/scripts/sorting-scan-artifacts.cjs`, `.test.cjs`: fail-closed проверка точного состава изменений и идентичности конфигурации.
- `apps/api/test/pallet-sorting-free-source-postgres.cjs`, `infra/scripts/sorting-scan-postgres.sh`: RED/GREEN на синтетических данных в изолированной PostgreSQL.

Новая версия: code **161**, name **0.1.162-sorting-scan**.
Package: `pro.logoff.wms.tsd`, minSdk24.
Размер: 2256125 байт.
SHA256 APK: `8dc0a542d26f633fbf89895ff2a004fe6c5b77b3e6f3b62b2284f5a251122a96`.
Сертификат SHA256: `52916d7797ade50cc1c50bba8787b9d2307b1e5dfd4ea725bd7c3be0e64f989b` — совпадает с опубликованным code160.
Неизменяемый URL: `https://wms.logoff.pro/downloads/logoff-tsd-sorting-scan-161.apk`.
Подписание выполнено существующим локальным защищённым механизмом; секреты не добавлены в Git или отчёт.

## Проверки до коммита

- RED канала: `node --test infra/scripts/tsd-default-update.test.cjs` — 1 FAIL (`160 !== 161`), 3 PASS до изменения версии/метаданных.
- GREEN: `node --test --experimental-test-coverage infra/scripts/sorting-scan-artifacts.test.cjs infra/scripts/tsd-default-update.test.cjs` — 13 PASS. Новый verifier и verifier default-channel: 100% line/branch/function coverage. Это не покрытие всего проекта.
- Gradle `:app:testLogoffDebugUnitTest :app:testFfullhabDebugUnitTest :app:assembleLogoffRelease --no-daemon --console=plain`: PASS. По 56 тестов на flavor; FFULHAB APK не собирался и не публикуется.
- `apksigner verify --print-certs` и `aapt dump badging`: подпись, package и версия подтверждены.
- Полный локальный API: `vitest run --maxWorkers=2 --minWorkers=1 --reporter=json --outputFile=C:/WMSFF2207/tmp/sorting-scan-publish-api-serial.json` — 1475 PASS, 0 FAIL. Предшествующий параллельный прогон дал два 5-секундных timeout в billing-pdf; повторный полный прогон с ограничением workers прошёл без правок billing и без увеличения timeout.
- Полный web: 58 PASS, 0 FAIL; отчёт `C:/WMSFF2207/tmp/sorting-scan-publish-web.json`.
- API typecheck/build прошли при подготовке неизменившегося сервисного кода; серверный кандидат компилируется повторно.
- `git diff --check`, `node --check` SQL-теста и `bash -n` release-script: PASS.

## Изоляция выпуска и откат

Проверенная база API: `sha256:59e4401ee0d8217e2bfbbc7bfd8e6aa63bf4fe16bfa3ca1fe3d93501791d9b00`.
Проверенная база web: `sha256:d03cc1dfb22e1e16467e1924eb3c87d46ef18c54af8ba76a20ac3e326bb6b441`.
Live service совпал с `bfcbc19`: SHA256 `40489a78dd8cc05f567ff905ff2501b91b70e817f7dfbfeedf6959c8462ec50c`.

В API-образе могут измениться только `pallet-sorting.service.ts` и соответствующий `.js`. В web — default APK, его JSON и новый неизменяемый APK161. Веб-интерфейс не пересобирается, остальные APK/ассеты сохраняются. Никаких миграций, изменения `.env`, исправления production-остатков или принудительной установки на ТСД.

Серверная папка доказательств: `/opt/logoff-wms-backups/sorting-scan-161-20260908`.
Подготовка: `/opt/logoff-wms-releases/sorting-scan-161-20260908`.
Rollback tags: `infra-api:before-sorting-scan-161-20260908`, `infra-web:before-sorting-scan-161-20260908`.
Два shared release locks, проверка неизменившейся live-базы, checksum backup, merged PR с точным HEAD и сохранённые tested image IDs обязательны перед переключением. При ошибке восстанавливаются образы API и канала загрузки без отката рабочих данных. При обнаружении чужого нового релиза автоматический rollback блокируется.

Публикация разрешена скриптом только после полного теста live-derived API-кандидата и SQL RED/GREEN. SQL использует отдельную внутреннюю сеть, синтетическую базу и копию только схемы. Проверяются перенос двух КИЗ без исходного кода/с неизвестной подсказкой, конкурирующий скан, идемпотентность, неизменность общего количества и чужих размеров, отсутствие повторного прихода и сохранение внешнего короба после COMPLETE.

Фактические результаты server test, SQL и публикации сохраняются в указанной серверной папке и итоговом отчёте выпуска. Физическая установка на ТСД и аппаратный UI E2E не заявляются: устройство не подключено. После публикации пользователю требуется установить обновление поверх приложения, не удаляя его.
