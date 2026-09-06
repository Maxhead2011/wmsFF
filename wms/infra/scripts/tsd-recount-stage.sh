#!/usr/bin/env bash
set -euo pipefail
umask 077
exec 9>/run/logoff-wms-api-release.lock
flock -n 9
exec 8>/run/logoff-wms-web-release.lock
flock -n 8
b=/opt/logoff-wms-backups/tsd-admin-recount-20260907
r=/opt/logoff-wms-releases/tsd-admin-recount-20260907
test ! -e "$b"
test ! -e "$r"
mkdir -m 700 "$b" "$r"
docker inspect infra-api-1 --format '{{.Image}}' > "$b/api-image.txt"
docker inspect infra-web-1 --format '{{.Image}}' > "$b/web-image.txt"
test "$(cat "$b/api-image.txt")" = sha256:b95cd99376819f463669d1867ba49c9ce416c9eee338d829910792b5c8342338
test "$(cat "$b/web-image.txt")" = sha256:a335aa12bd09a087414faf95ae7e71fff51804e82f574f0e58643c3b0d8fed1a
cp /opt/logoff-wms/wms/.env "$b/env-before"
cp /opt/logoff-wms/wms/infra/docker-compose.yml "$b/compose-before.yml"
docker inspect infra-postgres-1 --format '{{.Id}} {{.Image}} {{.State.StartedAt}}' > "$b/database-before.txt"
# FIX: patch a copy of live code, never the stale host checkout.
mkdir -p "$r/apps/api" "$r/apps/web"
docker cp infra-api-1:/app/apps/api/src "$r/apps/api/src"
docker cp infra-api-1:/app/apps/api/test "$r/apps/api/test"
for p in src public package.json tsconfig.json index.html; do
  cp -a "/opt/logoff-wms-releases/permanent-return-20260906/apps/web/$p" "$r/apps/web/$p"
done
docker exec infra-api-1 sh -c 'find /app/apps/api/src /app/apps/api/dist -type f -exec sha256sum {} +' | sort > "$b/api-before.sha256"
docker exec infra-web-1 sh -c 'find /usr/share/nginx/html -type f -exec sha256sum {} +' | sort > "$b/web-before.sha256"
cd "$r"
git apply -p2 --check /tmp/tsd-admin-recount-20260907.patch
git apply -p2 /tmp/tsd-admin-recount-20260907.patch
touch "$b/patch-applied"
# FIX: recoverable backup only; release never restores the live database.
docker exec infra-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$b/wms.dump"
sha256sum "$b/wms.dump" > "$b/wms.dump.sha256"
docker exec -i infra-postgres-1 pg_restore -l < "$b/wms.dump" > "$b/database-contents.txt"
test -s "$b/database-contents.txt"
echo TSD_RECOUNT_STAGED
