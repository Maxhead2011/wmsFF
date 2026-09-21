FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
RUN chmod -R a+rX apps/web/public
# FIX: Vite consumes these flags at build time; sold installations stay disabled.
ARG VITE_KIZ_REUSE_EVIDENCE_ENABLED=false
ENV VITE_KIZ_REUSE_EVIDENCE_ENABLED=${VITE_KIZ_REUSE_EVIDENCE_ENABLED}
ARG VITE_KIZ_REVIEW_QUEUE_ENABLED=false
ENV VITE_KIZ_REVIEW_QUEUE_ENABLED=${VITE_KIZ_REVIEW_QUEUE_ENABLED}
RUN pnpm --filter @logoff/wms-web build

FROM nginx:1.27-alpine AS runtime
COPY infra/web.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
