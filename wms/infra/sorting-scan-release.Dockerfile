ARG BASE_API
ARG BASE_WEB
FROM ${BASE_API} AS build
COPY wms/apps/api/src/modules/inventory/pallet-sorting.service.ts /app/apps/api/src/modules/inventory/pallet-sorting.service.ts
RUN cd /app/apps/api && node ../../node_modules/typescript/bin/tsc -p tsconfig.json
FROM ${BASE_API} AS api
# FIX: preserve every other live module, including the independent SOS release.
COPY --from=build /app/apps/api/src/modules/inventory/pallet-sorting.service.ts /app/apps/api/src/modules/inventory/pallet-sorting.service.ts
COPY --from=build /app/apps/api/dist/modules/inventory/pallet-sorting.service.js /app/apps/api/dist/modules/inventory/pallet-sorting.service.js
FROM ${BASE_WEB} AS web
# FIX: immutable artifact plus default channel; do not rebuild web UI from the local checkout.
COPY wms/apps/web/public/downloads/logoff-tsd.apk /usr/share/nginx/html/downloads/logoff-tsd-sorting-scan-161.apk
COPY wms/apps/web/public/downloads/logoff-tsd.apk /usr/share/nginx/html/downloads/logoff-tsd.apk
COPY wms/apps/web/public/downloads/logoff-tsd.json /usr/share/nginx/html/downloads/logoff-tsd.json
RUN chmod 0644 /usr/share/nginx/html/downloads/logoff-tsd*.apk /usr/share/nginx/html/downloads/logoff-tsd.json
