ARG BASE_API
ARG BASE_WEB
FROM ${BASE_API} AS api
COPY apps/api/src/ /app/apps/api/src/
COPY apps/api/test/ /app/apps/api/test/
RUN cd /app/apps/api && node ../../node_modules/typescript/bin/tsc -p tsconfig.json
ENV WMS_PERMANENT_STORAGE_BOXES_ENABLED=true
FROM ${BASE_API} AS web-build
COPY apps/web/ /app/apps/web/
# FIX: runtime build has no web Vitest dependency; tests are checked separately locally.
RUN cd /app/apps/web && node -e "const fs=require('fs'),p='tsconfig.json',v=JSON.parse(fs.readFileSync(p));v.exclude=[...(v.exclude||[]),'src/**/*.spec.tsx'];fs.writeFileSync(p,JSON.stringify(v));" && node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit && node node_modules/vite/bin/vite.js build
FROM ${BASE_WEB} AS web
COPY --from=web-build /app/apps/web/dist/assets/ /usr/share/nginx/html/assets/
COPY --from=web-build /app/apps/web/dist/index.html /usr/share/nginx/html/index.html
