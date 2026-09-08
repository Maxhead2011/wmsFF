#!/usr/bin/env bash
set -euo pipefail
umask 077
b=/opt/logoff-wms-backups/sorting-scan-161-20260908
r=/opt/logoff-wms-releases/sorting-scan-161-20260908
exec 9>/run/logoff-wms-api-release.lock; flock -n 9
test -s "$b/tests-passed"
test "$(docker inspect --format '{{.Config.Image}}' sorting-pr63-postgres-20260907)" = postgres:16-alpine
test "$(docker inspect --format '{{.State.Running}}' sorting-pr63-postgres-20260907)" = false
test "$(docker network inspect --format '{{.Internal}}' sorting-pr63-test-20260907)" = true
trap 'docker stop sorting-pr63-postgres-20260907 >/dev/null' EXIT
for version in baseline candidate; do
 docker start sorting-pr63-postgres-20260907 >/dev/null
 ready=false
 for n in $(seq 1 30); do
  if docker exec sorting-pr63-postgres-20260907 pg_isready -h 127.0.0.1 -U sorting_test -d sorting_pr63_test >/dev/null; then ready=true; break; fi
  sleep 1
 done
 test "$ready" = true
 docker exec sorting-pr63-postgres-20260907 createdb -U sorting_test sorting_recovery_test
 # TEST: schema only; no production client/order/stock records enter this isolated network.
 docker exec infra-postgres-1 pg_dump -U wms -d wms --schema-only --no-owner --no-privileges |
  docker exec -i sorting-pr63-postgres-20260907 psql -U sorting_test -d sorting_recovery_test -v ON_ERROR_STOP=1 > "$b/sql-schema-$version.log" 2>&1
 img=sha256:59e4401ee0d8217e2bfbbc7bfd8e6aa63bf4fe16bfa3ca1fe3d93501791d9b00
 if test "$version" = candidate; then img=infra-api:sorting-scan-161-20260908; fi
 status=0
 docker run --rm --network sorting-pr63-test-20260907 -e NODE_ENV=test \
  -e DATABASE_URL=postgresql://sorting_test:isolated_test_only@sorting-pr63-postgres-20260907:5432/sorting_recovery_test \
  -v "$r/wms/apps/api/test/pallet-sorting-free-source-postgres.cjs:/app/apps/api/test/pallet-sorting-free-source-postgres.cjs:ro" \
  -w /app/apps/api "$img" node test/pallet-sorting-free-source-postgres.cjs > "$b/sql-$version.log" 2>&1 || status=$?
 if test "$version" = baseline; then
  test "$status" != 0
  grep -q 'фактический исходный короб' "$b/sql-$version.log"
  echo POSTGRES_SOURCE_CHECK_BASELINE_RED
 else
  test "$status" = 0; grep -q '"result":"PASS"' "$b/sql-$version.log"; cat "$b/sql-$version.log"
 fi
 docker stop sorting-pr63-postgres-20260907 >/dev/null
done
trap - EXIT
date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/sql-passed"
