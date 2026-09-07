#!/usr/bin/env bash
set -euo pipefail
umask 077
b=/opt/logoff-wms-backups/admin-sorting-enable-20260907
r=/tmp/admin-sorting-pr63-check.3lEy8q
api=sha256:cde1b46bb651d976ae49f5c4123bdb13d3e3ad25af122879a1b1561845b98863
web=sha256:bfb907ccb3bc709c616968ef8127926cef55afbc5d7672852e4a037c6d00f234
exec 9>/run/logoff-wms-api-release.lock; flock -n 9
exec 8>/run/logoff-wms-web-release.lock; flock -n 8
same() { test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$api"; test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$web"; }
hashapi() { docker run --rm --network none --entrypoint sh "$1" -c 'find /app/apps/api/src /app/apps/api/dist -type f -exec sha256sum {} +' | sort; }
hashweb() { docker run --rm --network none --entrypoint sh "$1" -c 'find /usr/share/nginx/html -type f -exec sha256sum {} +' | sort; }
case "${1:-}" in
 stage)
  same; test ! -e "$b"; mkdir -m 700 "$b"
  cp /opt/logoff-wms/wms/.env "$b/env-before"; cp /opt/logoff-wms/wms/infra/docker-compose.yml "$b/compose-before"
  docker inspect infra-postgres-1 --format '{{.Id}} {{.State.StartedAt}}' > "$b/db-before"
  docker tag "$api" infra-api:before-sorting-enable-20260907; docker tag "$web" infra-web:before-sorting-enable-20260907
  docker exec infra-postgres-1 pg_dump -U wms -d wms -Fc > "$b/wms.dump"
  docker exec -i infra-postgres-1 pg_restore --list < "$b/wms.dump" > "$b/database-contents.txt"
  sha256sum "$b/wms.dump" > "$b/backup.sha256"
  # TEST: preserve the exact source set already verified before staged publication.
  (cd "$r/apps/web" && find src -type f -exec sha256sum {} + | sort) > "$b/web-source-now"
  cmp "$b/web-source-now" /opt/logoff-wms-backups/admin-sorting-staged-20260907/web-src-candidate.sha256
  for target in api web; do docker build --network none --build-arg BASE_API="$api" --build-arg BASE_WEB="$web" -f /tmp/pallet-sorting-enable.Dockerfile --target "$target" -t "infra-$target:sorting-enabled-20260907" "$r" > "$b/$target-build.log" 2>&1; done
  hashapi "$api" > "$b/api-before.sha256"; hashapi infra-api:sorting-enabled-20260907 > "$b/api-after.sha256"
  hashweb "$web" > "$b/web-before.sha256"; hashweb infra-web:sorting-enabled-20260907 > "$b/web-after.sha256"
  docker image inspect "$api" --format '{{json .Config}}' > "$b/config-before.json"
  docker image inspect infra-api:sorting-enabled-20260907 --format '{{json .Config}}' > "$b/config-after.json"
  node /tmp/pallet-sorting-enable-verify.cjs "$b" > "$b/verification.log"
  docker run --rm --network none infra-api:sorting-enabled-20260907 node -e 'const p=require("/app/apps/api/dist/modules/inventory/pallet-sorting-policy");p.assertSortingAdmin({roleCodes:["ADMIN"],activeWarehouseId:"test"});try{p.assertSortingAdmin({roleCodes:["CLIENT"],activeWarehouseId:"test"});process.exit(1)}catch(e){if(e.status!==403)throw e}'
  date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/staged-at"
  echo ENABLE_STAGED;;
 publish)
  same; cd /opt/logoff-wms/wms; test -s "$b/staged-at"; test ! -e "$b/published-at"
  node -e 'const p=require(process.argv[1]);if(!p.merged||!p.merge_commit_sha||p.head.ref!=="fix/sorting-enable-tsd-20260907"||p.base.ref!=="fix/fbs-box-scan-route-consistency")process.exit(1)' "$b/pr-merged.json"
  cmp .env "$b/env-before"; cmp infra/docker-compose.yml "$b/compose-before"; sha256sum -c "$b/backup.sha256"
  grep -q 'PASS ordinary FBS request' /tmp/admin-sorting-enable-postgres.log
  grep -q 'PASS bulk pallet' /tmp/admin-sorting-enable-postgres.log
  grep -q '1322 passed' /tmp/admin-sorting-enable-full-tests.log
  an=$(docker image inspect infra-api:sorting-enabled-20260907 --format '{{.Id}}'); wn=$(docker image inspect infra-web:sorting-enabled-20260907 --format '{{.Id}}')
  hashapi "$an" > "$b/api-now"; cmp "$b/api-after.sha256" "$b/api-now"
  hashweb "$wn" > "$b/web-now"; cmp "$b/web-after.sha256" "$b/web-now"
  node /tmp/pallet-sorting-enable-verify.cjs "$b"
  rollback() {
   trap - ERR
   ca=$(docker inspect infra-api-1 --format '{{.Image}}'); cw=$(docker inspect infra-web-1 --format '{{.Image}}')
   if { test "$ca" != "$api" && test "$ca" != "$an"; } || { test "$cw" != "$web" && test "$cw" != "$wn"; }; then echo EXTERNAL_RELEASE_ROLLBACK_BLOCKED; return 1; fi
   docker tag "$api" infra-api:latest; docker tag "$web" infra-web:latest
   docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 60 api web
   echo DISABLED_VERSIONS_RESTORED_NO_DATABASE_ROLLBACK
  }
  trap rollback ERR
  # FIX: our application images only. No migrations, data corrections or sold services.
  docker tag "$an" infra-api:latest
  docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 60 api
  ok=false
  for n in $(seq 1 25); do if curl --max-time 5 -fsS http://127.0.0.1:3000/api/v1/health > "$b/health.json"; then ok=true; break; fi; sleep 2; done
  test "$ok" = true; test "$(docker exec infra-api-1 printenv WMS_PALLET_SORTING_ENABLED)" = true
  test "$(curl --max-time 10 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/v1/pallet-sorting)" = 401
  docker tag "$wn" infra-web:latest
  docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 web
  curl --retry 5 --retry-connrefused --retry-delay 2 --max-time 20 -fsS https://wms.logoff.pro/ > "$b/public-web.html"
  docker run --rm --network none --entrypoint cat "$wn" /usr/share/nginx/html/index.html > "$b/candidate-web.html"; cmp "$b/public-web.html" "$b/candidate-web.html"
  curl --max-time 30 -fsS https://wms.logoff.pro/downloads/logoff-tsd-sorting-159.apk > "$b/public.apk"
  test "$(sha256sum "$b/public.apk" | cut -d' ' -f1)" = 83497bfba3c025ac3be813ede3329c36da8154883fb1bacaffb2287ff20d30f8
  curl --max-time 15 -fsS https://wms.logoff.pro/api/v1/health > "$b/public-health.json"
  node -e 'if(require(process.argv[1]).status!=="ok")process.exit(1)' "$b/public-health.json"
  docker inspect infra-postgres-1 --format '{{.Id}} {{.State.StartedAt}}' > "$b/db-after"; cmp "$b/db-before" "$b/db-after"
  cmp .env "$b/env-before"; cmp infra/docker-compose.yml "$b/compose-before"
  test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$an"; test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$wn"
  trap - ERR; date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/published-at"; echo SORTING_ENABLED_VERSIONED_APK_PUBLISHED;;
 *) echo 'stage|publish'; exit 2;;
esac
