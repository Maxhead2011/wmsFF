ARG BASE_API
ARG BASE_WEB
FROM ${BASE_API} AS api
# ADDED: retain the exact running image and overlay only reviewed sources/tests.
COPY apps/api/src/ /app/apps/api/src/
COPY apps/api/test/ /app/apps/api/test/
RUN cd /app/apps/api && node ../../node_modules/typescript/bin/tsc -p tsconfig.json
# ADDED: publication initially remains disabled until independent runtime gates pass.
ENV WMS_PALLET_SORTING_ENABLED=false
FROM api AS verification
# TEST: maintenance utilities are test dependencies, not additions to the deployed API image.
COPY infra/scripts/permanent-return-live-adapter.cjs /app/infra/scripts/permanent-return-live-adapter.cjs
COPY verification/repair-lknov039-confirmed-empty.ts /app/apps/api/src/scripts/repair-lknov039-confirmed-empty.ts
FROM ${BASE_API} AS web-build
COPY apps/web/ /app/apps/web/
RUN cd /app/apps/web && node -e "const fs=require('fs'),p='tsconfig.json',v=JSON.parse(fs.readFileSync(p));v.exclude=[...(v.exclude||[]),'src/**/*.spec.tsx'];fs.writeFileSync(p,JSON.stringify(v));" && node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit && node node_modules/vite/bin/vite.js build
FROM ${BASE_WEB} AS web
COPY --from=web-build /app/apps/web/dist/assets/ /usr/share/nginx/html/assets/
COPY --from=web-build /app/apps/web/dist/index.html /usr/share/nginx/html/index.html
