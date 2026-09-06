ARG BASE_API
ARG BASE_WEB
FROM ${BASE_API} AS api
COPY apps/api/src/ /app/apps/api/src/
COPY apps/api/test/ /app/apps/api/test/
RUN cd /app/apps/api && node ../../node_modules/typescript/bin/tsc -p tsconfig.json
# FIX: enabled only in the WMSFF2207 release image, not in shared defaults.
ENV WMS_TSD_PHYSICAL_STOCK_RECONCILIATION_ENABLED=true
FROM ${BASE_API} AS web-build
COPY apps/web/ /app/apps/web/
RUN cd /app/apps/web && node -e "const fs=require('fs'); const p='tsconfig.json'; const c=JSON.parse(fs.readFileSync(p,'utf8')); c.exclude=[...(c.exclude||[]),'src/**/*.spec.tsx']; fs.writeFileSync(p,JSON.stringify(c));" && node ../../node_modules/typescript/bin/tsc --noEmit && node node_modules/vite/bin/vite.js build
FROM ${BASE_WEB} AS web
# FIX: preserve existing downloads and assets from the running image.
COPY --from=web-build /app/apps/web/dist/assets/ /usr/share/nginx/html/assets/
COPY --from=web-build /app/apps/web/dist/index.html /usr/share/nginx/html/index.html
COPY logoff-tsd-kiz-recount-157.apk /usr/share/nginx/html/downloads/logoff-tsd-kiz-recount-157.apk
