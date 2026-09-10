#!/usr/bin/env bash
set -euo pipefail
umask 077
b=/opt/logoff-wms-backups/tsd-receipt-close-165-20260910
r=/tmp/tsd-receipt-close-165-20260910
api=sha256:d006f82cdfafaa88c9e83c0ee16815a3b34f0af967bab79bda242a0edcdcbf2c
web=sha256:02f1ad80df6b1751f6b180f90cd549f950c1e1c491ba4a8e759231666f1c2dcd
ca=infra-api:tsd-receipt-close-165-20260910
cw=infra-web:tsd-receipt-close-165-20260910
exec 9>/run/logoff-wms-api-release.lock; flock -n 9
exec 8>/run/logoff-wms-web-release.lock; flock -n 8
same(){ test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$api"; test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$web"; }
unchanged(){ docker inspect infra-postgres-1 infra-analytics-postgres-1 infra-redis-1 infra-ollama-1 --format '{{.Id}} {{.Image}} {{.State.StartedAt}}'; }
hashapi(){ docker run --rm --network none --entrypoint sh "$1" -c 'find /app/apps/api/src /app/apps/api/dist -type f -exec sha256sum {} +' | sort; }
hashweb(){ docker run --rm --network none --entrypoint sh "$1" -c 'find /usr/share/nginx/html -type f -exec sha256sum {} +' | sort; }
verify(){ node "$r/wms/infra/scripts/tsd-receipt-close-artifacts.cjs" "$b" "$r"; }
case "${1:-}" in
 stage|resume-stage)
  same
  if test "$1" = stage; then
  test ! -e "$b"; mkdir -m 700 "$b"
  cp /opt/logoff-wms/wms/.env "$b/env-before"; cp /opt/logoff-wms/wms/infra/docker-compose.yml "$b/compose-before"
  unchanged > "$b/unchanged-before"
  docker tag "$api" infra-api:before-tsd-receipt-close-165
  docker tag "$web" infra-web:before-tsd-receipt-close-165
  docker exec infra-postgres-1 pg_dump -U wms -d wms -Fc > "$b/wms.dump"
  docker exec -i infra-postgres-1 pg_restore --list < "$b/wms.dump" > "$b/backup-contents"
  sha256sum "$b/wms.dump" > "$b/backup.sha256"
  else
   test ! -e "$b/staged-at"; test ! -e "$b/published-at"
   sha256sum -c "$b/backup.sha256"
   cmp /opt/logoff-wms/wms/.env "$b/env-before"
   cmp /opt/logoff-wms/wms/infra/docker-compose.yml "$b/compose-before"
   unchanged > "$b/unchanged-resume"; cmp "$b/unchanged-before" "$b/unchanged-resume"
  fi
  mkdir -p "$b/live-src"
  for name in tsd-receipt.service tsd-sync.service tsd-operation.types dto/scan-operation.dto; do
   mkdir -p "$b/live-src/$(dirname "$name")"
   docker cp "infra-api-1:/app/apps/api/src/modules/tsd/$name.ts" "$b/live-src/$name.ts"
  done
  node - "$b" "$r" <<'NODE'
