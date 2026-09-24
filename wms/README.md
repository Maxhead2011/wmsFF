# WMS LOGOFF

**Начало работы с текущей нашей WMS:** [индекс](docs/README.md),
[паспорт опубликованного выпуска](docs/current-production.md),
[карта проекта](docs/project-map.md), [правила выпуска](docs/release-workflow.md).
Снимок от 25.09.2026 хранит фактически опубликованный код. Полное соответствие
исходников runtime пока не подтверждено; старый сценарий полной выкладки ниже
не использовать для обновления нашей WMS до сведения расхождений.

Новая WMS лежит в папке `wms`, чтобы не смешивать полноценный продукт с текущей статической заглушкой в корне репозитория.

## Что уже заложено

- `apps/api` - NestJS API, Prisma-схема, авторизация/RBAC, клиентские заявки, биллинг услуг/хранения/счетов/оплат, импорты XLSX, логистические тарифы, stock ledger, печать TSC и API для ТСД.
- `apps/web` - React/Vite интерфейс оператора/администратора с картой модулей.
- `apps/android-tsd` - Java native Android-ТСД с Room outbox, batch-синхронизацией и режимами приемки, перемещения и инвентаризации. Для нашей WMS используется flavor `logoff`; тесты: `gradle :app:testLogoffDebugUnitTest`.
- `infra` - Docker Compose, Nginx и скрипт бэкапа PostgreSQL.
- `docs` - архитектура, модули и созданные отдельные чаты по модулям.

## Локальный старт

```bash
cd wms
pnpm install
pnpm prisma:generate
pnpm test
pnpm dev:api
pnpm dev:web
```

## Production-идея

На VPS `wms.logoff.pro` разворачиваем `infra/docker-compose.yml`: Nginx принимает HTTPS, проксирует web и API, отдельно работают PostgreSQL, Redis и worker-процессы.

Секреты хранятся только в `.env` на сервере. В GitHub попадает `.env.example`, но не реальные пароли, токены и доступы.

Первичная выкладка на VPS:

```bash
cd /tmp
curl -fsSL https://raw.githubusercontent.com/Maxhead200/wmsFF/codex/wms-foundation/wms/infra/scripts/deploy-vps.sh -o deploy-vps.sh
sh deploy-vps.sh
```

После успешного health-check deploy чистит неиспользуемые Docker images/containers/build cache, но не трогает volumes с данными. Отключить можно через `DOCKER_CLEANUP_AFTER_DEPLOY=0`; если нужно оставить свежий кэш, задайте возрастной фильтр `DOCKER_PRUNE_UNTIL=24h`.
