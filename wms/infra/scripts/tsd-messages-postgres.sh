#!/usr/bin/env bash
set -euo pipefail
umask 077
b=/opt/logoff-wms-backups/tsd-messages-162-20260908
r=/opt/logoff-wms-releases/tsd-messages-162-20260908
exec 9>/run/logoff-wms-api-release.lock; flock -n 9
test -s "$b/tests-passed"
test "$(docker inspect --format '{{.Config.Image}}' sorting-pr63-postgres-20260907)" = postgres:16-alpine
test "$(docker inspect --format '{{.State.Running}}' sorting-pr63-postgres-20260907)" = false
test "$(docker network inspect --format '{{.Internal}}' sorting-pr63-test-20260907)" = true
trap 'docker stop sorting-pr63-postgres-20260907 >/dev/null' EXIT
docker start sorting-pr63-postgres-20260907 >/dev/null
ready=false
for n in $(seq 1 30); do if docker exec sorting-pr63-postgres-20260907 pg_isready -h 127.0.0.1 -U sorting_test -d sorting_pr63_test >/dev/null; then ready=true; break; fi; sleep 1; done
test "$ready" = true
docker exec sorting-pr63-postgres-20260907 createdb -U sorting_test tsd_messages_test
# TEST: production schema only; no actual users, messages, stock or order data.
docker exec infra-postgres-1 pg_dump -U wms -d wms --schema-only --no-owner --no-privileges |
 docker exec -i sorting-pr63-postgres-20260907 psql -U sorting_test -d tsd_messages_test -v ON_ERROR_STOP=1 > "$b/sql-schema.log" 2>&1
docker run --rm --network sorting-pr63-test-20260907 -e NODE_ENV=test \
 -e DATABASE_URL=postgresql://sorting_test:isolated_test_only@sorting-pr63-postgres-20260907:5432/tsd_messages_test \
 -v "$r/wms/apps/api/test/tsd-monitor-messages-postgres.cjs:/app/apps/api/test/tsd-monitor-messages-postgres.cjs:ro" \
 -w /app/apps/api infra-api:tsd-messages-162-20260908 node test/tsd-monitor-messages-postgres.cjs > "$b/sql-tests.log" 2>&1
grep -q '"result":"PASS"' "$b/sql-tests.log"; cat "$b/sql-tests.log"
docker stop sorting-pr63-postgres-20260907 >/dev/null
trap - EXIT
date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/sql-passed"
