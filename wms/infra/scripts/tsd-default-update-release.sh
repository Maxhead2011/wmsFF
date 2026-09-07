#!/usr/bin/env bash
set -euo pipefail
umask 077
exec 8>/run/logoff-wms-web-release.lock
flock -n 8
b=/opt/logoff-wms-backups/tsd-default-158-20260907
r=/opt/logoff-wms-releases/tsd-default-158-20260907
base=sha256:0f8685f00f71c50d192622ea99cb8fe2916d022c5b9b4a4d1231167302cb21ce
hash=022edfc8dbaeeac7118752ff6a641a3e57a950da8f47985bf6f81a2bf332ca3b
hashes(){ docker run --rm --network none --entrypoint sh "$1" -c 'find /usr/share/nginx/html -type f -exec sha256sum {} +' | sort; }
test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$base"
if test "${1:-}" = stage; then
 test ! -e "$b"; test ! -e "$r"; mkdir -m 700 "$b" "$r"
 cp /opt/logoff-wms/wms/.env "$b/env-before"; cp /opt/logoff-wms/wms/infra/docker-compose.yml "$b/compose-before"
 docker inspect infra-api-1 --format '{{.Image}}' > "$b/api-before"
 docker inspect infra-postgres-1 --format '{{.Id}} {{.State.StartedAt}}' > "$b/db-before"
 cp /tmp/logoff-tsd-default-158.json "$r/logoff-tsd.json"
 hashes "$base" > "$b/before.sha256"
 docker build --network none --build-arg BASE_WEB="$base" -f /tmp/tsd-default-update.Dockerfile -t infra-web:tsd-default-158-20260907 "$r" > "$b/build.log" 2>&1
 hashes infra-web:tsd-default-158-20260907 > "$b/after.sha256"
 node /tmp/tsd-default-update-verify.cjs "$b"
 docker run --rm --network none --user nginx --entrypoint sh infra-web:tsd-default-158-20260907 -c 'test -r /usr/share/nginx/html/downloads/logoff-tsd.json && test -r /usr/share/nginx/html/downloads/logoff-tsd.apk'
 # TEST: real nginx returns the expected public metadata and APK in an isolated container.
 docker run --rm --network infra_default --entrypoint sh infra-web:tsd-default-158-20260907 -c 'nginx && wget -qO /tmp/m.json http://127.0.0.1/downloads/logoff-tsd.json && wget -qO /tmp/a.apk http://127.0.0.1/downloads/logoff-tsd.apk && cat /tmp/m.json && sha256sum /tmp/a.apk' > "$b/nginx-smoke.log" 2>&1
 grep -q "$hash" "$b/nginx-smoke.log"; echo STAGED; exit 0
fi
test "${1:-}" = publish
test ! -f "$b/published-at"
node -e 'const p=require(process.argv[1]);if(!p.merged||p.head.ref!=="fix/tsd-default-update-158"||p.base.ref!=="fix/fbs-box-scan-route-consistency")process.exit(1)' "$b/pr-merged.json"
cd /opt/logoff-wms/wms
cmp .env "$b/env-before"; cmp infra/docker-compose.yml "$b/compose-before"
hashes "$base" > "$b/before-now"; cmp "$b/before.sha256" "$b/before-now"
new=$(docker image inspect infra-web:tsd-default-158-20260907 --format '{{.Id}}')
hashes "$new" > "$b/after-now"; cmp "$b/after.sha256" "$b/after-now"
node /tmp/tsd-default-update-verify.cjs "$b"
rollback(){
 trap - ERR
 current=$(docker inspect infra-web-1 --format '{{.Image}}')
 test "$current" = "$new" || test "$current" = "$base" || return 1
 docker tag "$base" infra-web:latest
 docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build web
 echo WEB_ROLLED_BACK
}
trap rollback ERR
docker tag "$new" infra-web:latest
docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 web
curl --retry 5 --retry-connrefused --retry-delay 2 --max-time 20 -fsS https://wms.logoff.pro/downloads/logoff-tsd.json > "$b/public.json"
node -e 'const p=require(process.argv[1]);if(p.versionCode!==158||p.versionName!=="0.1.159-admin-box-count"||p.size!==2243713||p.apkUrl!=="https://wms.logoff.pro/downloads/logoff-tsd-admin-box-count-158.apk"||p.sha256!==process.argv[2])process.exit(1)' "$b/public.json" "$hash"
curl --retry 5 --retry-delay 2 --max-time 60 -fsS https://wms.logoff.pro/downloads/logoff-tsd.apk > "$b/public.apk"
test "$(sha256sum "$b/public.apk" | cut -d' ' -f1)" = "$hash"
docker inspect infra-api-1 --format '{{.Image}}' > "$b/api-after"; cmp "$b/api-before" "$b/api-after"
docker inspect infra-postgres-1 --format '{{.Id}} {{.State.StartedAt}}' > "$b/db-after"; cmp "$b/db-before" "$b/db-after"
test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$new"
curl --max-time 15 -fsS https://wms.logoff.pro/api/v1/health > "$b/health.json"
trap - ERR; date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/published-at"; echo PUBLISHED
