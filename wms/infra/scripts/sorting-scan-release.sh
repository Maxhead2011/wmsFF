#!/usr/bin/env bash
set -euo pipefail
umask 077
b=/opt/logoff-wms-backups/sorting-scan-161-20260908
r=/opt/logoff-wms-releases/sorting-scan-161-20260908
api=sha256:59e4401ee0d8217e2bfbbc7bfd8e6aa63bf4fe16bfa3ca1fe3d93501791d9b00
web=sha256:d03cc1dfb22e1e16467e1924eb3c87d46ef18c54af8ba76a20ac3e326bb6b441
ca=infra-api:sorting-scan-161-20260908
cw=infra-web:sorting-scan-161-20260908
exec 9>/run/logoff-wms-api-release.lock; flock -n 9
exec 8>/run/logoff-wms-web-release.lock; flock -n 8
same() { test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$api"; test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$web"; }
hashapi() { docker run --rm --network none --entrypoint sh "$1" -c 'find /app/apps/api/src /app/apps/api/dist -type f -exec sha256sum {} +' | sort; }
hashweb() { docker run --rm --network none --entrypoint sh "$1" -c 'find /usr/share/nginx/html -type f -exec sha256sum {} +' | sort; }
verify() { node "$r/wms/infra/scripts/sorting-scan-artifacts.cjs" "$b" "$r/wms/apps/web/public/downloads/logoff-tsd.json"; }
unchanged() { docker inspect infra-postgres-1 infra-analytics-postgres-1 infra-redis-1 infra-ollama-1 --format '{{.Id}} {{.Image}} {{.State.StartedAt}}'; }
case "${1:-}" in
 stage)
  same; test ! -e "$b"; mkdir -m 700 "$b"
  cp /opt/logoff-wms/wms/.env "$b/env-before"; cp /opt/logoff-wms/wms/infra/docker-compose.yml "$b/compose-before"
  unchanged > "$b/unchanged-before"
  docker tag "$api" infra-api:before-sorting-scan-161-20260908
  docker tag "$web" infra-web:before-sorting-scan-161-20260908
  test "$(docker exec infra-api-1 sha256sum /app/apps/api/src/modules/inventory/pallet-sorting.service.ts | cut -d' ' -f1)" = 40489a78dd8cc05f567ff905ff2501b91b70e817f7dfbfeedf6959c8462ec50c
  # FIX: retain a current backup; publication itself runs no DB writes/migrations.
  docker exec infra-postgres-1 pg_dump -U wms -d wms -Fc > "$b/wms.dump"
  docker exec -i infra-postgres-1 pg_restore --list < "$b/wms.dump" > "$b/backup-contents"
  sha256sum "$b/wms.dump" > "$b/backup.sha256"
  for kind in api web; do
   docker build --network none --build-arg BASE_API="$api" --build-arg BASE_WEB="$web" --target "$kind" -f "$r/wms/infra/sorting-scan-release.Dockerfile" -t "infra-$kind:sorting-scan-161-20260908" "$r" > "$b/$kind-build.log" 2>&1
  done
  hashapi "$api" > "$b/api-before.sha256"; hashapi "$ca" > "$b/api-after.sha256"
  hashweb "$web" > "$b/web-before.sha256"; hashweb "$cw" > "$b/web-after.sha256"
  docker image inspect "$api" --format '{{json .Config}}' > "$b/api-config-before.json"
  docker image inspect "$ca" --format '{{json .Config}}' > "$b/api-config-after.json"
  docker image inspect "$web" --format '{{json .Config}}' > "$b/web-config-before.json"
  docker image inspect "$cw" --format '{{json .Config}}' > "$b/web-config-after.json"
  verify > "$b/artifacts.log"
  same; date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/staged-at"; echo STAGED;;
 test)
  same; test -s "$b/staged-at"
  mounts=()
  for file in pallet-sorting-recorded-source pallet-sorting-late-source pallet-sorting-recovery sorting-settled-task pallet-sorting-session pallet-sorting-stock; do
   mounts+=(-v "$r/wms/apps/api/test/$file.spec.ts:/app/apps/api/test/$file.spec.ts:ro")
  done
  docker run --rm --network none --cpus=2 --memory=3g -e NODE_ENV=test -e WMS_TEST_OUR_LIVE_BASELINE=true \
   -e WMS_PERMANENT_STORAGE_BOXES_ENABLED=false -e WMS_TSD_PHYSICAL_STOCK_RECONCILIATION_ENABLED=false \
   "${mounts[@]}" -v "$b:/results" \
   -v /tmp/sorting-recovery-release-20260907/permanent-return-live-adapter.cjs:/app/infra/scripts/permanent-return-live-adapter.cjs:ro \
   -v /tmp/sorting-recovery-release-20260907/repair-lknov039-confirmed-empty.ts:/app/apps/api/src/scripts/repair-lknov039-confirmed-empty.ts:ro \
   -w /app/apps/api "$ca" node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1 --reporter=json --outputFile=/results/api-tests.json > "$b/api-tests.log" 2>&1
  node -e 'const a=require("node:assert/strict"),r=require(process.argv[1]);a.equal(r.numFailedTests,0);a(r.numPassedTests>1300);console.log("CANDIDATE_API_PASS",r.numPassedTests)' "$b/api-tests.json"
  docker image inspect "$ca" "$cw" --format '{{.Id}}' > "$b/tested-images"
  date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/tests-passed";;
 publish)
  same; test -s "$b/tests-passed"; test -s "$b/sql-passed"; test ! -e "$b/published-at"
  node -e 'const a=require("node:assert/strict"),p=require(process.argv[1]);a.equal(p.state,"MERGED");a(p.mergeCommit.oid);a.equal(p.headRefOid,process.argv[2]);a.equal(p.headRefName,"fix/sorting-free-source-auto-kiz-20260908");a.equal(p.baseRefName,"fix/sorting-recorded-source-20260908")' "$b/pr-merged.json" "${2:?expected PR head required}"
  cd /opt/logoff-wms/wms
  cmp .env "$b/env-before"; cmp infra/docker-compose.yml "$b/compose-before"; sha256sum -c "$b/backup.sha256"
  docker image inspect "$ca" "$cw" --format '{{.Id}}' > "$b/current-images"; cmp "$b/tested-images" "$b/current-images"
  hashapi "$ca" > "$b/api-now"; cmp "$b/api-after.sha256" "$b/api-now"
  hashweb "$cw" > "$b/web-now"; cmp "$b/web-after.sha256" "$b/web-now"; verify
  an=$(docker image inspect "$ca" --format '{{.Id}}'); wn=$(docker image inspect "$cw" --format '{{.Id}}')
  rollback() {
   trap - ERR
   aa=$(docker inspect infra-api-1 --format '{{.Image}}'); ww=$(docker inspect infra-web-1 --format '{{.Image}}')
   if { test "$aa" != "$api" && test "$aa" != "$an"; } || { test "$ww" != "$web" && test "$ww" != "$wn"; }; then echo EXTERNAL_RELEASE_ROLLBACK_BLOCKED; return 1; fi
   docker tag "$api" infra-api:latest; docker tag "$web" infra-web:latest
   docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 api web
   echo PREVIOUS_API_AND_DOWNLOAD_CHANNEL_RESTORED_NO_DB_ROLLBACK
  }
  trap rollback ERR
  docker tag "$an" infra-api:latest
  docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 api
  ready=false
  for n in $(seq 1 25); do if curl -fsS --max-time 5 http://127.0.0.1:3000/api/v1/health > "$b/health.json"; then ready=true; break; fi; sleep 2; done
  test "$ready" = true
  docker tag "$wn" infra-web:latest
  docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 web
  curl -fsS --retry 4 --retry-connrefused --max-time 15 https://wms.logoff.pro/api/v1/health > "$b/public-health.json"
  node -e 'if(require(process.argv[1]).status!=="ok")process.exit(1)' "$b/public-health.json"
  test "$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' https://wms.logoff.pro/api/v1/pallet-sorting)" = 401
  curl -fsS --max-time 20 https://wms.logoff.pro/downloads/logoff-tsd.json > "$b/public-channel.json"
  cmp "$b/public-channel.json" "$r/wms/apps/web/public/downloads/logoff-tsd.json"
  expected=$(node -p 'require(process.argv[1]).sha256' "$b/public-channel.json")
  for name in logoff-tsd.apk logoff-tsd-sorting-scan-161.apk; do
   curl -fsS --max-time 60 "https://wms.logoff.pro/downloads/$name" > "$b/public-$name"
   test "$(sha256sum "$b/public-$name" | cut -d' ' -f1)" = "$expected"
  done
  unchanged > "$b/unchanged-after"; cmp "$b/unchanged-before" "$b/unchanged-after"
  cmp .env "$b/env-before"; cmp infra/docker-compose.yml "$b/compose-before"
  test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$an"; test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$wn"
  trap - ERR; date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/published-at"; echo SORTING_AND_TSD_161_PUBLISHED;;
 *) echo 'stage|test|publish EXPECTED_HEAD'; exit 2;;
esac
