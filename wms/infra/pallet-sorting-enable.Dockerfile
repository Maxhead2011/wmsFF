ARG BASE_API
ARG BASE_WEB
FROM ${BASE_API} AS api
# FIX: only the feature switch changes; compiled warehouse logic remains byte-identical.
ENV WMS_PALLET_SORTING_ENABLED=true
FROM ${BASE_API} AS web-build
COPY apps/web/ /app/apps/web/
ENV VITE_PALLET_SORTING_ENABLED=true
RUN cd /app/apps/web && node -e "const fs=require('fs'),p='tsconfig.json',v=JSON.parse(fs.readFileSync(p));v.exclude=[...(v.exclude||[]),'src/**/*.spec.tsx'];fs.writeFileSync(p,JSON.stringify(v));" && node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit && node node_modules/vite/bin/vite.js build
FROM ${BASE_WEB} AS web
COPY --from=web-build /app/apps/web/dist/assets/ /usr/share/nginx/html/assets/
COPY --from=web-build /app/apps/web/dist/index.html /usr/share/nginx/html/index.html
# FIX: versioned pilot artifact only; existing global APK/JSON are not replaced.
COPY logoff-tsd-sorting-159.apk /usr/share/nginx/html/downloads/logoff-tsd-sorting-159.apk
RUN chmod 0644 /usr/share/nginx/html/downloads/logoff-tsd-sorting-159.apk
