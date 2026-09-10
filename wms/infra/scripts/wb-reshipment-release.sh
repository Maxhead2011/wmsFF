#!/usr/bin/env bash
# FIX: additive LOGOFF-only release, fenced against concurrent deployments.
set -euo pipefail
umask 077
r=/opt/logoff-wms-releases/wb-reshipment-20260910/package
b=/opt/logoff-wms-backups/wb-reshipment-20260910
api=sha256:fec74a0ee538fc9e7ace9c31b3a852b58a0cb7096bcea2ef299211024300c65a
web=sha256:72fc0c1d4817b8a883b87e65224920f9f681544cca0f2bf0db42f48d14e88f71
verify="$r/wms/infra/scripts/wb-reshipment-release.cjs"
exec 9>/run/logoff-wms-api-release.lock; flock -n 9
exec 8>/run/logoff-wms-web-release.lock; flock -n 8
same(){ test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$api"; test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$web"; }
infra(){ docker inspect infra-postgres-1 infra-analytics-postgres-1 infra-redis-1 infra-ollama-1 --format '{{.Id}} {{.Image}} {{.State.StartedAt}}'; }
hashapi(){ docker run --rm --network none --entrypoint sh "$1" -c 'find /app/apps/api/src /app/apps/api/dist -type f -exec sha256sum {} +' | sort; }
hashweb(){ docker run --rm --network none --entrypoint sh "$1" -c 'find /usr/share/nginx/html -type f -exec sha256sum {} +' | sort; }
case "${1:?stage or publish}" in
stage|resume-stage)
 same
 if test "$1" = stage; then test ! -e "$b"; mkdir -m 700 "$b";
 else test -s "$b/backup.sha256"; test ! -e "$b/tests-passed"; test ! -e "$b/published-at"; sha256sum -c "$b/backup.sha256"; cmp /opt/logoff-wms/wms/.env "$b/env-before"; cmp /opt/logoff-wms/wms/infra/docker-compose.yml "$b/compose-before"; fi
 node "$verify" verify "$r"
 if test "$1" = stage; then
 cp /opt/logoff-wms/wms/.env "$b/env-before"; cp /opt/logoff-wms/wms/infra/docker-compose.yml "$b/compose-before"
 infra > "$b/infra-before"
 docker tag "$api" infra-api:before-wb-reshipment-20260910; docker tag "$web" infra-web:before-wb-reshipment-20260910
 docker exec infra-postgres-1 pg_dump -U wms -d wms -Fc > "$b/wms.dump"
 docker exec -i infra-postgres-1 pg_restore --list < "$b/wms.dump" > "$b/backup-list"
 sha256sum "$b/wms.dump" > "$b/backup.sha256"
 fi
 context=$(mktemp -d "$b/context.XXXXXX"); cp -a "$r/." "$context/"
 node "$verify" verify "$context"
 if test "$1" = stage; then docker cp infra-api-1:/app/apps/api/src "$b/live-api-src"; fi
 docker cp infra-api-1:/app/apps/api/prisma/schema.prisma "$b/live-schema.prisma"
 mkdir "$context/live-web"
 cp -a /opt/logoff-wms-releases/billing-register-20260910/candidate/wms/apps/web/src/. "$context/live-web/"
 node - "$context" "$b" <<'NODE'
