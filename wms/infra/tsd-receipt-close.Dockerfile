ARG BASE_API
ARG BASE_WEB
FROM ${BASE_API} AS build
COPY wms/apps/api/src/modules/tsd/ /app/apps/api/src/modules/tsd/
RUN cd /app/apps/api && node ../../node_modules/typescript/bin/tsc -p tsconfig.json
FROM ${BASE_API} AS api
# FIX: retain the live application except the four reviewed receipt modules.
COPY --from=build /app/apps/api/src/modules/tsd/tsd-receipt.service.ts /app/apps/api/src/modules/tsd/tsd-receipt.service.ts
COPY --from=build /app/apps/api/src/modules/tsd/tsd-sync.service.ts /app/apps/api/src/modules/tsd/tsd-sync.service.ts
COPY --from=build /app/apps/api/src/modules/tsd/tsd-operation.types.ts /app/apps/api/src/modules/tsd/tsd-operation.types.ts
COPY --from=build /app/apps/api/src/modules/tsd/dto/scan-operation.dto.ts /app/apps/api/src/modules/tsd/dto/scan-operation.dto.ts
COPY --from=build /app/apps/api/dist/modules/tsd/tsd-receipt.service.js /app/apps/api/dist/modules/tsd/tsd-receipt.service.js
COPY --from=build /app/apps/api/dist/modules/tsd/tsd-sync.service.js /app/apps/api/dist/modules/tsd/tsd-sync.service.js
COPY --from=build /app/apps/api/dist/modules/tsd/tsd-operation.types.js /app/apps/api/dist/modules/tsd/tsd-operation.types.js
COPY --from=build /app/apps/api/dist/modules/tsd/dto/scan-operation.dto.js /app/apps/api/dist/modules/tsd/dto/scan-operation.dto.js
FROM ${BASE_WEB} AS web
# FIX: publish only the LOGOFF download channel; application assets stay unchanged.
COPY --chmod=644 wms/apps/web/public/downloads/logoff-tsd.apk /usr/share/nginx/html/downloads/logoff-tsd.apk
COPY --chmod=644 wms/apps/web/public/downloads/logoff-tsd.apk /usr/share/nginx/html/downloads/logoff-tsd-receipt-close-165.apk
COPY --chmod=644 wms/apps/web/public/downloads/logoff-tsd.json /usr/share/nginx/html/downloads/logoff-tsd.json
