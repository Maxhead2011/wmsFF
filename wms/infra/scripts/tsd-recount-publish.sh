#!/usr/bin/env bash
set -euo pipefail
umask 077
exec 9>/run/logoff-wms-api-release.lock
flock -n 9
exec 8>/run/logoff-wms-web-release.lock
flock -n 8
b=/opt/logoff-wms-backups/tsd-admin-recount-20260907
cd /opt/logoff-wms/wms
api_base=$(cat "$b/api-image.txt")
web_base=$(cat "$b/web-image.txt")
api_new=$(docker image inspect infra-api:tsd-recount-20260907 --format '{{.Id}}')
web_new=$(docker image inspect infra-web:tsd-recount-20260907 --format '{{.Id}}')
test ! -e "$b/published-at.txt"
test -s "$b/pr-merged.json"
node -e 'const p=require(process.argv[1]);if(!p.merged||!p.merge_commit_sha)process.exit(1)' "$b/pr-merged.json"
test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$api_base"
test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$web_base"
cmp .env "$b/env-before"
cmp infra/docker-compose.yml "$b/compose-before.yml"
sha256sum -c "$b/wms.dump.sha256"
test -s "$b/database-contents.txt"
grep -q '383 passed' "$b/api-target-tests.log"
grep -q '5 passed' "$b/live-guard-tests.log"
node /tmp/tsd-recount-full-compare.cjs > "$b/full-comparison.json"
node /tmp/tsd-recount-artifacts.cjs > "$b/artifact-check.json"
docker exec infra-api-1 sh -c 'find /app/apps/api/src /app/apps/api/dist -type f -exec sha256sum {} +' | sort > "$b/api-precutover.sha256"
cmp "$b/api-before.sha256" "$b/api-precutover.sha256"
docker exec infra-web-1 sh -c 'find /usr/share/nginx/html -type f -exec sha256sum {} +' | sort > "$b/web-precutover.sha256"
cmp "$b/web-before.sha256" "$b/web-precutover.sha256"
docker run --rm --network none "$api_new" sh -c 'find /app/apps/api/src /app/apps/api/dist -type f -exec sha256sum {} +' | sort > "$b/api-candidate-now.sha256"
cmp "$b/api-candidate.sha256" "$b/api-candidate-now.sha256"
docker run --rm --network none "$web_new" sh -c 'find /usr/share/nginx/html -type f -exec sha256sum {} +' | sort > "$b/web-candidate-now.sha256"
cmp "$b/web-candidate.sha256" "$b/web-candidate-now.sha256"
docker run --rm --network infra_default --env-file .env -v /tmp/tsd-recount-readcheck.cjs:/opt/recount-readcheck.cjs:ro "$api_new" node /opt/recount-readcheck.cjs > "$b/readcheck-candidate.json"
rollback() {
  trap - ERR
  local ca cw
  ca=$(docker inspect infra-api-1 --format '{{.Image}}') || return 1
  cw=$(docker inspect infra-web-1 --format '{{.Image}}') || return 1
  if { test "$ca" != "$api_base" && test "$ca" != "$api_new"; } || { test "$cw" != "$web_base" && test "$cw" != "$web_new"; }; then echo ROLLBACK_BLOCKED_EXTERNAL_RELEASE; return 1; fi
  docker image tag "$api_base" infra-api:latest
  docker image tag "$web_base" infra-web:latest
  docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 60 api web
  echo ROLLED_BACK_APPLICATION_ONLY
}
trap rollback ERR
# FIX: switch application images only; never restore DB over ongoing warehouse work.
docker image tag "$api_new" infra-api:latest
docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 60 api
healthy=false
for n in $(seq 1 25); do
  if curl --connect-timeout 2 --max-time 5 -fsS http://127.0.0.1:3000/api/v1/health > "$b/api-health.json"; then healthy=true; break; fi
  sleep 2
done
test "$healthy" = true
test "$(docker exec infra-api-1 printenv WMS_TSD_PHYSICAL_STOCK_RECONCILIATION_ENABLED)" = true
for action in preview confirm; do
  test "$(curl --max-time 8 -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3000/api/v1/tsd/transfers/kiz-recount/$action -H 'Content-Type: application/json' -d '{}')" = 401
done
docker image tag "$web_new" infra-web:latest
docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 web
healthy=false
for n in $(seq 1 15); do
  if curl --connect-timeout 2 --max-time 5 -fsS http://127.0.0.1:3080/ > "$b/web-after.html"; then healthy=true; break; fi
  sleep 1
done
test "$healthy" = true
docker run --rm --network none "$web_new" cat /usr/share/nginx/html/index.html > "$b/web-candidate.html"
cmp "$b/web-candidate.html" "$b/web-after.html"
curl --max-time 20 -fsS https://wms.logoff.pro/ > "$b/public-web.html"
cmp "$b/web-candidate.html" "$b/public-web.html"
curl --max-time 20 -fsS https://wms.logoff.pro/api/v1/health > "$b/public-health.json"
node -e 'if(require(process.argv[1]).status!=="ok")process.exit(1)' "$b/public-health.json"
curl --max-time 60 -fsS https://wms.logoff.pro/downloads/logoff-tsd-kiz-recount-157.apk > "$b/public-recount.apk"
test "$(sha256sum "$b/public-recount.apk" | cut -d' ' -f1)" = 1e1d5b15078d97e64f5c84485ac324b1cfcf3f9c4f2d07cbb2e8214a97fbce1a
docker inspect infra-postgres-1 --format '{{.Id}} {{.Image}} {{.State.StartedAt}}' > "$b/database-after.txt"
cmp "$b/database-before.txt" "$b/database-after.txt"
cmp .env "$b/env-before"
test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$api_new"
test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$web_new"
trap - ERR
date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/published-at.txt"
echo TSD_RECOUNT_DEPLOY_OK
