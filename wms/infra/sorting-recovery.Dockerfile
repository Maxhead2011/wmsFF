ARG BASE_API
ARG BASE_WEB
FROM ${BASE_API} AS api-build
COPY candidate/pallet-sorting.service.ts /app/apps/api/src/modules/inventory/pallet-sorting.service.ts
COPY candidate/stock-operations.service.ts /app/apps/api/src/modules/stock/stock-operations.service.ts
RUN cd /app/apps/api && node ../../node_modules/typescript/bin/tsc -p tsconfig.json
FROM ${BASE_API} AS api
# FIX: preserve every live module/config except the two reviewed sorting entry points.
COPY --from=api-build /app/apps/api/src/modules/inventory/pallet-sorting.service.ts /app/apps/api/src/modules/inventory/pallet-sorting.service.ts
COPY --from=api-build /app/apps/api/src/modules/stock/stock-operations.service.ts /app/apps/api/src/modules/stock/stock-operations.service.ts
COPY --from=api-build /app/apps/api/dist/modules/inventory/pallet-sorting.service.js /app/apps/api/dist/modules/inventory/pallet-sorting.service.js
COPY --from=api-build /app/apps/api/dist/modules/stock/stock-operations.service.js /app/apps/api/dist/modules/stock/stock-operations.service.js
FROM ${BASE_API} AS web-build
COPY apps/web/ /app/apps/web/
ENV VITE_PALLET_SORTING_ENABLED=true
RUN cd /app/apps/web && node -e "const fs=require('fs'),p='tsconfig.json',v=JSON.parse(fs.readFileSync(p));v.exclude=[...(v.exclude||[]),'src/**/*.spec.tsx'];fs.writeFileSync(p,JSON.stringify(v));" && node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit && node node_modules/vite/bin/vite.js build
FROM ${BASE_WEB} AS web
# FIX: keep old hashed bundles and all existing downloads, including the shared update channel.
COPY --from=web-build /app/apps/web/dist/assets/ /usr/share/nginx/html/assets/
COPY --from=web-build /app/apps/web/dist/index.html /usr/share/nginx/html/index.html
COPY logoff-tsd-sorting-recovery-160.apk /usr/share/nginx/html/downloads/logoff-tsd-sorting-recovery-160.apk
RUN chmod 0644 /usr/share/nginx/html/downloads/logoff-tsd-sorting-recovery-160.apk
