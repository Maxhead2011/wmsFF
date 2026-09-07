#!/usr/bin/env bash
set -euo pipefail
umask 077
exec 9>/run/logoff-wms-api-release.lock
flock -n 9
exec 8>/run/logoff-wms-web-release.lock
flock -n 8
b=/opt/logoff-wms-backups/tsd-cross-box-20260907
r=/opt/logoff-wms-releases/tsd-cross-box-20260907
api=sha256:29358b8ee669c901d144fc2695f388334d0623f82d72317d0cdc68929e8acf45
web=sha256:1981a1fef31c2fa945a04859fef82cf407b4878b61903c5239cc261ecb114af6
unchanged(){
 test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$api"
 test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$web"
}
hashapi(){ docker run --rm --network none "$1" sh -c 'find /app/apps/api/src /app/apps/api/dist -type f -exec sha256sum {} +' | sort; }
hashweb(){ docker run --rm --network none "$1" sh -c 'find /usr/share/nginx/html -type f -exec sha256sum {} +' | sort; }
case "${1:-}" in
 stage)
  unchanged; test ! -e "$b"; test ! -e "$r"; mkdir -m 700 "$b" "$r"
  cp /opt/logoff-wms/wms/.env "$b/env-before"; cp /opt/logoff-wms/wms/infra/docker-compose.yml "$b/compose-before.yml"
  docker inspect infra-postgres-1 --format '{{.Id}} {{.Image}} {{.State.StartedAt}}' > "$b/db-before"
  mkdir -p "$r/apps/api"
  docker cp infra-api-1:/app/apps/api/src "$r/apps/api/src"
  docker cp infra-api-1:/app/apps/api/test "$r/apps/api/test"
  cd "$r"; git apply -p2 --check /tmp/tsd-cross-box.patch
  git apply -p2 /tmp/tsd-cross-box.patch
  hashapi "$api" > "$b/api-before.sha256"; hashweb "$web" > "$b/web-before.sha256"
  cp /tmp/logoff-tsd-admin-box-count-158.apk "$r/"
  sha256sum "$r/logoff-tsd-admin-box-count-158.apk" | cut -d' ' -f1 > "$b/apk.sha256"
  docker exec infra-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$b/wms.dump"
  sha256sum "$b/wms.dump" > "$b/wms.dump.sha256"
  docker exec -i infra-postgres-1 pg_restore -l < "$b/wms.dump" > "$b/db-contents.txt"
  test -s "$b/db-contents.txt"; touch "$b/staged"; echo STAGED;;
 build)
  unchanged; test -f "$b/staged"; cd "$r"
  for target in api web; do
   docker build --network none --build-arg BASE_API="$api" --build-arg BASE_WEB="$web" -f /tmp/tsd-cross-box.Dockerfile --target "$target" -t "infra-$target:tsd-cross-box-20260907" . > "$b/$target-build.log" 2>&1
  done
  hashapi infra-api:tsd-cross-box-20260907 > "$b/api-candidate.sha256"
  hashweb infra-web:tsd-cross-box-20260907 > "$b/web-candidate.sha256"
  echo BUILT;;
 test)
  unchanged
  for variant in baseline candidate; do
   image="$api"; if test "$variant" = candidate; then image=infra-api:tsd-cross-box-20260907; fi
   status=0
   docker run --rm --network none -v "$b:/results" -e NODE_ENV=test -e WMS_TEST_OUR_LIVE_BASELINE=true -e WMS_PERMANENT_STORAGE_BOXES_ENABLED=false -e WMS_TSD_PHYSICAL_STOCK_RECONCILIATION_ENABLED=false -w /app/apps/api "$image" node node_modules/vitest/vitest.mjs run --reporter=json --outputFile="/results/full-$variant.json" --maxWorkers=1 --minWorkers=1 > "$b/full-$variant.log" 2>&1 || status=$?
   test "$status" -le 1; test -s "$b/full-$variant.json"; echo "TESTED_$variant"
  done
  docker run --rm --network none -w /app/apps/api infra-api:tsd-cross-box-20260907 node --test --experimental-test-coverage --test-coverage-include='**/dist/modules/stock/tsd-admin-box-recount.js' --test-coverage-lines=80 --test-coverage-branches=80 --test-coverage-functions=80 test/tsd-admin-box-recount.coverage.cjs > "$b/coverage.log" 2>&1
  node /tmp/tsd-cross-box-verify.cjs "$b" > "$b/verification.json"
  cat "$b/verification.json";;
 publish)
  unchanged; cd /opt/logoff-wms/wms; test ! -e "$b/published-at"
  node -e 'const p=require(process.argv[1]);if(!p.merged||!p.merge_commit_sha||p.head.ref!=="fix/tsd-admin-cross-box-reconciliation"||p.base.ref!=="fix/fbs-box-scan-route-consistency")process.exit(1)' "$b/pr-merged.json"
  cmp .env "$b/env-before"; cmp infra/docker-compose.yml "$b/compose-before.yml"; sha256sum -c "$b/wms.dump.sha256"
  node /tmp/tsd-cross-box-verify.cjs "$b"
  hashapi "$api" > "$b/api-before-now"; cmp "$b/api-before.sha256" "$b/api-before-now"
  hashweb "$web" > "$b/web-before-now"; cmp "$b/web-before.sha256" "$b/web-before-now"
  an=$(docker image inspect infra-api:tsd-cross-box-20260907 --format '{{.Id}}'); wn=$(docker image inspect infra-web:tsd-cross-box-20260907 --format '{{.Id}}')
  hashapi "$an" > "$b/api-candidate-now"; cmp "$b/api-candidate.sha256" "$b/api-candidate-now"
  hashweb "$wn" > "$b/web-candidate-now"; cmp "$b/web-candidate.sha256" "$b/web-candidate-now"
  rollback(){
   trap - ERR
   ca=$(docker inspect infra-api-1 --format '{{.Image}}'); cw=$(docker inspect infra-web-1 --format '{{.Image}}')
   if { test "$ca" != "$api" && test "$ca" != "$an"; } || { test "$cw" != "$web" && test "$cw" != "$wn"; }; then echo EXTERNAL_RELEASE_ROLLBACK_BLOCKED; return 1; fi
   docker tag "$api" infra-api:latest; docker tag "$web" infra-web:latest
   docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build api web
   echo APPLICATION_ROLLED_BACK
  }
  trap rollback ERR
  docker tag "$an" infra-api:latest
  docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 60 api
  ok=false; for n in $(seq 1 25); do if curl --max-time 5 -fsS http://127.0.0.1:3000/api/v1/health > "$b/health.json"; then ok=true; break; fi; sleep 2; done; test "$ok" = true
  for action in preview confirm; do test "$(curl --max-time 8 -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3000/api/v1/tsd/transfers/kiz-recount/$action -H 'Content-Type: application/json' -d '{}')" = 401; done
  docker tag "$wn" infra-web:latest
  docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 web
  curl --retry 5 --retry-delay 2 --retry-connrefused --max-time 20 -fsS https://wms.logoff.pro/api/v1/health > "$b/public-health.json"
  curl --retry 5 --retry-delay 2 --max-time 60 -fsS https://wms.logoff.pro/downloads/logoff-tsd-admin-box-count-158.apk > "$b/public.apk"
  test "$(sha256sum "$b/public.apk" | cut -d' ' -f1)" = "$(cat "$b/apk.sha256")"
  test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$an"; test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$wn"
  docker inspect infra-postgres-1 --format '{{.Id}} {{.Image}} {{.State.StartedAt}}' > "$b/db-after"; cmp "$b/db-before" "$b/db-after"; cmp .env "$b/env-before"
  trap - ERR; date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/published-at"; echo PUBLISHED;;
 *) echo 'stage|build|test|publish'; exit 2;;
esac
