#!/usr/bin/env bash
set -euo pipefail
umask 077
r=/opt/logoff-wms-releases/billing-register-20260910
b=/opt/logoff-wms-backups/billing-register-20260910
api=sha256:e08a056b8cde8d7bdec1b15173cd92d10aadf07bf9ce41964cf44a10adf09e98
web=sha256:319e40701a7834f7be2b74e638795260d9947ca34aecb11c2e59dbfb3d8cfeb7
ca=infra-api:billing-register-20260910
cw=infra-web:billing-register-20260910
verify="$r/wms/infra/scripts/billing-release-artifacts.cjs"
sourceproof="$r/wms/infra/scripts/billing-release-source-proof.cjs"
exec 9>/run/logoff-wms-api-release.lock; flock -n 9
exec 8>/run/logoff-wms-web-release.lock; flock -n 8
same(){ test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$api"; test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$web"; }
unchanged(){ docker inspect infra-postgres-1 infra-analytics-postgres-1 infra-redis-1 infra-ollama-1 --format '{{.Id}} {{.Image}} {{.State.StartedAt}}'; }
hashapi(){ docker run --rm --network none --entrypoint sh "$1" -c 'find /app/apps/api/src /app/apps/api/dist -type f -exec sha256sum {} +' | sort; }
hashweb(){ docker run --rm --network none --entrypoint sh "$1" -c 'find /usr/share/nginx/html -type f -exec sha256sum {} +' | sort; }
case "$1" in
 stage|resume-stage)
  same
  if test "$1" = stage; then
  test ! -e "$b"; mkdir -m 700 "$b"
  cp /opt/logoff-wms/wms/.env "$b/env-before"; cp /opt/logoff-wms/wms/infra/docker-compose.yml "$b/compose-before"
  unchanged > "$b/unchanged-before"
  docker tag "$api" infra-api:before-billing-register-20260910
  docker tag "$web" infra-web:before-billing-register-20260910
  echo BACKUP_DATABASE
  docker exec infra-postgres-1 pg_dump -U wms -d wms -Fc > "$b/wms.dump"
  docker exec -i infra-postgres-1 pg_restore --list < "$b/wms.dump" > "$b/backup-contents"
  sha256sum "$b/wms.dump" > "$b/backup.sha256"
  docker cp infra-api-1:/app/apps/api/src "$b/live-api-src"
  else
   # FIX: never replace the recovery copy or reuse an already published/tested candidate.
   test -s "$b/backup.sha256"; test -s "$b/wms.dump"
   test ! -e "$b/published-at"; test ! -s "$b/tests-passed"
   sha256sum -c "$b/backup.sha256"
   cmp /opt/logoff-wms/wms/.env "$b/env-before"
   cmp /opt/logoff-wms/wms/infra/docker-compose.yml "$b/compose-before"
   test "$(docker image inspect infra-api:before-billing-register-20260910 --format '{{.Id}}')" = "$api"
   test "$(docker image inspect infra-web:before-billing-register-20260910 --format '{{.Id}}')" = "$web"
   unchanged > "$b/unchanged-resume"; cmp "$b/unchanged-before" "$b/unchanged-resume"
  fi
  node "$verify" baseline "$b/live-api-src"
  # FIX: freeze every build input before verification so another upload cannot mix revisions.
  context=$(mktemp -d "$b/build-context.XXXXXX")
  mkdir -p "$context/candidate" "$context/wms/infra"
  cp -a "$r/candidate/." "$context/candidate/"
  cp "$r/source-proof.json" "$context/source-proof.json"
  cp "$r/head-sha" "$context/head-sha"
  cp "$r/wms/infra/billing-register.Dockerfile" "$context/wms/infra/billing-register.Dockerfile"
  stagehead=$(cat "$context/head-sha")
  # FIX: reject a mixed upload during copying; only this verified private snapshot is built.
  node "$sourceproof" verify "$context/source-proof.json" "$context/candidate" "$stagehead"
  echo PROVE_WEB_BASELINE
  docker build --network none --build-arg BASE_API="$api" --build-arg BASE_WEB="$web" --target web-proof -f "$context/wms/infra/billing-register.Dockerfile" -t infra-web-proof:billing-register-20260910 "$context" > "$b/web-proof.log" 2>&1
  proof=$(docker create --network none infra-web-proof:billing-register-20260910)
  proofdir=$(mktemp -d "$b/web-proof.XXXXXX")
  docker cp "$proof:/app/apps/web/dist/." "$proofdir"; docker rm "$proof" >/dev/null
  docker exec infra-web-1 cat /usr/share/nginx/html/index.html > "$b/live-index.html"
  cmp "$proofdir/index.html" "$b/live-index.html"
  while IFS= read -r p; do
   test "$(sha256sum "$proofdir/$p" | cut -d' ' -f1)" = "$(docker exec infra-web-1 sha256sum "/usr/share/nginx/html/$p" | cut -d' ' -f1)"
  done < <(cd "$proofdir" && find assets -type f)
  echo LIVE_BASELINES_MATCH
  for kind in api web; do
   docker build --network none --build-arg BASE_API="$api" --build-arg BASE_WEB="$web" --target "$kind" -f "$context/wms/infra/billing-register.Dockerfile" -t "infra-$kind:billing-register-20260910" "$context" > "$b/$kind-build.log" 2>&1
  done
  hashapi "$api" > "$b/api-before.sha256"; hashapi "$ca" > "$b/api-after.sha256"
  hashweb "$web" > "$b/web-before.sha256"; hashweb "$cw" > "$b/web-after.sha256"
  node "$verify" api "$b/api-before.sha256" "$b/api-after.sha256"
  node "$verify" web "$b/web-before.sha256" "$b/web-after.sha256"
  for kind in api web; do
   if test "$kind" = api; then old="$api"; else old="$web"; fi
   docker image inspect "$old" --format '{{json .Config}}' > "$b/$kind-config-before.json"
   docker image inspect "infra-$kind:billing-register-20260910" --format '{{json .Config}}' > "$b/$kind-config-after.json"
   node - "$b/$kind-config-before.json" "$b/$kind-config-after.json" <<'NODE'
