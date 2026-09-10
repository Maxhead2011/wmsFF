ARG BASE_API
ARG BASE_WEB
FROM ${BASE_API} AS build
COPY candidate/wms/apps/api/src/ /app/apps/api/src/
RUN cd /app/apps/api && node ../../node_modules/typescript/bin/tsc -p tsconfig.json
FROM ${BASE_API} AS api
COPY --from=build /app/apps/api/src/modules/administration/administration-internal-api.service.ts /app/apps/api/src/modules/administration/administration-internal-api.service.ts
COPY --from=build /app/apps/api/dist/modules/administration/administration-internal-api.service.js /app/apps/api/dist/modules/administration/administration-internal-api.service.js
COPY --from=build /app/apps/api/src/modules/billing/billing.controller.ts /app/apps/api/src/modules/billing/billing.controller.ts
COPY --from=build /app/apps/api/dist/modules/billing/billing.controller.js /app/apps/api/dist/modules/billing/billing.controller.js
COPY --from=build /app/apps/api/src/modules/billing/billing.module.ts /app/apps/api/src/modules/billing/billing.module.ts
COPY --from=build /app/apps/api/dist/modules/billing/billing.module.js /app/apps/api/dist/modules/billing/billing.module.js
COPY --from=build /app/apps/api/src/modules/billing/billing.service.ts /app/apps/api/src/modules/billing/billing.service.ts
COPY --from=build /app/apps/api/dist/modules/billing/billing.service.js /app/apps/api/dist/modules/billing/billing.service.js
COPY --from=build /app/apps/api/src/modules/billing/dto/list-billing-invoices.dto.ts /app/apps/api/src/modules/billing/dto/list-billing-invoices.dto.ts
COPY --from=build /app/apps/api/dist/modules/billing/dto/list-billing-invoices.dto.js /app/apps/api/dist/modules/billing/dto/list-billing-invoices.dto.js
COPY --from=build /app/apps/api/src/modules/billing/request-billing-automation.service.ts /app/apps/api/src/modules/billing/request-billing-automation.service.ts
COPY --from=build /app/apps/api/dist/modules/billing/request-billing-automation.service.js /app/apps/api/dist/modules/billing/request-billing-automation.service.js
COPY --from=build /app/apps/api/src/modules/marketplace-connections/marketplace-connections.service.ts /app/apps/api/src/modules/marketplace-connections/marketplace-connections.service.ts
COPY --from=build /app/apps/api/dist/modules/marketplace-connections/marketplace-connections.service.js /app/apps/api/dist/modules/marketplace-connections/marketplace-connections.service.js
COPY --from=build /app/apps/api/src/modules/billing/billing-mutation.ts /app/apps/api/src/modules/billing/billing-mutation.ts
COPY --from=build /app/apps/api/dist/modules/billing/billing-mutation.js /app/apps/api/dist/modules/billing/billing-mutation.js
COPY --from=build /app/apps/api/src/modules/billing/billing-period-policy.ts /app/apps/api/src/modules/billing/billing-period-policy.ts
COPY --from=build /app/apps/api/dist/modules/billing/billing-period-policy.js /app/apps/api/dist/modules/billing/billing-period-policy.js
COPY --from=build /app/apps/api/src/modules/billing/billing-period.service.ts /app/apps/api/src/modules/billing/billing-period.service.ts
COPY --from=build /app/apps/api/dist/modules/billing/billing-period.service.js /app/apps/api/dist/modules/billing/billing-period.service.js
COPY --from=build /app/apps/api/src/modules/billing/dto/generate-billing-period.dto.ts /app/apps/api/src/modules/billing/dto/generate-billing-period.dto.ts
COPY --from=build /app/apps/api/dist/modules/billing/dto/generate-billing-period.dto.js /app/apps/api/dist/modules/billing/dto/generate-billing-period.dto.js
FROM sha256:4c2317440ce7f368d1b251a8b044a5f3e864723bda88d8411facf85d67e2261e AS web-proof
COPY base/wms/apps/web/src/ /app/apps/web/src/
RUN cd /app/apps/web && node ../../node_modules/typescript/bin/tsc -p tsconfig.json && node node_modules/vite/bin/vite.js build
FROM web-proof AS web-build
COPY candidate/wms/apps/web/src/ /app/apps/web/src/
RUN cd /app/apps/web && node ../../node_modules/typescript/bin/tsc -p tsconfig.json && node node_modules/vite/bin/vite.js build
FROM ${BASE_WEB} AS web
COPY --from=web-build /app/apps/web/dist/assets/ /usr/share/nginx/html/assets/
COPY --from=web-build /app/apps/web/dist/index.html /usr/share/nginx/html/index.html
FROM api AS test
COPY wms/apps/api/test/ /app/apps/api/test/
COPY wms/apps/api/src/modules/billing/billing-mutation.spec.ts /app/apps/api/src/modules/billing/billing-mutation.spec.ts
COPY wms/apps/api/src/modules/billing/billing-mutation-writers.spec.ts /app/apps/api/src/modules/billing/billing-mutation-writers.spec.ts
COPY wms/apps/api/src/modules/billing/billing-period.spec.ts /app/apps/api/src/modules/billing/billing-period.spec.ts
