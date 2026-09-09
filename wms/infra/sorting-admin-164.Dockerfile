ARG BASE_API
ARG BASE_WEB
FROM ${BASE_API} AS build
COPY candidate/wms/apps/api/src/ /app/apps/api/src/
RUN cd /app/apps/api && node ../../node_modules/typescript/bin/tsc -p tsconfig.json
FROM ${BASE_API} AS api
# FIX: overlay only the two reviewed modules on the latest production image.
COPY --from=build /app/apps/api/src/modules/inventory/pallet-sorting.service.ts /app/apps/api/src/modules/inventory/pallet-sorting.service.ts
COPY --from=build /app/apps/api/src/modules/stock/sorting-written-off-recovery.ts /app/apps/api/src/modules/stock/sorting-written-off-recovery.ts
COPY --from=build /app/apps/api/dist/modules/inventory/pallet-sorting.service.js /app/apps/api/dist/modules/inventory/pallet-sorting.service.js
COPY --from=build /app/apps/api/dist/modules/stock/sorting-written-off-recovery.js /app/apps/api/dist/modules/stock/sorting-written-off-recovery.js
FROM sha256:4c2317440ce7f368d1b251a8b044a5f3e864723bda88d8411facf85d67e2261e AS web-proof
COPY base/wms/apps/web/src/ /app/apps/web/src/
RUN cd /app/apps/web && node ../../node_modules/typescript/bin/tsc -p tsconfig.json && node node_modules/vite/bin/vite.js build
FROM web-proof AS web-build
COPY candidate/wms/apps/web/src/ /app/apps/web/src/
RUN cd /app/apps/web && node ../../node_modules/typescript/bin/tsc -p tsconfig.json && node node_modules/vite/bin/vite.js build
FROM ${BASE_WEB} AS web
# FIX: preserve all old hashed assets and downloads for already-open browser sessions.
COPY --from=web-build /app/apps/web/dist/assets/ /usr/share/nginx/html/assets/
COPY --from=web-build /app/apps/web/dist/index.html /usr/share/nginx/html/index.html
COPY wms/apps/web/public/downloads/logoff-tsd.apk /usr/share/nginx/html/downloads/logoff-tsd-sorting-admin-164.apk
COPY wms/apps/web/public/downloads/logoff-tsd.apk /usr/share/nginx/html/downloads/logoff-tsd.apk
COPY wms/apps/web/public/downloads/logoff-tsd.json /usr/share/nginx/html/downloads/logoff-tsd.json
RUN chmod 0644 /usr/share/nginx/html/downloads/logoff-tsd*.apk /usr/share/nginx/html/downloads/logoff-tsd.json