const fs=require('fs'),assert=require('node:assert/strict'),[b,r]=process.argv.slice(2);
const modules=require(r+'/wms/infra/scripts/tsd-receipt-close-artifacts.cjs').modules;
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
for(const name of modules)assert.equal(read(b+'/live-src/'+name+'.ts'),read(r+'/base/wms/apps/api/src/modules/tsd/'+name+'.ts'),'live baseline drift: '+name);
console.log('LIVE_SOURCE_BASELINE_MATCH');
NODE
  for kind in api web; do
   docker build --network none --build-arg BASE_API="$api" --build-arg BASE_WEB="$web" --target "$kind" -f "$r/wms/infra/tsd-receipt-close.Dockerfile" -t "infra-$kind:tsd-receipt-close-165-20260910" "$r" > "$b/$kind-build.log" 2>&1
  done
  hashapi "$api" > "$b/api-before.sha256"; hashapi "$ca" > "$b/api-after.sha256"
  hashweb "$web" > "$b/web-before.sha256"; hashweb "$cw" > "$b/web-after.sha256"
  for kind in api web; do
   if test "$kind" = api; then old="$api"; else old="$web"; fi
   docker image inspect "$old" --format '{{json .Config}}' > "$b/$kind-config-before.json"
   docker image inspect "infra-$kind:tsd-receipt-close-165-20260910" --format '{{json .Config}}' > "$b/$kind-config-after.json"
  done
  verify > "$b/verification.log"
  docker run --rm --network none --cpus=2 --memory=3g -e NODE_ENV=test -v "$r/wms/apps/api/test/tsd-receipt-close.spec.ts:/app/apps/api/test/tsd-receipt-close.spec.ts:ro" -w /app/apps/api "$ca" node node_modules/vitest/vitest.mjs run test/tsd-receipt-close.spec.ts > "$b/candidate-tests.log" 2>&1
  docker run --rm --network none --entrypoint sh "$cw" -c 'nginx && wget -qO /tmp/channel.json http://127.0.0.1/downloads/logoff-tsd.json && wget -qO /tmp/current.apk http://127.0.0.1/downloads/logoff-tsd.apk && cat /tmp/channel.json && sha256sum /tmp/current.apk' > "$b/download-smoke.log" 2>&1
  same; date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/staged-at"; echo RECEIPT_CLOSE_STAGED;;
 publish)
  same; test -s "$b/staged-at"; test ! -e "$b/published-at"
  node -e 'const p=require(process.argv[1]);if(!p.merged||!p.merge_commit_sha||p.head.ref!=="fix/tsd-receipt-server-close"||p.base.ref!=="fix/sorting-recorded-source-20260908")process.exit(1)' "$r/pr-merged.json"
  cd /opt/logoff-wms/wms
  cmp .env "$b/env-before"; cmp infra/docker-compose.yml "$b/compose-before"; sha256sum -c "$b/backup.sha256"
  verify
  an=$(docker image inspect "$ca" --format '{{.Id}}'); wn=$(docker image inspect "$cw" --format '{{.Id}}')
  hashapi "$an" > "$b/api-now.sha256"; cmp "$b/api-after.sha256" "$b/api-now.sha256"
  hashweb "$wn" > "$b/web-now.sha256"; cmp "$b/web-after.sha256" "$b/web-now.sha256"
  rollback(){
   trap - ERR
   currenta=$(docker inspect infra-api-1 --format '{{.Image}}'); currentw=$(docker inspect infra-web-1 --format '{{.Image}}')
   if { test "$currenta" != "$api" && test "$currenta" != "$an"; } || { test "$currentw" != "$web" && test "$currentw" != "$wn"; }; then echo EXTERNAL_RELEASE_ROLLBACK_BLOCKED; return 1; fi
   docker tag "$api" infra-api:latest; docker tag "$web" infra-web:latest
   docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 api web
   echo PREVIOUS_IMAGES_RESTORED_NO_DATABASE_ROLLBACK
  }
  trap rollback ERR
  # FIX: deploy API first. Database/data repair is a separate explicit action.
  docker tag "$an" infra-api:latest
  docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 api
  ready=false
  for n in $(seq 1 25); do if curl --max-time 4 -fsS http://127.0.0.1:3000/api/v1/health > "$b/api-health.json"; then ready=true; break; fi; sleep 2; done
  test "$ready" = true
  docker tag "$wn" infra-web:latest
  docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 web
  curl --retry 5 --retry-connrefused --retry-delay 2 --max-time 20 -fsS https://wms.logoff.pro/downloads/logoff-tsd.json > "$b/public-channel.json"
  cmp "$r/wms/apps/web/public/downloads/logoff-tsd.json" "$b/public-channel.json"
  curl --retry 3 --retry-delay 2 --max-time 60 -fsS https://wms.logoff.pro/downloads/logoff-tsd.apk > "$b/public.apk"
  expected=$(node -p "require('$b/public-channel.json').sha256")
  test "$(sha256sum "$b/public.apk" | cut -d' ' -f1)" = "$expected"
  curl --max-time 60 -fsS https://wms.logoff.pro/downloads/logoff-tsd-receipt-close-165.apk > "$b/public-versioned.apk"
  cmp "$b/public.apk" "$b/public-versioned.apk"
  curl --max-time 15 -fsS https://wms.logoff.pro/api/v1/health > "$b/public-health.json"
  node -e 'if(require(process.argv[1]).status!=="ok")process.exit(1)' "$b/public-health.json"
  unchanged > "$b/unchanged-after"; cmp "$b/unchanged-before" "$b/unchanged-after"
  cmp .env "$b/env-before"; cmp infra/docker-compose.yml "$b/compose-before"
  test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$an"; test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$wn"
  trap - ERR; date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/published-at"; echo RECEIPT_CLOSE_165_PUBLISHED;;
 *) echo 'stage|resume-stage|publish'; exit 2;;
esac
