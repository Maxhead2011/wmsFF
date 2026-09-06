#!/usr/bin/env bash
set -euo pipefail
umask 077
exec 9>/run/logoff-wms-api-release.lock
flock -n 9
exec 8>/run/logoff-wms-web-release.lock
flock -n 8
b=/opt/logoff-wms-backups/permanent-return-20260906
r=/opt/logoff-wms-releases/permanent-return-20260906
test -e "$b/patch-applied"
test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$(cat "$b/api-image.txt")"
test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$(cat "$b/web-image.txt")"
cmp /opt/logoff-wms/wms/.env "$b/env-before"
cd "$r"
docker build --network none --build-arg BASE_API="$(cat "$b/api-image.txt")" --build-arg BASE_WEB="$(cat "$b/web-image.txt")" -f /tmp/permanent-return.Dockerfile --target api -t infra-api:permanent-return-20260906 . > "$b/api-build.log" 2>&1
docker build --network none --build-arg BASE_API="$(cat "$b/api-image.txt")" --build-arg BASE_WEB="$(cat "$b/web-image.txt")" -f /tmp/permanent-return.Dockerfile --target web -t infra-web:permanent-return-20260906 . > "$b/web-build.log" 2>&1
docker run --rm --network none -e NODE_ENV=test -e WMS_TEST_OUR_LIVE_BASELINE=true -e WMS_PERMANENT_STORAGE_BOXES_ENABLED=false -w /app/apps/api infra-api:permanent-return-20260906 node node_modules/vitest/vitest.mjs run test/tsd-storage-box-transfer.spec.ts test/fbs-picked-return-receipt.spec.ts test/fbs-online-remaining-progress.spec.ts test/fbs-terminal-queue.spec.ts test/fbs-terminal-queue.service.spec.ts test/box-code-policy.service.spec.ts test/shipped-kiz-source-lifecycle.spec.ts test/stock-whole-box-transfer.spec.ts test/fbs-permanent-box-lifecycle.spec.ts test/fbs-double-consumption.spec.ts test/fbs-picked-stock-proof.spec.ts --maxWorkers=1 --minWorkers=1 > "$b/api-target-tests.log" 2>&1
docker run --rm --network none -e NODE_ENV=test -e WMS_TEST_OUR_LIVE_BASELINE=true -e WMS_PERMANENT_STORAGE_BOXES_ENABLED=true -w /app/apps/api infra-api:permanent-return-20260906 node node_modules/vitest/vitest.mjs run test/fbs-stock-reservation-mark.spec.ts --maxWorkers=1 --minWorkers=1 > "$b/live-guard-tests.log" 2>&1
docker run --rm --network none infra-api:permanent-return-20260906 sh -c 'find /app/apps/api/src -type f -exec sha256sum {} +' > "$b/api-candidate.sha256"
docker run --rm --network none infra-api:permanent-return-20260906 sh -c 'find /app/apps/api/dist -name "*.js" -type f -exec sha256sum {} +' > "$b/dist-candidate.sha256"
docker run --rm --network none infra-web:permanent-return-20260906 sh -c 'find /usr/share/nginx/html -type f -exec sha256sum {} +' > "$b/web-candidate.sha256"
node /tmp/permanent-return-artifacts.cjs > "$b/artifact-check.json"
echo PERMANENT_RETURN_CANDIDATES_READY
