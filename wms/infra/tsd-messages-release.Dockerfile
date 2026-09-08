ARG BASE_API
ARG BASE_WEB
FROM ${BASE_API} AS web-proof
COPY base/wms/apps/web/ /app/apps/web/
ENV VITE_PALLET_SORTING_ENABLED=true
RUN cd /app/apps/web && node -e "const fs=require('fs'),p='tsconfig.json',v=JSON.parse(fs.readFileSync(p));v.exclude=[...(v.exclude||[]),'src/**/*.spec.tsx'];fs.writeFileSync(p,JSON.stringify(v));" && node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit && node node_modules/vite/bin/vite.js build
FROM ${BASE_API} AS api-build
COPY candidate/wms/apps/api/src/ /app/apps/api/src/
RUN cd /app/apps/api && node ../../node_modules/typescript/bin/tsc -p tsconfig.json
FROM ${BASE_API} AS api
# FIX: overlay only reviewed modules onto the exact live image.
COPY --from=api-build /app/apps/api/src/modules/administration/administration.controller.ts /app/apps/api/src/modules/administration/administration.controller.ts
COPY --from=api-build /app/apps/api/src/modules/administration/administration.service.ts /app/apps/api/src/modules/administration/administration.service.ts
COPY --from=api-build /app/apps/api/src/modules/administration/administration-internal-api.service.ts /app/apps/api/src/modules/administration/administration-internal-api.service.ts
COPY --from=api-build /app/apps/api/src/modules/tsd/tsd-device.controller.ts /app/apps/api/src/modules/tsd/tsd-device.controller.ts
COPY --from=api-build /app/apps/api/src/modules/tsd/tsd-device.service.ts /app/apps/api/src/modules/tsd/tsd-device.service.ts
COPY --from=api-build /app/apps/api/src/modules/tsd/tsd-monitor-messages.ts /app/apps/api/src/modules/tsd/tsd-monitor-messages.ts
COPY --from=api-build /app/apps/api/dist/modules/administration/administration.controller.js /app/apps/api/dist/modules/administration/administration.controller.js
COPY --from=api-build /app/apps/api/dist/modules/administration/administration.service.js /app/apps/api/dist/modules/administration/administration.service.js
COPY --from=api-build /app/apps/api/dist/modules/administration/administration-internal-api.service.js /app/apps/api/dist/modules/administration/administration-internal-api.service.js
COPY --from=api-build /app/apps/api/dist/modules/tsd/tsd-device.controller.js /app/apps/api/dist/modules/tsd/tsd-device.controller.js
COPY --from=api-build /app/apps/api/dist/modules/tsd/tsd-device.service.js /app/apps/api/dist/modules/tsd/tsd-device.service.js
COPY --from=api-build /app/apps/api/dist/modules/tsd/tsd-monitor-messages.js /app/apps/api/dist/modules/tsd/tsd-monitor-messages.js
FROM web-proof AS web-build
COPY candidate/wms/apps/web/src/ /app/apps/web/src/
RUN cd /app/apps/web && node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit && node node_modules/vite/bin/vite.js build
FROM ${BASE_WEB} AS web
# FIX: retain every prior hashed bundle and download for open browser tabs.
COPY --from=web-build /app/apps/web/dist/assets/ /usr/share/nginx/html/assets/
COPY --from=web-build /app/apps/web/dist/index.html /usr/share/nginx/html/index.html
COPY wms/apps/web/public/downloads/logoff-tsd.apk /usr/share/nginx/html/downloads/logoff-tsd-messages-162.apk
COPY wms/apps/web/public/downloads/logoff-tsd.apk /usr/share/nginx/html/downloads/logoff-tsd.apk
COPY wms/apps/web/public/downloads/logoff-tsd.json /usr/share/nginx/html/downloads/logoff-tsd.json
RUN chmod 0644 /usr/share/nginx/html/downloads/logoff-tsd*.apk /usr/share/nginx/html/downloads/logoff-tsd.json
