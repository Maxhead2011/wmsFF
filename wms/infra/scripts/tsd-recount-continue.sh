#!/usr/bin/env bash
set -euo pipefail
umask 077
exec 9>/run/logoff-wms-api-release.lock
flock -n 9
exec 8>/run/logoff-wms-web-release.lock
flock -n 8
b=/opt/logoff-wms-backups/tsd-admin-recount-20260907
r=/opt/logoff-wms-releases/tsd-admin-recount-20260907
test ! -e "$b/patch-applied"
test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$(cat "$b/api-image.txt")"
test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$(cat "$b/web-image.txt")"
cmp /opt/logoff-wms/wms/.env "$b/env-before"
node /tmp/tsd-recount-adapt.cjs
cd "$r"
git apply -p2 --check /tmp/tsd-admin-recount-20260907.patch
git apply -p2 /tmp/tsd-admin-recount-20260907.patch
touch "$b/patch-applied"
docker exec infra-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$b/wms.dump"
sha256sum "$b/wms.dump" > "$b/wms.dump.sha256"
docker exec -i infra-postgres-1 pg_restore -l < "$b/wms.dump" > "$b/database-contents.txt"
test -s "$b/database-contents.txt"
echo TSD_RECOUNT_STAGED
