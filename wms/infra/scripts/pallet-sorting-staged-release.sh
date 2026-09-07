#!/usr/bin/env bash
set -euo pipefail
umask 077
# FIX: exact our-WMS images; never rebuild or replace the production checkout.
b=/opt/logoff-wms-backups/admin-sorting-staged-20260907
r=/tmp/admin-sorting-pr63-check.3lEy8q
api=sha256:d840a44a515cffd067b7fe449aa0b31d414b471666d5001096d206300ee40e96
web=sha256:fd7d3ea8e73091ddc5175a87ba7f42acef84f07f3c84392e0885de46237383ca
candidate=sha256:cde1b46bb651d976ae49f5c4123bdb13d3e3ad25af122879a1b1561845b98863
exec 9>/run/logoff-wms-api-release.lock; flock -n 9
exec 8>/run/logoff-wms-web-release.lock; flock -n 8
unchanged() {
 test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$api"
 test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$web"
}
hashes() { docker run --rm --network none --entrypoint sh "$1" -c "find $2 -type f -exec sha256sum {} +" | sort; }
case "${1:-}" in
 prepare)
  unchanged; test ! -e "$b"; mkdir -m 700 "$b"
  cp /opt/logoff-wms/wms/.env "$b/env-before"
  cp /opt/logoff-wms/wms/infra/docker-compose.yml "$b/compose-before.yml"
  docker inspect infra-postgres-1 --format '{{.Id}} {{.Image}} {{.State.StartedAt}}' > "$b/db-before"
  docker tag "$api" infra-api:before-admin-sorting-20260907
  docker tag "$web" infra-web:before-admin-sorting-20260907
  docker exec infra-api-1 tar -czf - /app/apps/api/src /app/apps/api/dist > "$b/api-before.tar.gz"
  docker exec infra-web-1 tar -czf - /usr/share/nginx/html > "$b/web-before.tar.gz"
  docker exec infra-postgres-1 pg_dump -U wms -d wms -Fc > "$b/wms.dump"
  docker exec -i infra-postgres-1 pg_restore --list < "$b/wms.dump" > "$b/database-contents.txt"
  sha256sum "$b/wms.dump" "$b/api-before.tar.gz" "$b/web-before.tar.gz" > "$b/backup.sha256"
  test -s "$b/database-contents.txt"
  hashes "$api" /app/apps/api/src > "$b/api-before.sha256"
  hashes "$api" /app/apps/api/dist > "$b/dist-before.sha256"
  hashes "$candidate" /app/apps/api/src > "$b/api-candidate.sha256"
  hashes "$candidate" /app/apps/api/dist > "$b/dist-candidate.sha256"
  docker image inspect "$api" --format '{{json .Config}}' > "$b/api-config-before.json"
  docker image inspect "$candidate" --format '{{json .Config}}' > "$b/api-config-candidate.json"
  hashes "$web" /usr/share/nginx/html > "$b/web-before.sha256"
  (cd /opt/logoff-wms-releases/tsd-admin-recount-20260907/apps/web && find src -type f -exec sha256sum {} + | sort) > "$b/web-src-before.sha256"
  (cd "$r/apps/web" && find src -type f -exec sha256sum {} + | sort) > "$b/web-src-candidate.sha256"
  hashes infra-web:sorting-pr63-candidate-20260907 /usr/share/nginx/html > "$b/web-candidate.sha256"
  date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/backup-at"
  echo BACKUP_CREATED;;
 refresh-web)
  unchanged
  # FIX: retain the already-published TSD history correction, absent from the older staging base.
  for file in TsdOperationHistoryPanel.tsx tsdOperationHistory.ts tsdOperationHistory.spec.ts; do
   cp "/opt/logoff-wms-releases/tsd-admin-recount-20260907/apps/web/src/components/tsd/$file" "$r/apps/web/src/components/tsd/$file"
  done
  (cd "$r/apps/web" && find src -type f -exec sha256sum {} + | sort) > "$b/web-src-candidate.sha256"
  docker build --network none --build-arg BASE_API="$api" --build-arg BASE_WEB="$web" -f /tmp/pallet-sorting.Dockerfile --target web -t infra-web:sorting-pr63-candidate-20260907 "$r" > "$b/web-build.log" 2>&1
  hashes infra-web:sorting-pr63-candidate-20260907 /usr/share/nginx/html > "$b/web-candidate.sha256"
  node /tmp/pallet-sorting-artifacts.cjs "$b" > "$b/artifact-check.json"
  echo WEB_REFRESH_VERIFIED;;
 restore-test)
  unchanged; sha256sum -c "$b/backup.sha256"
  docker network create --internal sorting-staged-restore-20260907 > "$b/restore-network-id"
  docker run -d --name sorting-staged-postgres-20260907 --network sorting-staged-restore-20260907 --memory 6g --cpus 1 --tmpfs /var/lib/postgresql/data:rw,size=5g -e POSTGRES_USER=wms -e POSTGRES_DB=sorting_restore -e POSTGRES_PASSWORD=isolated_restore_only postgres:16-alpine > "$b/restore-container-id"
  ready=false
  for n in $(seq 1 30); do if docker exec sorting-staged-postgres-20260907 psql -U wms -d sorting_restore -Atc 'SELECT 1' >/dev/null 2>&1; then ready=true; break; fi; sleep 1; done
  test "$ready" = true
  ;&
 restore-data)
  unchanged
  test "$(docker inspect sorting-staged-postgres-20260907 --format '{{.Id}}')" = "$(cat "$b/restore-container-id")"
  test "$(docker exec sorting-staged-postgres-20260907 psql -U wms -d sorting_restore -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")" = 0
  docker exec -i sorting-staged-postgres-20260907 pg_restore --exit-on-error --no-owner --no-privileges -U wms -d sorting_restore < "$b/wms.dump" > "$b/restore.log" 2>&1
  docker exec -i sorting-staged-postgres-20260907 psql -v ON_ERROR_STOP=1 -1 -U wms -d sorting_restore < /tmp/admin-pallet-sorting-migration.sql > "$b/migration-test.log" 2>&1
  docker exec sorting-staged-postgres-20260907 psql -v ON_ERROR_STOP=1 -U wms -d sorting_restore -Atc 'SELECT count(*) FROM "Box"; SELECT count(*) FROM "PalletSortingSession";' > "$b/restore-counts.txt"
  date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/restore-verified-at"
  echo RESTORE_AND_ADDITIVE_MIGRATION_VERIFIED;;
 verify)
  unchanged
  sha256sum -c "$b/backup.sha256"
  docker image inspect "$api" --format '{{json .Config}}' > "$b/api-config-before.json"
  docker image inspect "$candidate" --format '{{json .Config}}' > "$b/api-config-candidate.json"
  node /tmp/pallet-sorting-artifacts.cjs "$b";;
 smoke)
  unchanged; test -s "$b/restore-verified-at"
  # TEST: old AND new API boot on the restored database after the additive migration.
  # No host ports, no production URL, internal network prevents WB/external calls.
  for variant in old candidate; do
   image="$api"; if test "$variant" = candidate; then image="$candidate"; fi
   name="sorting-staged-smoke-$variant-v2-20260907"
   docker run -d --name "$name" --network sorting-staged-restore-20260907 --memory 1g --cpus 1 \
    -e NODE_ENV=test -e API_PORT=3000 -e WMS_PALLET_SORTING_ENABLED=false \
    -e DATABASE_URL=postgresql://wms:isolated_restore_only@sorting-staged-postgres-20260907:5432/sorting_restore \
    -e ANALYTICS_DATABASE_URL=postgresql://wms:isolated_restore_only@sorting-staged-postgres-20260907:5432/sorting_restore \
    -e JWT_ACCESS_SECRET=isolated_test_only -e JWT_REFRESH_SECRET=isolated_test_only \
    -e ANALYTICS_CREDENTIALS_SECRET=isolated_test_only -w /app/apps/api "$image" node dist/main.js > "$b/smoke-$variant-id"
   ok=false
   for n in $(seq 1 30); do
    if docker exec "$name" node -e 'fetch("http://127.0.0.1:3000/api/v1/health").then(async r=>{if(!r.ok||(await r.json()).status!=="ok")process.exit(1)}).catch(()=>process.exit(1))' >/dev/null 2>&1; then ok=true; break; fi
    sleep 1
   done
   docker logs "$name" > "$b/smoke-$variant.log" 2>&1
   if test "$ok" != true; then docker stop "$name" >/dev/null; exit 1; fi
   docker exec "$name" node -e 'fetch("http://127.0.0.1:3000/api/v1/client-requests").then(r=>{if(r.status!==401)process.exit(1)}).catch(()=>process.exit(1))'
   if test "$variant" = candidate; then
    docker exec "$name" node -e 'fetch("http://127.0.0.1:3000/api/v1/pallet-sorting").then(r=>{if(r.status!==401)process.exit(1)}).catch(()=>process.exit(1))'
    docker exec "$name" node -e 'const p=require("/app/apps/api/dist/modules/inventory/pallet-sorting-policy");try{p.assertSortingAdmin({roleCodes:["ADMIN"],activeWarehouseId:"test"});process.exit(1)}catch(e){if(e.status!==403)throw e}'
   fi
   docker stop "$name" >/dev/null
  done
  date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/rollback-smoke-verified-at"
  echo CANDIDATE_AND_ROLLBACK_SMOKE_PASS;;
 migration-record-test)
  unchanged; test -s "$b/restore-verified-at"
  mkdir -p "$r/apps/api/prisma/migrations/20260907133000_admin_pallet_sorting"
  cp /tmp/admin-pallet-sorting-migration.sql "$r/apps/api/prisma/migrations/20260907133000_admin_pallet_sorting/migration.sql"
  docker run --rm --network sorting-staged-restore-20260907 \
   -e DATABASE_URL=postgresql://wms:isolated_restore_only@sorting-staged-postgres-20260907:5432/sorting_restore \
   -v "$r/apps/api/prisma:/opt/sorting-prisma:ro" "$candidate" \
   node /app/apps/api/node_modules/prisma/build/index.js migrate resolve --applied 20260907133000_admin_pallet_sorting --schema /opt/sorting-prisma/schema.prisma > "$b/migration-record-test.log" 2>&1
  date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/migration-record-verified-at"
  echo MIGRATION_RECORD_VERIFIED;;
 publish)
  unchanged; cd /opt/logoff-wms/wms
  test ! -e "$b/published-at"; test -s "$b/rollback-smoke-verified-at"; test -s "$b/migration-record-verified-at"
  node -e 'const p=require(process.argv[1]);if(!p.merged||!p.merge_commit_sha||p.number!==63||p.head.ref!=="fix/sorting-preserve-permanent-boxes-20260907"||p.base.ref!=="fix/fbs-box-scan-route-consistency")process.exit(1)' "$b/pr-merged.json"
  cmp .env "$b/env-before"; cmp infra/docker-compose.yml "$b/compose-before.yml"
  sha256sum -c "$b/backup.sha256"
  test "$(sha256sum /tmp/admin-pallet-sorting-migration.sql | cut -d' ' -f1)" = fc3d51f510ee1c86b2029420b9c3118a626f7a1deb0dcbb077af427e147fcdcc
  node /tmp/pallet-sorting-artifacts.cjs "$b" > "$b/artifact-precutover.json"
  grep -q '1322 passed' /tmp/admin-sorting-pr63-final-baked-tests.log
  wn=$(docker image inspect infra-web:sorting-pr63-candidate-20260907 --format '{{.Id}}')
  hashes "$candidate" /app/apps/api/src > "$b/api-source-now"; cmp "$b/api-candidate.sha256" "$b/api-source-now"
  hashes "$candidate" /app/apps/api/dist > "$b/api-dist-now"; cmp "$b/dist-candidate.sha256" "$b/api-dist-now"
  hashes "$wn" /usr/share/nginx/html > "$b/web-candidate-now"; cmp "$b/web-candidate.sha256" "$b/web-candidate-now"
  docker exec infra-api-1 sh -c 'find /app/apps/api/src -type f -exec sha256sum {} +' | sort > "$b/live-source-now"
  cmp "$b/api-before.sha256" "$b/live-source-now"
  docker exec infra-web-1 sh -c 'find /usr/share/nginx/html -type f -exec sha256sum {} +' | sort > "$b/live-web-now"
  cmp "$b/web-before.sha256" "$b/live-web-now"
  rollback() {
   trap - ERR
   ca=$(docker inspect infra-api-1 --format '{{.Image}}'); cw=$(docker inspect infra-web-1 --format '{{.Image}}')
   if { test "$ca" != "$api" && test "$ca" != "$candidate"; } || { test "$cw" != "$web" && test "$cw" != "$wn"; }; then echo EXTERNAL_RELEASE_ROLLBACK_BLOCKED; return 1; fi
   docker tag "$api" infra-api:latest; docker tag "$web" infra-web:latest
   docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 60 api web
   echo APPLICATION_ROLLED_BACK_DATABASE_NOT_RESTORED
  }
  # FIX: add only an unused table. Never restore an old database over ongoing warehouse operations.
  docker exec -i infra-postgres-1 psql -v ON_ERROR_STOP=1 -1 -U wms -d wms < /tmp/admin-pallet-sorting-migration.sql > "$b/migration-production.log" 2>&1
  # FIX: record this one immutable migration; never run all pending migrations or db push.
  cmp /tmp/admin-pallet-sorting-migration.sql "$r/apps/api/prisma/migrations/20260907133000_admin_pallet_sorting/migration.sql"
  docker run --rm --network infra_default --env-file .env -v "$r/apps/api/prisma:/opt/sorting-prisma:ro" "$candidate" \
   node /app/apps/api/node_modules/prisma/build/index.js migrate resolve --applied 20260907133000_admin_pallet_sorting --schema /opt/sorting-prisma/schema.prisma > "$b/migration-record-production.log" 2>&1
  trap rollback ERR
  docker tag "$candidate" infra-api:latest
  docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 60 api
  ok=false
  for n in $(seq 1 25); do if curl --max-time 5 -fsS http://127.0.0.1:3000/api/v1/health > "$b/api-health.json"; then ok=true; break; fi; sleep 2; done
  test "$ok" = true
  test "$(docker exec infra-api-1 printenv WMS_PALLET_SORTING_ENABLED)" = false
  for path in client-requests pallet-sorting; do test "$(curl --max-time 8 -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000/api/v1/$path")" = 401; done
  docker tag "$wn" infra-web:latest
  docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 web
  curl --retry 5 --retry-delay 2 --retry-connrefused --max-time 20 -fsS https://wms.logoff.pro/ > "$b/public-web.html"
  docker run --rm --network none --entrypoint cat "$wn" /usr/share/nginx/html/index.html > "$b/candidate-web.html"
  cmp "$b/candidate-web.html" "$b/public-web.html"
  curl --max-time 15 -fsS https://wms.logoff.pro/api/v1/health > "$b/public-health.json"
  node -e 'if(require(process.argv[1]).status!=="ok")process.exit(1)' "$b/public-health.json"
  docker exec infra-web-1 sh -c 'find /usr/share/nginx/html -type f -exec sha256sum {} +' | sort > "$b/published-web.sha256"
  cmp "$b/web-candidate.sha256" "$b/published-web.sha256"
  docker inspect infra-postgres-1 --format '{{.Id}} {{.Image}} {{.State.StartedAt}}' > "$b/db-after"; cmp "$b/db-before" "$b/db-after"
  cmp .env "$b/env-before"; cmp infra/docker-compose.yml "$b/compose-before.yml"
  test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$candidate"
  test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$wn"
  trap - ERR
  date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/published-at"
  echo STAGED_PUBLICATION_OK_SORTING_DISABLED;;
 *) echo 'prepare|refresh-web|restore-test|restore-data|verify|smoke|migration-record-test|publish'; exit 2;;
esac
