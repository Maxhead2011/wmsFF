#!/usr/bin/env bash
set -euo pipefail
umask 077
# ADDED: isolated candidate, exact live-image gates, no database migrations.
b=/opt/logoff-wms-backups/kiz-recovery-163-20260908
r=/opt/logoff-wms-releases/kiz-recovery-163-20260908
api=sha256:44178623ff5e3646732ba5e5d3541db9839e21109b17e23d5790b503d46482e3
web=sha256:c0d1214a0b71ecdb54d6e756cf3d8b83da8d659aa83d91d1a5305116e69ab98b
ca=infra-api:kiz-recovery-163-20260908
cw=infra-web:kiz-recovery-163-20260908
exec 9>/run/logoff-wms-api-release.lock; flock -n 9
exec 8>/run/logoff-wms-web-release.lock; flock -n 8
same(){ test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$api"; test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$web"; }
unchanged(){ docker inspect infra-postgres-1 infra-analytics-postgres-1 infra-redis-1 infra-ollama-1 --format '{{.Id}} {{.Image}} {{.State.StartedAt}}'; }
hashapi(){ docker run --rm --network none --entrypoint sh "$1" -c 'find /app/apps/api/src /app/apps/api/dist -type f -exec sha256sum {} +' | sort; }
hashweb(){ docker run --rm --network none --entrypoint sh "$1" -c 'find /usr/share/nginx/html -type f -exec sha256sum {} +' | sort; }
verify(){ node "$r/wms/infra/scripts/kiz-recovery-163-artifacts.cjs" "$b" "$r/wms/apps/web/public/downloads/logoff-tsd.json"; }
case "${1:-}" in
 stage)
  same; test ! -e "$b"; mkdir -m 700 "$b"
  cp /opt/logoff-wms/wms/.env "$b/env-before"; cp /opt/logoff-wms/wms/infra/docker-compose.yml "$b/compose-before"
  unchanged > "$b/unchanged-before"
  docker tag "$api" infra-api:before-kiz-recovery-163-20260908; docker tag "$web" infra-web:before-kiz-recovery-163-20260908
  mkdir -p "$r/candidate/wms/apps/api"
  docker cp infra-api-1:/app/apps/api/src "$r/candidate/wms/apps/api/"
  (cd "$r/candidate" && git apply --check --ignore-space-change "$r/feature.patch" && git apply --ignore-space-change "$r/feature.patch")
  docker exec infra-postgres-1 pg_dump -U wms -d wms -Fc > "$b/wms.dump"
  docker exec -i infra-postgres-1 pg_restore --list < "$b/wms.dump" > "$b/backup-contents"
  sha256sum "$b/wms.dump" > "$b/backup.sha256"
  for k in api web; do
   old="$api"; new="$ca"; if test "$k" = web; then old="$web"; new="$cw"; fi
   docker build --network none --build-arg BASE_API="$api" --build-arg BASE_WEB="$web" --target "$k" -f "$r/wms/infra/kiz-recovery-163.Dockerfile" -t "$new" "$r" > "$b/$k-build.log" 2>&1
   docker image inspect "$old" --format '{{json .Config}}' > "$b/$k-config-before.json"
   docker image inspect "$new" --format '{{json .Config}}' > "$b/$k-config-after.json"
  done
  hashapi "$api" > "$b/api-before.sha256"; hashapi "$ca" > "$b/api-after.sha256"
  hashweb "$web" > "$b/web-before.sha256"; hashweb "$cw" > "$b/web-after.sha256"
  verify; same; date -u +'%FT%TZ' > "$b/staged-at";;
 test)
  same; test -s "$b/staged-at"; mounts=()
  for f in tsd-monitor-messages.spec.ts tsd-monitor-messages.integration.cjs; do mounts+=(-v "/opt/logoff-wms-releases/tsd-messages-162-20260908/wms/apps/api/test/$f:/app/apps/api/test/$f:ro"); done
  for f in pallet-sorting-recorded-source pallet-sorting-late-source pallet-sorting-recovery sorting-settled-task pallet-sorting-session pallet-sorting-stock; do mounts+=(-v "/opt/logoff-wms-releases/sorting-scan-161-20260908/wms/apps/api/test/$f.spec.ts:/app/apps/api/test/$f.spec.ts:ro"); done
  mounts+=(-v "$r/wms/apps/api/test/sorting-written-off-recovery.spec.ts:/app/apps/api/test/sorting-written-off-recovery.spec.ts:ro")
  docker run --rm --network none --cpus=2 --memory=3g -e NODE_ENV=test -e WMS_TEST_OUR_LIVE_BASELINE=true -e WMS_PERMANENT_STORAGE_BOXES_ENABLED=false -e WMS_TSD_PHYSICAL_STOCK_RECONCILIATION_ENABLED=false "${mounts[@]}" -v "$b:/results" -v /tmp/sorting-recovery-release-20260907/permanent-return-live-adapter.cjs:/app/infra/scripts/permanent-return-live-adapter.cjs:ro -v /tmp/sorting-recovery-release-20260907/repair-lknov039-confirmed-empty.ts:/app/apps/api/src/scripts/repair-lknov039-confirmed-empty.ts:ro -w /app/apps/api "$ca" sh -c 'node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1 --reporter=json --outputFile=/results/api-tests.json && node --test test/tsd-monitor-messages.integration.cjs' > "$b/api-tests.log" 2>&1
  node -e 'const a=require("node:assert/strict"),r=require(process.argv[1]);a.equal(r.numFailedTests,0);a(r.numPassedTests>=1527);console.log("CANDIDATE_API_PASS",r.numPassedTests)' "$b/api-tests.json"
  docker image inspect "$ca" "$cw" --format '{{.Id}}' > "$b/tested-images"
  date -u +'%FT%TZ' > "$b/tests-passed";;
 sql)
  same; test -s "$b/tests-passed"
  test "$(docker inspect --format '{{.Config.Image}}' sorting-pr63-postgres-20260907)" = postgres:16-alpine
  test "$(docker inspect --format '{{.State.Running}}' sorting-pr63-postgres-20260907)" = false
  test "$(docker network inspect --format '{{.Internal}}' sorting-pr63-test-20260907)" = true
  trap 'docker stop sorting-pr63-postgres-20260907 >/dev/null' EXIT
  docker start sorting-pr63-postgres-20260907 >/dev/null
  for n in $(seq 1 30); do if docker exec sorting-pr63-postgres-20260907 pg_isready -h 127.0.0.1 -U sorting_test >/dev/null; then break; fi; sleep 1; done
  docker exec sorting-pr63-postgres-20260907 createdb -U sorting_test sorting_written_off_test
  docker exec infra-postgres-1 pg_dump -U wms -d wms --schema-only --no-owner --no-privileges | docker exec -i sorting-pr63-postgres-20260907 psql -U sorting_test -d sorting_written_off_test -v ON_ERROR_STOP=1 > "$b/schema.log" 2>&1
  docker run --rm --network sorting-pr63-test-20260907 -e NODE_ENV=test -e DATABASE_URL=postgresql://sorting_test:isolated_test_only@sorting-pr63-postgres-20260907:5432/sorting_written_off_test -v "$r/wms/apps/api/test/sorting-written-off-postgres.cjs:/app/apps/api/test/sorting-written-off-postgres.cjs:ro" -w /app/apps/api "$ca" node test/sorting-written-off-postgres.cjs | tee "$b/postgres-tests.log"
  grep -q '"result":"PASS"' "$b/postgres-tests.log"; date -u +'%FT%TZ' > "$b/sql-passed";;
 publish)
  same; test -s "$b/tests-passed"; test -s "$b/sql-passed"; test ! -e "$b/published-at"
  node -e 'const a=require("node:assert/strict"),p=require(process.argv[1]);a.equal(p.state,"MERGED");a(p.mergeCommit.oid);a.equal(p.headRefOid,process.argv[2]);a.equal(p.headRefName,"fix/sorting-written-off-kiz-recovery");a.equal(p.baseRefName,"fix/sorting-recorded-source-20260908")' "$b/pr-merged.json" "${2:?expected head required}"
  cd /opt/logoff-wms/wms
  cmp .env "$b/env-before"; cmp infra/docker-compose.yml "$b/compose-before"; sha256sum -c "$b/backup.sha256"
  docker image inspect "$ca" "$cw" --format '{{.Id}}' > "$b/current-images"; cmp "$b/tested-images" "$b/current-images"
  hashapi "$ca" > "$b/api-now"; cmp "$b/api-after.sha256" "$b/api-now"
  hashweb "$cw" > "$b/web-now"; cmp "$b/web-after.sha256" "$b/web-now"; verify
  an=$(docker image inspect "$ca" --format '{{.Id}}'); wn=$(docker image inspect "$cw" --format '{{.Id}}')
  rollback(){
   trap - ERR
   aa=$(docker inspect infra-api-1 --format '{{.Image}}'); ww=$(docker inspect infra-web-1 --format '{{.Image}}')
   if { test "$aa" != "$api" && test "$aa" != "$an"; } || { test "$ww" != "$web" && test "$ww" != "$wn"; }; then echo EXTERNAL_RELEASE_ROLLBACK_BLOCKED; return 1; fi
   docker tag "$api" infra-api:latest; docker tag "$web" infra-web:latest
   docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 api web
   echo PREVIOUS_IMAGES_RESTORED_NO_DB_ROLLBACK
  }
  trap rollback ERR
  docker tag "$an" infra-api:latest
  docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 api
  ready=false; for n in $(seq 1 25); do if curl -fsS --max-time 5 http://127.0.0.1:3000/api/v1/health > "$b/health.json"; then ready=true; break; fi; sleep 2; done
  test "$ready" = true
  docker tag "$wn" infra-web:latest
  docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 web
  curl -fsS --retry 4 --retry-connrefused --max-time 15 https://wms.logoff.pro/api/v1/health > "$b/public-health.json"
  node -e 'if(require(process.argv[1]).status!=="ok")process.exit(1)' "$b/public-health.json"
  curl -fsS --max-time 20 https://wms.logoff.pro/downloads/logoff-tsd.json > "$b/public-channel.json"
  cmp "$b/public-channel.json" "$r/wms/apps/web/public/downloads/logoff-tsd.json"
  expected=$(node -p 'require(process.argv[1]).sha256' "$b/public-channel.json")
  for name in logoff-tsd.apk logoff-tsd-kiz-recovery-163.apk; do
   curl -fsS --max-time 60 "https://wms.logoff.pro/downloads/$name" > "$b/public-$name"
   test "$(sha256sum "$b/public-$name" | cut -d' ' -f1)" = "$expected"
  done
  unchanged > "$b/unchanged-after"; cmp "$b/unchanged-before" "$b/unchanged-after"
  cmp .env "$b/env-before"; cmp infra/docker-compose.yml "$b/compose-before"
  test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$an"; test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$wn"
  trap - ERR; date -u +'%FT%TZ' > "$b/published-at"; echo KIZ_RECOVERY_163_PUBLISHED;;
 *) echo 'stage|test|sql|publish EXPECTED_HEAD'; exit 2;;
esac
