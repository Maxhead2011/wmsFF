#!/usr/bin/env bash
set -euo pipefail
umask 077
b=/opt/logoff-wms-backups/permanent-return-20260906
test ! -e "$b/wms.dump"
cp /opt/logoff-wms/wms/infra/docker-compose.yml "$b/compose-before.yml"
docker exec infra-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$b/wms.dump"
docker exec -i infra-postgres-1 pg_restore --list < "$b/wms.dump" > "$b/database-contents.txt"
sha256sum "$b/wms.dump" > "$b/wms.dump.sha256"
test -s "$b/database-contents.txt"
echo BACKUP_VERIFIED