const fs=require('fs'),assert=require('node:assert/strict');
const [a,b]=process.argv.slice(2).map(p=>JSON.parse(fs.readFileSync(p)));
assert(JSON.stringify(a)===JSON.stringify(b),'Container configuration drift');
NODE
  done
  # FIX: bind the staged image manifests to the source verified before the build.
  cp "$context/head-sha" "$b/staged-head"
  same; date -u +'%FT%TZ' > "$b/staged-at"; echo BILLING_CANDIDATES_STAGED;;
 publish)
  same; test -s "$b/staged-at"; test -s "$b/tests-passed"; test ! -e "$b/published-at"
  node "$verify" pr "$r/pr-merged.json" "$(cat "$r/head-sha")"
  cmp "$r/head-sha" "$b/staged-head"
  node "$sourceproof" verify "$r/source-proof.json" "$r/candidate" "$(cat "$r/head-sha")"
  cd /opt/logoff-wms/wms
  cmp .env "$b/env-before"; cmp infra/docker-compose.yml "$b/compose-before"; sha256sum -c "$b/backup.sha256"
  an=$(docker image inspect "$ca" --format '{{.Id}}'); wn=$(docker image inspect "$cw" --format '{{.Id}}')
  # FIX: an old or unbound test marker cannot authorize different images or source.
  node "$verify" tests "$b/tests-passed" "$an" "$wn" "$(cat "$r/head-sha")"
  hashapi "$an" > "$b/api-now.sha256"; cmp "$b/api-after.sha256" "$b/api-now.sha256"
  hashweb "$wn" > "$b/web-now.sha256"; cmp "$b/web-after.sha256" "$b/web-now.sha256"
  rollback(){
   trap - ERR
   currenta=$(docker inspect infra-api-1 --format '{{.Image}}'); currentw=$(docker inspect infra-web-1 --format '{{.Image}}')
   if { test "$currenta" != "$api" && test "$currenta" != "$an"; } || { test "$currentw" != "$web" && test "$currentw" != "$wn"; }; then echo EXTERNAL_RELEASE_ROLLBACK_BLOCKED; return 1; fi
   docker tag "$api" infra-api:latest; docker tag "$web" infra-web:latest
   docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 api web
   echo PREVIOUS_IMAGES_RESTORED_NO_DATABASE_ROLLBACK
  }
  trap rollback ERR
  docker tag "$an" infra-api:latest
  docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 api
  ready=false
  for n in $(seq 1 25); do if curl --max-time 4 -fsS http://127.0.0.1:3000/api/v1/health > "$b/api-health.json"; then ready=true; break; fi; sleep 2; done
  test "$ready" = true
  docker tag "$wn" infra-web:latest
  docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps --no-build --timeout 30 web
  curl --retry 5 --retry-connrefused --retry-delay 2 --max-time 15 -fsS https://wms.logoff.pro/api/v1/health > "$b/public-health.json"
  node -e 'if(require(process.argv[1]).status!=="ok")process.exit(1)' "$b/public-health.json"
  curl --retry 5 --retry-connrefused --retry-delay 2 --max-time 15 -fsS https://wms.logoff.pro/ > "$b/public-index.html"
  docker run --rm --network none --entrypoint cat "$cw" /usr/share/nginx/html/index.html > "$b/expected-index.html"
  cmp "$b/expected-index.html" "$b/public-index.html"
  # FIX: publishing billing does not change TSD APK/channel downloads or infrastructure.
  hashweb "$wn" > "$b/web-published.sha256"; node "$verify" web "$b/web-before.sha256" "$b/web-published.sha256"
  unchanged > "$b/unchanged-after"; cmp "$b/unchanged-before" "$b/unchanged-after"
  cmp .env "$b/env-before"; cmp infra/docker-compose.yml "$b/compose-before"
  test "$(docker inspect infra-api-1 --format '{{.Image}}')" = "$an"; test "$(docker inspect infra-web-1 --format '{{.Image}}')" = "$wn"
  trap - ERR; date -u +'%FT%TZ' > "$b/published-at"; echo BILLING_REGISTER_PUBLISHED;;
 *) echo 'stage|resume-stage|publish'; exit 2;;
esac
