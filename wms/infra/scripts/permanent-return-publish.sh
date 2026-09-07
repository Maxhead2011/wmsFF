#!/usr/bin/env bash
set -euo pipefail
umask 077
exec 9>/run/logoff-wms-api-release.lock
flock -n 9
exec 8>/run/logoff-wms-web-release.lock
flock -n 8
b=/opt/logoff-wms-backups/permanent-return-20260906
cd /opt/logoff-wms/wms
api_base=$(cat "$b/api-image.txt")
web_base=$(cat "$b/web-image.txt")
api_new=$(docker image inspect infra-api:permanent-return-20260906 --format '{{.Id}}')
web_new=$(docker image inspect infra-web:permanent-return-20260906 --format '{{.Id}}')
test ! -e "$b/published-at.txt"
test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$api_base"
test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$web_base"
cmp .env "$b/env-before"
cmp infra/docker-compose.yml "$b/compose-before.yml"
test -s "$b/database-contents.txt"
sha256sum -c "$b/wms.dump.sha256"
grep -q '266 passed' "$b/api-target-tests.log"
grep -q '5 passed' "$b/live-guard-tests.log"
node /tmp/permanent-return-artifacts.cjs > "$b/artifact-check.json"
docker run --rm --network none "$api_new" sh -c 'find /app/apps/api/src -type f -exec sha256sum {} +' | sort > "$b/api-candidate-now.sha256"
sort "$b/api-candidate.sha256" > "$b/api-candidate-sorted.sha256"
cmp "$b/api-candidate-now.sha256" "$b/api-candidate-sorted.sha256"
docker exec infra-api-1 sh -c 'find /app/apps/api/src -type f -exec sha256sum {} +' | sort > "$b/api-precutover.sha256"
sort "$b/api-before.sha256" > "$b/api-before-sorted.sha256"
cmp "$b/api-before-sorted.sha256" "$b/api-precutover.sha256"
docker exec infra-web-1 sh -c 'find /usr/share/nginx/html -type f -exec sha256sum {} +' | sort > "$b/web-precutover.sha256"
sort "$b/web-before.sha256" > "$b/web-before-sorted.sha256"
cmp "$b/web-before-sorted.sha256" "$b/web-precutover.sha256"
docker run --rm --network infra_default --env-file .env -v /tmp/permanent-return-readcheck.cjs:/opt/permanent-return-readcheck.cjs:ro "$api_new" node /opt/permanent-return-readcheck.cjs > "$b/readcheck-candidate.json"
docker inspect infra-postgres-1 --format '{{.Id}} {{.Image}} {{.State.StartedAt}}' > "$b/database-before.txt"
rollback() {
  trap - ERR
  local current_api current_web
  current_api=$(docker inspect infra-api-1 --format '{{.Image}}') || return 1
  current_web=$(docker inspect infra-web-1 --format '{{.Image}}') || return 1
  if { test "$current_api" != "$api_base" && test "$current_api" != "$api_new"; } ||
     { test "$current_web" != "$web_base" && test "$current_web" != "$web_new"; }; then
    echo ROLLBACK_BLOCKED_EXTERNAL_RELEASE; return 1
  fi
  docker image tag "$api_base" infra-api:latest
  docker image tag "$web_base" infra-web:latest
  docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 60 api web
  echo ROLLED_BACK_APPLICATION_ONLY
}
trap rollback ERR
# FIX: only application containers switch; no database restore/migration or stock repair runs.
docker image tag "$api_new" infra-api:latest
docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 60 api
healthy=false
for n in $(seq 1 25); do
  if curl --connect-timeout 2 --max-time 5 -fsS http://127.0.0.1:3000/api/v1/health > "$b/api-health.json"; then healthy=true; break; fi
  sleep 2
done
test "$healthy" = true
test "$(docker exec infra-api-1 printenv WMS_PERMANENT_STORAGE_BOXES_ENABLED)" = true
test "$(docker exec infra-api-1 printenv WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED)" = true
docker cp /tmp/permanent-return-readcheck.cjs infra-api-1:/tmp/permanent-return-readcheck.cjs
docker exec infra-api-1 node /tmp/permanent-return-readcheck.cjs > "$b/readcheck-after.json"
test "$(curl --max-time 8 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/v1/client-requests)" = 401
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
curl --max-time 15 -fsS https://wms.logoff.pro/ > "$b/public-web.html"
cmp "$b/web-candidate.html" "$b/public-web.html"
curl --max-time 15 -fsS https://wms.logoff.pro/api/v1/health > "$b/public-health.json"
node -e 'if(require(process.argv[1]).status!=="ok")process.exit(1)' "$b/public-health.json"
docker inspect infra-postgres-1 --format '{{.Id}} {{.Image}} {{.State.StartedAt}}' > "$b/database-after.txt"
cmp "$b/database-before.txt" "$b/database-after.txt"
cmp .env "$b/env-before"
test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$api_new"
test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$web_new"
trap - ERR
date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/published-at.txt"
echo PERMANENT_RETURN_DEPLOY_OK
