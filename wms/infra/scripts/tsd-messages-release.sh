#!/usr/bin/env bash
set -euo pipefail
umask 077
b=/opt/logoff-wms-backups/tsd-messages-162-20260908
r=/opt/logoff-wms-releases/tsd-messages-162-20260908
api=sha256:02746e4f2111650651d6f37437c5d36132da90b25047a2ea2029730ec9c8cef8
web=sha256:8bcefda0902c4fbf8f4cff05c62e45da931908581f890c32527ec0c8eb62a724
ca=infra-api:tsd-messages-162-20260908
cw=infra-web:tsd-messages-162-20260908
exec 9>/run/logoff-wms-api-release.lock; flock -n 9
exec 8>/run/logoff-wms-web-release.lock; flock -n 8
same(){ test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$api"; test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$web"; }
unchanged(){ docker inspect infra-postgres-1 infra-analytics-postgres-1 infra-redis-1 infra-ollama-1 --format '{{.Id}} {{.Image}} {{.State.StartedAt}}'; }
hashapi(){ docker run --rm --network none --entrypoint sh "$1" -c 'find /app/apps/api/src /app/apps/api/dist -type f -exec sha256sum {} +' | sort; }
hashweb(){ docker run --rm --network none --entrypoint sh "$1" -c 'find /usr/share/nginx/html -type f -exec sha256sum {} +' | sort; }
build(){ docker build --network none --build-arg BASE_API="$api" --build-arg BASE_WEB="$web" --target "$1" -f "$r/wms/infra/tsd-messages-release.Dockerfile" -t "$2" "$r" > "$b/$1-build.log" 2>&1; }
verify(){ node "$r/wms/infra/scripts/tsd-messages-artifacts.cjs" "$b" "$r/wms/apps/web/public/downloads/logoff-tsd.json"; }
case "${1:-}" in
 prepare)
  same; test ! -e "$b/prepared-at"
  if test ! -e "$b"; then
   mkdir -m 700 "$b"
   cp /opt/logoff-wms/wms/.env "$b/env-before"; cp /opt/logoff-wms/wms/infra/docker-compose.yml "$b/compose-before"
   unchanged > "$b/unchanged-before"
  else
   cmp /opt/logoff-wms/wms/.env "$b/env-before"; cmp /opt/logoff-wms/wms/infra/docker-compose.yml "$b/compose-before"
  fi
  docker tag "$api" infra-api:before-tsd-messages-162-20260908
  docker tag "$web" infra-web:before-tsd-messages-162-20260908
  mkdir -p "$r/base/wms/apps/api" "$r/base/wms/apps/web" "$r/candidate"
  docker cp infra-api-1:/app/apps/api/src "$r/base/wms/apps/api/"
  # FIX: use the known live web source, prove its build matches the running site.
  for p in src package.json tsconfig.json index.html; do cp -a "/tmp/sorting-recovery-release-20260907/apps/web/$p" "$r/base/wms/apps/web/"; done
  build web-proof infra-web-proof:tsd-messages-162-20260908
  proof=$(docker create --network none infra-web-proof:tsd-messages-162-20260908)
  docker cp "$proof:/app/apps/web/dist" "$b/proof-dist"; docker rm "$proof" > /dev/null
  docker exec infra-web-1 cat /usr/share/nginx/html/index.html > "$b/live-index.html"
  cmp "$b/proof-dist/index.html" "$b/live-index.html"
  while IFS= read -r p; do test "$(sha256sum "$b/proof-dist/$p" | cut -d' ' -f1)" = "$(docker exec infra-web-1 sha256sum "/usr/share/nginx/html/$p" | cut -d' ' -f1)"; done < <(cd "$b/proof-dist" && find assets -type f)
  cp -a "$r/base/wms" "$r/candidate/"
  # FIX: the live controller uses CRLF; ignore only whitespace in matching context.
  # Content conflicts still fail closed; never use --3way or resolve conflicts here.
  (cd "$r/candidate" && git apply --check --ignore-space-change "$r/feature.patch" && git apply --ignore-space-change "$r/feature.patch")
  (cd "$r/base/wms/apps/web" && find src -type f -exec sha256sum {} + | sort) > "$b/web-source-before.sha256"
  (cd "$r/candidate/wms/apps/web" && find src -type f -exec sha256sum {} + | sort) > "$b/web-source-after.sha256"
  same; date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/prepared-at"; echo LIVE_BASELINE_PROVED_AND_PATCHED;;
 stage)
  same; test -s "$b/prepared-at"; test ! -e "$b/staged-at"
  docker exec infra-postgres-1 pg_dump -U wms -d wms -Fc > "$b/wms.dump"
  docker exec -i infra-postgres-1 pg_restore --list < "$b/wms.dump" > "$b/backup-contents"
  sha256sum "$b/wms.dump" > "$b/backup.sha256"
  build api "$ca"; build web "$cw"
  hashapi "$api" > "$b/api-before.sha256"; hashapi "$ca" > "$b/api-after.sha256"
  hashweb "$web" > "$b/web-before.sha256"; hashweb "$cw" > "$b/web-after.sha256"
  for kind in api web; do
   old="$api"; new="$ca"; if test "$kind" = web; then old="$web"; new="$cw"; fi
   docker image inspect "$old" --format '{{json .Config}}' > "$b/$kind-config-before.json"
   docker image inspect "$new" --format '{{json .Config}}' > "$b/$kind-config-after.json"
  done
  verify > "$b/artifacts.log"; same; date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/staged-at"; echo STAGED;;
 test)
  same; test -s "$b/staged-at"
  mounts=()
  for file in tsd-monitor-messages.spec.ts tsd-monitor-messages.integration.cjs; do mounts+=(-v "$r/wms/apps/api/test/$file:/app/apps/api/test/$file:ro"); done
  # TEST: retain the already-approved test overlays from the APK161 release.
  for file in pallet-sorting-recorded-source pallet-sorting-late-source pallet-sorting-recovery sorting-settled-task pallet-sorting-session pallet-sorting-stock; do
   previous="/opt/logoff-wms-releases/sorting-scan-161-20260908/wms/apps/api/test/$file.spec.ts"
   test -f "$previous"; mounts+=(-v "$previous:/app/apps/api/test/$file.spec.ts:ro")
  done
  docker run --rm --network none --cpus=2 --memory=3g -e NODE_ENV=test -e WMS_TEST_OUR_LIVE_BASELINE=true \
   -e WMS_PERMANENT_STORAGE_BOXES_ENABLED=false -e WMS_TSD_PHYSICAL_STOCK_RECONCILIATION_ENABLED=false \
   "${mounts[@]}" -v "$b:/results" \
   -v /tmp/sorting-recovery-release-20260907/permanent-return-live-adapter.cjs:/app/infra/scripts/permanent-return-live-adapter.cjs:ro \
   -v /tmp/sorting-recovery-release-20260907/repair-lknov039-confirmed-empty.ts:/app/apps/api/src/scripts/repair-lknov039-confirmed-empty.ts:ro \
   -w /app/apps/api "$ca" sh -c 'node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1 --reporter=json --outputFile=/results/api-tests.json && node --test test/tsd-monitor-messages.integration.cjs' > "$b/api-tests.log" 2>&1
  node -e 'const a=require("node:assert/strict"),r=require(process.argv[1]);a.equal(r.numFailedTests,0);a(r.numPassedTests>1400);console.log("CANDIDATE_API_PASS",r.numPassedTests)' "$b/api-tests.json"
  docker image inspect "$ca" "$cw" --format '{{.Id}}' > "$b/tested-images"
  date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/tests-passed";;
 publish)
  same; test -s "$b/tests-passed"; test -s "$b/sql-passed"; test ! -e "$b/published-at"
  node -e 'const a=require("node:assert/strict"),p=require(process.argv[1]);a.equal(p.state,"MERGED");a(p.mergeCommit.oid);a.equal(p.headRefOid,process.argv[2]);a.equal(p.headRefName,"feature/tsd-monitor-messages");a.equal(p.baseRefName,"fix/sorting-recorded-source-20260908")' "$b/pr-merged.json" "${2:?expected head required}"
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
  for path in administration/tsd-monitor/devices/TEST/messages tsd/monitor/messages/TEST/read; do
   test "$(curl -s --max-time 10 -X POST -H 'Content-Type: application/json' -d '{}' -o /dev/null -w '%{http_code}' "https://wms.logoff.pro/api/v1/$path")" = 401
  done
  curl -fsS --max-time 15 https://wms.logoff.pro/ > "$b/public-index.html"
  docker exec infra-web-1 cat /usr/share/nginx/html/index.html > "$b/candidate-index.html"; cmp "$b/public-index.html" "$b/candidate-index.html"
  curl -fsS --max-time 20 https://wms.logoff.pro/downloads/logoff-tsd.json > "$b/public-channel.json"
  cmp "$b/public-channel.json" "$r/wms/apps/web/public/downloads/logoff-tsd.json"
  expected=$(node -p 'require(process.argv[1]).sha256' "$b/public-channel.json")
  for name in logoff-tsd.apk logoff-tsd-messages-162.apk; do
   curl -fsS --max-time 60 "https://wms.logoff.pro/downloads/$name" > "$b/public-$name"
   test "$(sha256sum "$b/public-$name" | cut -d' ' -f1)" = "$expected"
  done
  unchanged > "$b/unchanged-after"; cmp "$b/unchanged-before" "$b/unchanged-after"
  cmp .env "$b/env-before"; cmp infra/docker-compose.yml "$b/compose-before"
  test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$an"; test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$wn"
  trap - ERR; date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/published-at"; echo TSD_MESSAGES_162_PUBLISHED;;
 *) echo 'prepare|stage|test|publish EXPECTED_HEAD'; exit 2;;
esac
