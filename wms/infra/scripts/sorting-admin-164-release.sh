#!/usr/bin/env bash
set -euo pipefail
umask 077
# ADDED: isolated candidate, exact live-image gates, no database migrations.
b=/opt/logoff-wms-backups/sorting-admin-164-20260909
r=/opt/logoff-wms-releases/sorting-admin-164-20260909
api=sha256:13a51591aeb6e7d534927b3b870d4485f330b42b54c51e93a44d3502b75b897b
web=sha256:820ad805a999f37c024143063a423fdd8e85f34c3ef74d9248dec7fce81cb50b
ca=infra-api:sorting-admin-164-20260909
cw=infra-web:sorting-admin-164-20260909
exec 9>/run/logoff-wms-api-release.lock; flock -n 9
exec 8>/run/logoff-wms-web-release.lock; flock -n 8
same(){ test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$api"; test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$web"; }
unchanged(){ docker inspect infra-postgres-1 infra-analytics-postgres-1 infra-redis-1 infra-ollama-1 --format '{{.Id}} {{.Image}} {{.State.StartedAt}}'; }
hashapi(){ docker run --rm --network none --entrypoint sh "$1" -c 'find /app/apps/api/src /app/apps/api/dist -type f -exec sha256sum {} +' | sort; }
hashweb(){ docker run --rm --network none --entrypoint sh "$1" -c 'find /usr/share/nginx/html -type f -exec sha256sum {} +' | sort; }
verify(){ node "$r/wms/infra/scripts/sorting-admin-164-artifacts.cjs" "$b" "$r/wms/apps/web/public/downloads/logoff-tsd.json"; }
case "${1:-}" in
 stage)
  same; test ! -e "$b"; mkdir -m 700 "$b"
  cp /opt/logoff-wms/wms/.env "$b/env-before"; cp /opt/logoff-wms/wms/infra/docker-compose.yml "$b/compose-before"
  unchanged > "$b/unchanged-before"
  docker tag "$api" infra-api:before-sorting-admin-164-20260909; docker tag "$web" infra-web:before-sorting-admin-164-20260909
  mkdir -p "$r/candidate/wms/apps/api"
  docker cp infra-api-1:/app/apps/api/src "$r/candidate/wms/apps/api/"
  mkdir -p "$r/base/wms/apps/web" "$r/candidate/wms/apps/web"
  cp -a /opt/logoff-wms-releases/tsd-messages-162-20260908/candidate/wms/apps/web/src "$r/base/wms/apps/web/"
  cp -a "$r/base/wms/apps/web/src" "$r/candidate/wms/apps/web/"
  docker build --network none --build-arg BASE_API="$api" --build-arg BASE_WEB="$web" --target web-proof -f "$r/wms/infra/sorting-admin-164.Dockerfile" -t infra-web-proof:sorting-admin-164 "$r" > "$b/web-proof-build.log" 2>&1
  proof=$(docker create --network none infra-web-proof:sorting-admin-164)
  docker cp "$proof:/app/apps/web/dist" "$b/proof-dist"; docker rm "$proof" >/dev/null
  docker exec infra-web-1 cat /usr/share/nginx/html/index.html > "$b/live-index.html"
  cmp "$b/proof-dist/index.html" "$b/live-index.html"
  while IFS= read -r p; do test "$(sha256sum "$b/proof-dist/$p" | cut -d' ' -f1)" = "$(docker exec infra-web-1 sha256sum "/usr/share/nginx/html/$p" | cut -d' ' -f1)"; done < <(cd "$b/proof-dist" && find assets -type f)
  (cd "$r/candidate" && git apply --check --ignore-space-change "$r/feature.patch" && git apply --ignore-space-change "$r/feature.patch")
  (cd "$r/base/wms/apps/web" && find src -type f -exec sha256sum {} + | sort) > "$b/web-src-before.sha256"
  (cd "$r/candidate/wms/apps/web" && find src -type f -exec sha256sum {} + | sort) > "$b/web-src-after.sha256"
  docker exec infra-postgres-1 pg_dump -U wms -d wms -Fc > "$b/wms.dump"
  docker exec -i infra-postgres-1 pg_restore --list < "$b/wms.dump" > "$b/backup-contents"
  sha256sum "$b/wms.dump" > "$b/backup.sha256"
  for k in api web; do
   old="$api"; new="$ca"; if test "$k" = web; then old="$web"; new="$cw"; fi
   docker build --network none --build-arg BASE_API="$api" --build-arg BASE_WEB="$web" --target "$k" -f "$r/wms/infra/sorting-admin-164.Dockerfile" -t "$new" "$r" > "$b/$k-build.log" 2>&1
   docker image inspect "$old" --format '{{json .Config}}' > "$b/$k-config-before.json"
   docker image inspect "$new" --format '{{json .Config}}' > "$b/$k-config-after.json"
  done
  hashapi "$api" > "$b/api-before.sha256"; hashapi "$ca" > "$b/api-after.sha256"
  hashweb "$web" > "$b/web-before.sha256"; hashweb "$cw" > "$b/web-after.sha256"
  verify; same; date -u +'%FT%TZ' > "$b/staged-at";;
 test)
  same; test -s "$b/staged-at"; mounts=()
  for f in tsd-monitor-messages.spec.ts tsd-monitor-messages.integration.cjs; do mounts+=(-v "/opt/logoff-wms-releases/tsd-messages-162-20260908/wms/apps/api/test/$f:/app/apps/api/test/$f:ro"); done
  for f in pallet-sorting-late-source pallet-sorting-recovery sorting-settled-task pallet-sorting-session pallet-sorting-stock; do mounts+=(-v "/opt/logoff-wms-releases/sorting-scan-161-20260908/wms/apps/api/test/$f.spec.ts:/app/apps/api/test/$f.spec.ts:ro"); done
  for f in sorting-written-off-recovery pallet-sorting-recorded-source pallet-sorting-permanent-boxes pallet-sorting-reopen; do mounts+=(-v "$r/wms/apps/api/test/$f.spec.ts:/app/apps/api/test/$f.spec.ts:ro"); done
  docker run --rm --network none --cpus=2 --memory=3g -e NODE_ENV=test -e WMS_TEST_OUR_LIVE_BASELINE=true -e WMS_PERMANENT_STORAGE_BOXES_ENABLED=false -e WMS_TSD_PHYSICAL_STOCK_RECONCILIATION_ENABLED=false "${mounts[@]}" -v "$b:/results" -v /tmp/sorting-recovery-release-20260907/permanent-return-live-adapter.cjs:/app/infra/scripts/permanent-return-live-adapter.cjs:ro -v /tmp/sorting-recovery-release-20260907/repair-lknov039-confirmed-empty.ts:/app/apps/api/src/scripts/repair-lknov039-confirmed-empty.ts:ro -w /app/apps/api "$ca" sh -c 'node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1 --reporter=json --outputFile=/results/api-tests.json && node --test test/tsd-monitor-messages.integration.cjs' > "$b/api-tests.log" 2>&1
  node -e 'const a=require("node:assert/strict"),r=require(process.argv[1]);a.equal(r.numFailedTests,0);a(r.numPassedTests>=1527);console.log("CANDIDATE_API_PASS",r.numPassedTests)' "$b/api-tests.json"
  # TEST: one read-only mount with the test already present; never mutate release sources.
  mkdir -p "$r/web-test-src"
  cp -a "$r/candidate/wms/apps/web/src/." "$r/web-test-src/"
  cp "$r/wms/apps/web/src/components/inventory/SortingRetainedNotice.spec.tsx" "$r/web-test-src/components/inventory/"
  docker run --rm --network none --cpus=2 --memory=2g -v "$r/web-test-src:/app/apps/web/src:ro" -w /app/apps/web infra-web-proof:sorting-admin-164 sh -c 'ln -s ../../../node_modules/.pnpm/vitest@2.1.9_@types+node@22.20.0_supports-color@7.2.0/node_modules/vitest node_modules/vitest && node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1' > "$b/web-tests.log" 2>&1
  docker image inspect "$ca" "$cw" --format '{{.Id}}' > "$b/tested-images"
  date -u +'%FT%TZ' > "$b/tests-passed";;
 sql)
  same; test -s "$b/tests-passed"
  # TEST: fresh, internal-only synthetic database; preserve previous test databases too.
  pg=sorting-admin164-postgres-20260909; net=sorting-admin164-test-20260909
  if docker inspect "$pg" >/dev/null 2>&1 || docker network inspect "$net" >/dev/null 2>&1; then echo TEST_TARGET_ALREADY_EXISTS; exit 1; fi
  docker network create --internal "$net" >/dev/null
  docker run -d --name "$pg" --network "$net" --network-alias sorting-pr63-postgres-20260907 --cpus=1 --memory=1g -e POSTGRES_USER=sorting_test -e POSTGRES_PASSWORD=isolated_test_only -e POSTGRES_DB=sorting_written_off_test postgres:16-alpine >/dev/null
  trap 'docker stop "$pg" >/dev/null' EXIT
  test "$(docker network inspect --format '{{.Internal}}' "$net")" = true
  for n in $(seq 1 30); do if docker exec "$pg" pg_isready -h 127.0.0.1 -U sorting_test >/dev/null; then break; fi; sleep 1; done
  docker exec infra-postgres-1 pg_dump -U wms -d wms --schema-only --no-owner --no-privileges | docker exec -i "$pg" psql -U sorting_test -d sorting_written_off_test -v ON_ERROR_STOP=1 > "$b/schema.log" 2>&1
  docker run --rm --cpus=1 --memory=1g --network "$net" -e NODE_ENV=test -e DATABASE_URL=postgresql://sorting_test:isolated_test_only@sorting-pr63-postgres-20260907:5432/sorting_written_off_test -v "$r/wms/apps/api/test/sorting-written-off-postgres.cjs:/app/apps/api/test/sorting-written-off-postgres.cjs:ro" -w /app/apps/api "$ca" node test/sorting-written-off-postgres.cjs | tee "$b/postgres-tests.log"
  grep -q '"result":"PASS"' "$b/postgres-tests.log"; date -u +'%FT%TZ' > "$b/sql-passed";;
 publish)
  same; test -s "$b/tests-passed"; test -s "$b/sql-passed"; test ! -e "$b/published-at"
  node -e 'const a=require("node:assert/strict"),p=require(process.argv[1]);a.equal(p.state,"MERGED");a(p.mergeCommit.oid);a.equal(p.headRefOid,process.argv[2]);a.equal(p.headRefName,"fix/sorting-admin-recovery-reopen");a.equal(p.baseRefName,"fix/sorting-recorded-source-20260908")' "$b/pr-merged.json" "${2:?expected head required}"
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
  curl -fsS --max-time 15 https://wms.logoff.pro/ > "$b/public-index.html"
  docker exec infra-web-1 cat /usr/share/nginx/html/index.html > "$b/candidate-index.html"; cmp "$b/public-index.html" "$b/candidate-index.html"
  test "$(curl -s --max-time 10 -X POST -H 'Content-Type: application/json' -d '{}' -o /dev/null -w '%{http_code}' https://wms.logoff.pro/api/v1/pallet-sorting/TEST/actions)" = 401
  curl -fsS --max-time 20 https://wms.logoff.pro/downloads/logoff-tsd.json > "$b/public-channel.json"
  cmp "$b/public-channel.json" "$r/wms/apps/web/public/downloads/logoff-tsd.json"
  expected=$(node -p 'require(process.argv[1]).sha256' "$b/public-channel.json")
  for name in logoff-tsd.apk logoff-tsd-sorting-admin-164.apk; do
   curl -fsS --max-time 60 "https://wms.logoff.pro/downloads/$name" > "$b/public-$name"
   test "$(sha256sum "$b/public-$name" | cut -d' ' -f1)" = "$expected"
  done
  unchanged > "$b/unchanged-after"; cmp "$b/unchanged-before" "$b/unchanged-after"
  cmp .env "$b/env-before"; cmp infra/docker-compose.yml "$b/compose-before"
  test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$an"; test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$wn"
  trap - ERR; date -u +'%FT%TZ' > "$b/published-at"; echo SORTING_ADMIN_164_PUBLISHED;;
 *) echo 'stage|test|sql|publish EXPECTED_HEAD'; exit 2;;
esac
