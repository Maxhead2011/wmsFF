ARG BASE_API=sha256:fec74a0ee538fc9e7ace9c31b3a852b58a0cb7096bcea2ef299211024300c65a
ARG BASE_WEB=sha256:72fc0c1d4817b8a883b87e65224920f9f681544cca0f2bf0db42f48d14e88f71
FROM ${BASE_API} AS api-build
COPY candidate/wms/apps/api/prisma/ /app/apps/api/prisma/
RUN cd /app/apps/api && node node_modules/prisma/build/index.js generate --schema prisma/schema.prisma
COPY candidate/wms/apps/api/src/ /app/apps/api/src/
COPY wms/infra/scripts/wb-reshipment-release.cjs /release.cjs
RUN cd /app/apps/api && node ../../node_modules/typescript/bin/tsc -p tsconfig.json && node /release.cjs overlay /overlay
FROM ${BASE_API} AS api
COPY --from=api-build /overlay/app/ /app/
FROM api AS test
COPY wms/apps/api/test/ /app/apps/api/test/
# FIX: reproduce the live web artifact before applying only the reviewed overlay.
FROM sha256:48f786f84893530f3630eed79a985ceb57072075feea2e35d486442aa4056289 AS web-proof
COPY live-web/ /app/apps/web/src/
RUN cd /app/apps/web && node ../../node_modules/typescript/bin/tsc -p tsconfig.json && node node_modules/vite/bin/vite.js build
FROM web-proof AS web-build
COPY candidate/wms/apps/web/src/ /app/apps/web/src/
RUN cd /app/apps/web && node ../../node_modules/typescript/bin/tsc -p tsconfig.json && node node_modules/vite/bin/vite.js build
FROM ${BASE_WEB} AS web
COPY --from=web-build /app/apps/web/dist/assets/ /usr/share/nginx/html/assets/
COPY --from=web-build /app/apps/web/dist/index.html /usr/share/nginx/html/index.html
