#!/usr/bin/env bash
# TEST: disposable isolated PostgreSQL; no production volumes, ports or credentials.
set -euo pipefail
root=$(realpath "${1:?release directory}")
test -f "$root/wms/apps/api/test/fbs-reshipment-postgres.cjs"
name=wms-reshipment-test-20260910
test -z "$(docker ps -aq --filter name=^/${name}$)"
docker run -d --name "$name" --label wms.purpose=reshipment-isolated-test --network none --memory 256m --cpus 1 \
  --tmpfs /var/lib/postgresql/data:rw,size=128m -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=wms_reshipment_test postgres:16-alpine >/dev/null
cleanup(){
  test "$(docker inspect "$name" --format '{{index .Config.Labels "wms.purpose"}}')" = reshipment-isolated-test
  docker rm -fv "$name" >/dev/null
}
trap cleanup EXIT
for n in $(seq 1 30); do if docker exec "$name" pg_isready -U postgres >/dev/null; then break; fi; sleep 1; done
docker run --rm --network "container:$name" --memory 512m --cpus 1 --entrypoint node -w /app/apps/api \
  -e NODE_ENV=test -e FBS_RESHIPMENT_TEST_ACK=isolated-test-only \
  -e FBS_RESHIPMENT_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/wms_reshipment_test \
  -v "$root/wms/apps/api/test/fbs-reshipment-postgres.cjs:/app/apps/api/test/fbs-reshipment-postgres.cjs:ro" \
  -v "$root/wms/apps/api/prisma/migrations/20260910144000_fbs_reshipment:/app/apps/api/prisma/migrations/20260910144000_fbs_reshipment:ro" \
  sha256:fec74a0ee538fc9e7ace9c31b3a852b58a0cb7096bcea2ef299211024300c65a test/fbs-reshipment-postgres.cjs
