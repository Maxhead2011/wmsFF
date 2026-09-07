ARG BASE_API
ARG BASE_WEB
FROM ${BASE_API} AS api
# FIX: these directories are a checked patch of live source, not the host checkout.
COPY apps/api/src/ /app/apps/api/src/
COPY apps/api/test/ /app/apps/api/test/
RUN cd /app/apps/api && node ../../node_modules/typescript/bin/tsc -p tsconfig.json
FROM ${BASE_WEB} AS web
# FIX: additive download only; keep all existing UI assets and APKs byte-identical.
COPY logoff-tsd-admin-box-count-158.apk /usr/share/nginx/html/downloads/logoff-tsd-admin-box-count-158.apk
