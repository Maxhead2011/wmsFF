#!/usr/bin/env bash
set -euo pipefail
umask 077
b=/opt/logoff-wms-backups/sorting-recovery-20260907
r=/tmp/sorting-recovery-release-20260907
api=sha256:cf6a330b5bdc4c3763e3b6ca3de9f20d59c64dba6aef3a8ac7a5f1bbeddc29af
web=sha256:94ba69dd129eb584ce492b052d70efd541247c3a826611b3f4ddb2b39674fb98
exec 9>/run/logoff-wms-api-release.lock; flock -n 9
exec 8>/run/logoff-wms-web-release.lock; flock -n 8
same() { test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$api"; test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$web"; }
hashapi() { docker run --rm --network none --entrypoint sh "$1" -c "find /app/apps/api/$2 -type f -exec sha256sum {} +" | sort; }
hashweb() { docker run --rm --network none --entrypoint sh "$1" -c 'find /usr/share/nginx/html -type f -exec sha256sum {} +' | sort; }
case "${1:-}" in
 stage)
  same; test ! -e "$b"; mkdir -m 700 "$b"
  cp /opt/logoff-wms/wms/.env "$b/env-before"; cp /opt/logoff-wms/wms/infra/docker-compose.yml "$b/compose-before"
  docker inspect infra-postgres-1 --format '{{.Id}} {{.State.StartedAt}}' > "$b/db-before"
  docker tag "$api" infra-api:before-sorting-recovery-20260907; docker tag "$web" infra-web:before-sorting-recovery-20260907
  docker exec infra-postgres-1 pg_dump -U wms -d wms -Fc > "$b/wms.dump"
  docker exec -i infra-postgres-1 pg_restore --list < "$b/wms.dump" > "$b/database-contents.txt"
  sha256sum "$b/wms.dump" > "$b/backup.sha256"
  test "$(sha256sum "$r/logoff-tsd-sorting-recovery-160.apk" | cut -d' ' -f1)" = c6bdd49cf28aa630918326cab6e0a900a54a6b5946ab546fea1ada70d4796af5
  printf '%s\n' c6bdd49cf28aa630918326cab6e0a900a54a6b5946ab546fea1ada70d4796af5 > "$b/apk.sha256"
  for target in api web; do docker build --network none --build-arg BASE_API="$api" --build-arg BASE_WEB="$web" -f "$r/sorting-recovery.Dockerfile" --target "$target" -t "infra-$target:sorting-recovery-20260907" "$r" > "$b/$target-build.log" 2>&1; done
  for part in src dist; do hashapi "$api" "$part" > "$b/$part-before.sha256"; hashapi infra-api:sorting-recovery-20260907 "$part" > "$b/$part-after.sha256"; done
  hashweb "$web" > "$b/web-before.sha256"; hashweb infra-web:sorting-recovery-20260907 > "$b/web-after.sha256"
  docker image inspect "$api" --format '{{json .Config}}' > "$b/config-before.json"
  docker image inspect infra-api:sorting-recovery-20260907 --format '{{json .Config}}' > "$b/config-after.json"
  node "$r/sorting-recovery-overlay.cjs" verify "$b" > "$b/verification.log"
  same
  date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/staged-at"
  echo RECOVERY_STAGED;;
 publish)
  same; cd /opt/logoff-wms/wms; test -s "$b/staged-at"; test ! -e "$b/published-at"
  node -e 'const p=require(process.argv[1]);if(!p.merged||!p.merge_commit_sha||p.head.ref!=="fix/sorting-unknown-source-recovery-20260907"||p.base.ref!=="fix/fbs-box-scan-route-consistency")process.exit(1)' "$b/pr-merged.json"
  cmp .env "$b/env-before"; cmp infra/docker-compose.yml "$b/compose-before"; sha256sum -c "$b/backup.sha256"
  grep -q '"result":"PASS"' "$b/postgres-tests.log"
  test -s "$b/full-tests-passed"
  an=$(docker image inspect infra-api:sorting-recovery-20260907 --format '{{.Id}}'); wn=$(docker image inspect infra-web:sorting-recovery-20260907 --format '{{.Id}}')
  for part in src dist; do hashapi "$an" "$part" > "$b/$part-now"; cmp "$b/$part-after.sha256" "$b/$part-now"; done
  hashweb "$wn" > "$b/web-now"; cmp "$b/web-after.sha256" "$b/web-now"
  node "$r/sorting-recovery-overlay.cjs" verify "$b"
  rollback() {
   trap - ERR
   ca=$(docker inspect infra-api-1 --format '{{.Image}}'); cw=$(docker inspect infra-web-1 --format '{{.Image}}')
   if { test "$ca" != "$api" && test "$ca" != "$an"; } || { test "$cw" != "$web" && test "$cw" != "$wn"; }; then echo EXTERNAL_RELEASE_ROLLBACK_BLOCKED; return 1; fi
   docker tag "$api" infra-api:latest; docker tag "$web" infra-web:latest
   docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 api web
   echo PREVIOUS_IMAGES_RESTORED_NO_DATABASE_ROLLBACK
  }
  trap rollback ERR
  # FIX: only our app images. No migrations, production corrections, global APK or sold services.
  docker tag "$an" infra-api:latest
  docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 api
  ok=false
  for n in $(seq 1 25); do if curl --max-time 5 -fsS http://127.0.0.1:3000/api/v1/health > "$b/health.json"; then ok=true; break; fi; sleep 2; done
  test "$ok" = true; test "$(docker exec infra-api-1 printenv WMS_PALLET_SORTING_ENABLED)" = true
  test "$(curl --max-time 10 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/v1/pallet-sorting)" = 401
  docker tag "$wn" infra-web:latest
  docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 web
  curl --retry 5 --retry-connrefused --retry-delay 2 --max-time 20 -fsS https://wms.logoff.pro/ > "$b/public-web.html"
  docker run --rm --network none --entrypoint cat "$wn" /usr/share/nginx/html/index.html > "$b/candidate-web.html"; cmp "$b/public-web.html" "$b/candidate-web.html"
  curl --max-time 30 -fsS https://wms.logoff.pro/downloads/logoff-tsd-sorting-recovery-160.apk > "$b/public.apk"
  test "$(sha256sum "$b/public.apk" | cut -d' ' -f1)" = "$(cat "$b/apk.sha256")"
  curl --max-time 15 -fsS https://wms.logoff.pro/api/v1/health > "$b/public-health.json"
  node -e 'if(require(process.argv[1]).status!=="ok")process.exit(1)' "$b/public-health.json"
  docker inspect infra-postgres-1 --format '{{.Id}} {{.State.StartedAt}}' > "$b/db-after"; cmp "$b/db-before" "$b/db-after"
  cmp .env "$b/env-before"; cmp infra/docker-compose.yml "$b/compose-before"
  test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$an"; test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$wn"
  trap - ERR; date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/published-at"; echo SORTING_RECOVERY_PUBLISHED;;
 *) echo 'stage|publish'; exit 2;;
esac
