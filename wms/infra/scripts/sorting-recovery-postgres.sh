#!/usr/bin/env bash
set -euo pipefail
umask 077
# TEST: synthetic data in a dedicated internal network; production schema is read-only.
test "$(docker inspect --format '{{.Config.Image}}' sorting-pr63-postgres-20260907)" = postgres:16-alpine
test "$(docker network inspect --format '{{.Internal}}' sorting-pr63-test-20260907)" = true
test "$(docker inspect --format '{{.State.Running}}' sorting-pr63-postgres-20260907)" = false
docker start sorting-pr63-postgres-20260907 >/dev/null
trap 'docker stop sorting-pr63-postgres-20260907 >/dev/null' EXIT
ready=false
for n in $(seq 1 30); do
 if docker exec sorting-pr63-postgres-20260907 pg_isready -h 127.0.0.1 -U sorting_test -d sorting_pr63_test >/dev/null; then ready=true; break; fi
 sleep 1
done
test "$ready" = true
docker exec sorting-pr63-postgres-20260907 createdb -U sorting_test sorting_recovery_test
docker exec infra-postgres-1 pg_dump -U wms -d wms --schema-only --no-owner --no-privileges |
 docker exec -i sorting-pr63-postgres-20260907 psql -U sorting_test -d sorting_recovery_test -v ON_ERROR_STOP=1 >/tmp/sorting-recovery-schema-20260907.log 2>&1
docker run --rm --network sorting-pr63-test-20260907 -e NODE_ENV=test \
 -e DATABASE_URL=postgresql://sorting_test:isolated_test_only@sorting-pr63-postgres-20260907:5432/sorting_recovery_test \
 -v /tmp/sorting-recovery-release-20260907/pallet-sorting-recovery-postgres.cjs:/app/apps/api/test/pallet-sorting-recovery-postgres.cjs:ro \
 -w /app/apps/api infra-api:sorting-recovery-20260907 node test/pallet-sorting-recovery-postgres.cjs
