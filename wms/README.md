Published PR952 / release guard PR953 (2026-11-09): restored FBS loading after the inline reserve editor bundled an incompatible automatic JSX runtime. Classic JSX and lazy shared-React forwarding; immutable FBS/editor URLs. Actual production graph reproduced ReactCurrentDispatcher failure before fix; public FBS navigation/reload and singleton startup now pass. Exact web3; API container, environment, other containers, stock/reserve settings and sold WMS unchanged. Web619 passed/2 skipped, TypeScript, editor save/version/conflict, controls24 and environment order/value regression passed. Baseline `2026-11-09-fbs-startup`; 10 public web hashes verified; sourceParityVerified=false.

Published PR949 / guard PR950 (2026-11-09): fabric tile and page now reuse the existing own-installation host scope, including alternate configured addresses. Exact web2 overlay on PR947; inline product safety reserves, API container, environment, business data and other containers retained. Web619 passed/2 skipped, typecheck, runtime host-scope2 RED/GREEN and guard environment1 passed. Actual public startup/reload and synthetic fabric workflow passed on alternate address and domain; controls24 and request header/disclosures12 before/after. CI passed. Baseline `2026-11-09-fabric-host`; sourceParityVerified=false. No physical TSD or printer change.

Published PR895 (2026-11-07): permanent Ozon physical reconciliation and inbound composition controls in online assembly. AVAILABLE/PICKED bases; CONTROL uses closed packed boxes. Saved scans, boxes, stock movements and sold WMS preserved. Exact API3/web6 overlay; all749 published API files match tested candidate, six public file hashes and API health verified. API4507/web600 passed (9/2 skipped; DB integration suites excluded), isolated PostgreSQL/full API boot passed, runtime API8/browser30, published browser30 plus inbound-list regression8 passed with synthetic API. Deployment environment comparison normalized in PR896 (three tests); initial guard rollback verified before successful publication. Environment, other containers and TSD258 unchanged. Baseline `2026-11-07-ozon-physical`; sourceParityVerified=false. API sha256:2f27603ad251273472c4219ec1ac65f2b8b80519a50afd84166a644acc7bda55; web sha256:9a371a8d27e959e88e8915f53fee4e7c4333840c11599816c30f9ec30df2f5c9.
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