const fs=require('fs'),crypto=require('crypto'),assert=require('assert/strict'); const [r,b]=process.argv.slice(2);
const m=JSON.parse(fs.readFileSync(r+'/manifest.json')); const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
for(const [p,h] of Object.entries(m.files)) if(h.before){
 let live;
 if(p.startsWith('wms/apps/api/src/')) live=b+'/live-api-src/'+p.slice('wms/apps/api/src/'.length);
 else if(p==='wms/apps/api/prisma/schema.prisma') {
   require(r+'/wms/infra/scripts/wb-reshipment-release.cjs').schemaBaseline(fs.readFileSync(b+'/live-schema.prisma'),fs.readFileSync(r+'/baseline/'+p));
   continue;
 }
 else if(p.startsWith('wms/apps/web/src/')) live=r+'/live-web/'+p.slice('wms/apps/web/src/'.length);
 else throw Error('Unexpected existing baseline '+p);
 assert.equal(sha(live),h.before,'Live baseline drift: '+p);
}
console.log('LIVE_SOURCE_BASELINES_MATCH');
NODE
 docker build --network none --target web-proof -f "$context/wms/infra/wb-reshipment.Dockerfile" -t infra-web-proof:wb-reshipment-20260910 "$context" > "$b/web-proof.log" 2>&1
 proof=$(docker create --network none infra-web-proof:wb-reshipment-20260910)
 mkdir "$b/proof-web"; docker cp "$proof:/app/apps/web/dist/." "$b/proof-web/"; docker rm "$proof" >/dev/null
 docker exec infra-web-1 cat /usr/share/nginx/html/index.html > "$b/live-index.html"
 cmp "$b/proof-web/index.html" "$b/live-index.html"
 while IFS= read -r p; do test "$(sha256sum "$b/proof-web/$p" | cut -d' ' -f1)" = "$(docker exec infra-web-1 sha256sum "/usr/share/nginx/html/$p" | cut -d' ' -f1)"; done < <(cd "$b/proof-web" && find assets -type f)
 echo LIVE_WEB_REPRODUCED
 for kind in api web test; do docker build --network none --target "$kind" -f "$context/wms/infra/wb-reshipment.Dockerfile" -t "infra-$kind:wb-reshipment-20260910" "$context" > "$b/$kind-build.log" 2>&1; done
 docker run --rm --network none --memory 2g --cpus 2 -w /app/apps/api --entrypoint sh infra-test:wb-reshipment-20260910 -c 'node node_modules/vitest/vitest.mjs run test/fbs-reshipment*.spec.ts test/administration-internal-api.service.spec.ts test/billing-live-compat.spec.ts --maxWorkers=2 --minWorkers=2' > "$b/api-tests.log" 2>&1
 for kind in api web; do
  if test "$kind" = api; then old="$api"; hashapi "$old" > "$b/api-before.sha256"; hashapi infra-api:wb-reshipment-20260910 > "$b/api-after.sha256";
  else old="$web"; hashweb "$old" > "$b/web-before.sha256"; hashweb infra-web:wb-reshipment-20260910 > "$b/web-after.sha256"; fi
  node "$verify" artifacts "$kind" "$b/$kind-before.sha256" "$b/$kind-after.sha256"
  docker image inspect "$old" --format '{{json .Config}}' > "$b/$kind-config-before.json"
  docker image inspect "infra-$kind:wb-reshipment-20260910" --format '{{json .Config}}' > "$b/$kind-config-after.json"
  cmp "$b/$kind-config-before.json" "$b/$kind-config-after.json"
 done
 cp "$context/manifest.json" "$b/staged-manifest.json"
 docker image inspect infra-api:wb-reshipment-20260910 infra-web:wb-reshipment-20260910 --format '{{.Id}}' > "$b/staged-images"
 same; infra > "$b/infra-staged"; cmp "$b/infra-before" "$b/infra-staged"
 date -u +'%FT%TZ' > "$b/tests-passed"; echo RESHIPMENT_CANDIDATES_VERIFIED;;
publish)
 same; test -s "$b/tests-passed"; test ! -e "$b/published-at"
 node "$verify" verify "$r"; cmp "$r/manifest.json" "$b/staged-manifest.json"
 node - "$r/manifest.json" "$r/pr-merged.json" <<'NODE'
const fs=require('fs'),assert=require('assert/strict');const [m,p]=process.argv.slice(2).map(p=>JSON.parse(fs.readFileSync(p)));
assert.equal(p.state,'MERGED'); assert.equal(p.headRefOid,m.head); assert.equal(p.baseRefName,'feature/billing-period-register-20260910');
assert(/^https:\/\/github.com\/Maxhead2011\/wmsFF\/pull\/\d+$/.test(p.url));
NODE
 docker image inspect infra-api:wb-reshipment-20260910 infra-web:wb-reshipment-20260910 --format '{{.Id}}' > "$b/publish-images"
 cmp "$b/staged-images" "$b/publish-images"
 hashapi infra-api:wb-reshipment-20260910 > "$b/api-now.sha256"; cmp "$b/api-after.sha256" "$b/api-now.sha256"
 hashweb infra-web:wb-reshipment-20260910 > "$b/web-now.sha256"; cmp "$b/web-after.sha256" "$b/web-now.sha256"
 cd /opt/logoff-wms/wms; cmp .env "$b/env-before"; cmp infra/docker-compose.yml "$b/compose-before"; sha256sum -c "$b/backup.sha256"
 # FIX: apply exactly the reviewed additive migration and its Prisma receipt atomically.
 node - "$r" > "$b/migration.sql" <<'NODE'
