# FIX: build a narrow overlay over the exact running image; never replace it with an older checkout.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY overlay/ /app/apps/api/
RUN cd /app/apps/api && node node_modules/prisma/build/index.js generate && node /app/node_modules/typescript/bin/tsc -p tsconfig.json
