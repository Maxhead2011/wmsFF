ARG BASE_API
ARG BASE_WEB
FROM ${BASE_API} AS build
COPY candidate/wms/apps/api/src/ /app/apps/api/src/
RUN cd /app/apps/api && node ../../node_modules/typescript/bin/tsc -p tsconfig.json
FROM ${BASE_API} AS api
# FIX: preserve live code except the four reviewed recovery modules.
COPY --from=build /app/apps/api/src/modules/inventory/dto/pallet-sorting.dto.ts /app/apps/api/src/modules/inventory/dto/pallet-sorting.dto.ts
COPY --from=build /app/apps/api/src/modules/inventory/pallet-sorting.service.ts /app/apps/api/src/modules/inventory/pallet-sorting.service.ts
COPY --from=build /app/apps/api/src/modules/stock/stock-operations.service.ts /app/apps/api/src/modules/stock/stock-operations.service.ts
COPY --from=build /app/apps/api/src/modules/stock/sorting-written-off-recovery.ts /app/apps/api/src/modules/stock/sorting-written-off-recovery.ts
COPY --from=build /app/apps/api/dist/modules/inventory/dto/pallet-sorting.dto.js /app/apps/api/dist/modules/inventory/dto/pallet-sorting.dto.js
COPY --from=build /app/apps/api/dist/modules/inventory/pallet-sorting.service.js /app/apps/api/dist/modules/inventory/pallet-sorting.service.js
COPY --from=build /app/apps/api/dist/modules/stock/stock-operations.service.js /app/apps/api/dist/modules/stock/stock-operations.service.js
COPY --from=build /app/apps/api/dist/modules/stock/sorting-written-off-recovery.js /app/apps/api/dist/modules/stock/sorting-written-off-recovery.js
FROM ${BASE_WEB} AS web
# FIX: no web rebuild; preserve all existing bundles and prior APKs.
COPY wms/apps/web/public/downloads/logoff-tsd.apk /usr/share/nginx/html/downloads/logoff-tsd-kiz-recovery-163.apk
COPY wms/apps/web/public/downloads/logoff-tsd.apk /usr/share/nginx/html/downloads/logoff-tsd.apk
COPY wms/apps/web/public/downloads/logoff-tsd.json /usr/share/nginx/html/downloads/logoff-tsd.json
RUN chmod 0644 /usr/share/nginx/html/downloads/logoff-tsd*.apk /usr/share/nginx/html/downloads/logoff-tsd.json