const fs=require('fs'),crypto=require('crypto');const r=process.argv[2],name='20260910144000_fbs_reshipment';
const bytes=fs.readFileSync(r+'/candidate/wms/apps/api/prisma/migrations/'+name+'/migration.sql');
console.log("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';");
console.log(bytes.toString());
console.log(`INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count) VALUES ('${crypto.randomUUID()}','${crypto.createHash('sha256').update(bytes).digest('hex')}','${name}',NOW(),NOW(),1);`);
NODE
 docker exec -i infra-postgres-1 psql -U wms -d wms -v ON_ERROR_STOP=1 --single-transaction < "$b/migration.sql" > "$b/migration.log"
 # Feature remains off while the new server boots; no WB writes in release checks.
 rollback(){
  trap - ERR
  currenta=$(docker inspect infra-api-1 --format '{{.Image}}'); currentw=$(docker inspect infra-web-1 --format '{{.Image}}')
  an=$(head -1 "$b/staged-images"); wn=$(tail -1 "$b/staged-images")
  if { test "$currenta" != "$api" && test "$currenta" != "$an"; } || { test "$currentw" != "$web" && test "$currentw" != "$wn"; }; then echo EXTERNAL_RELEASE_ROLLBACK_BLOCKED; return 1; fi
  cp "$b/env-before" .env
  docker tag "$api" infra-api:latest; docker tag "$web" infra-web:latest
  docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 api web
  echo ROLLED_BACK_IMAGES_ADDITIVE_TABLES_RETAINED
 }
 trap rollback ERR
 docker tag infra-api:wb-reshipment-20260910 infra-api:latest
 docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 api
 ready=false; for n in $(seq 1 25); do if curl --max-time 4 -fsS http://127.0.0.1:3000/api/v1/health > "$b/health-off.json"; then ready=true; break; fi; sleep 2; done; test "$ready" = true
 # FIX: narrow persistent feature opt-in for this WMS; all other env bytes retained.
 node - <<'NODE'
const fs=require('fs'),assert=require('assert/strict');let s=fs.readFileSync('.env','utf8');
assert(!/^WMS_FBS_RESHIPMENT_ENABLED=/m.test(s),'Unexpected pre-existing feature configuration');
fs.writeFileSync('.env',s+(s.endsWith('\n')?'':'\n')+'WMS_FBS_RESHIPMENT_ENABLED=true\n');
NODE
 docker tag infra-web:wb-reshipment-20260910 infra-web:latest
 docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 api web
 ready=false; for n in $(seq 1 25); do if curl --max-time 4 -fsS https://wms.logoff.pro/api/v1/health > "$b/health.json"; then ready=true; break; fi; sleep 2; done; test "$ready" = true
 node -e 'if(require(process.argv[1]).status!=="ok")process.exit(1)' "$b/health.json"
 curl --retry 5 --retry-connrefused --retry-delay 2 --max-time 15 -fsS https://wms.logoff.pro/ > "$b/public-index.html"
 docker exec infra-web-1 cat /usr/share/nginx/html/index.html > "$b/expected-index.html"; cmp "$b/public-index.html" "$b/expected-index.html"
 test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$(head -1 "$b/staged-images")"
 test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$(tail -1 "$b/staged-images")"
 test "$(docker exec infra-api-1 printenv WMS_FBS_RESHIPMENT_ENABLED)" = true
 infra > "$b/infra-after"; cmp "$b/infra-before" "$b/infra-after"; cmp infra/docker-compose.yml "$b/compose-before"
 trap - ERR; date -u +'%FT%TZ' > "$b/published-at"; echo RESHIPMENT_PUBLISHED;;
*) exit 2;;
esac
