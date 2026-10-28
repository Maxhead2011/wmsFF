# TEST: migration from exact previous runtime schema on an isolated internal network.
from pathlib import Path
import subprocess,time,json,os
r=Path('/opt/logoff-wms/wms/work/lamoda-mapping-20261028')
def run(*a,**kw):return subprocess.run(['docker',*a],check=True,**kw)
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
network='lamoda-isolated-test';pg='lamoda-test-pg'
assert network not in d('network','ls','--format','{{.Name}}').splitlines()
run('network','create','--internal',network)
try:
 run('run','-d','--name',pg,'--network',network,'-e','POSTGRES_PASSWORD=isolated-test','-e','POSTGRES_DB=lamoda_test','postgres:16-alpine')
 for attempt in range(30):
  if subprocess.run(['docker','exec',pg,'pg_isready','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(1)
 image=json.loads((r/'verification.json').read_text())['images']['api']
 run('exec',pg,'createdb','-U','postgres','lamoda_analytics_test')
 env=['--network',network,'-e','DATABASE_URL=postgresql://postgres:isolated-test@'+pg+':5432/lamoda_test','-e','ANALYTICS_DATABASE_URL=postgresql://postgres:isolated-test@'+pg+':5432/lamoda_analytics_test','-e','NODE_ENV=test','-e','WMS_LAMODA_FBO_ASSEMBLY_ENABLED=true','-e','WMS_LAMODA_SECRET_KEY='+__import__('base64').b64encode(bytes(range(32))).decode(),'-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules']
 run('run','--rm',*env,'--entrypoint','sh',image,'-c','cd /app/apps/api && pnpm exec prisma db push --schema prisma/analytics/schema.prisma --skip-generate')
 run('run','--rm',*env,'--entrypoint','sh',image,'-c','cd /app/apps/api && pnpm exec prisma db push --schema prisma/schema.prisma --skip-generate')
 # Migration and candidate schema must agree, including foreign keys/defaults/indexes.
 run('run','--rm',*env,'--entrypoint','sh',image,'-c','cd /app/apps/api && pnpm exec prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code')
 result=run('run','--rm','-i',*env,'-w','/app/apps/api','--entrypoint','node',image,input=(r/'postgres.cjs').read_bytes(),capture_output=True)
 print(result.stdout.decode());proof=json.loads(result.stdout.decode().splitlines()[-1]);assert proof['passed']>=14
 # Full Nest graph must boot with the new export/import, not merely load its JS files.
 api='lamoda-test-api'
 run('run','-d','--name',api,*env,'-e','JWT_ACCESS_SECRET=synthetic-test-access','-e','JWT_REFRESH_SECRET=synthetic-test-refresh','-e','API_PORT=3000','-w','/app/apps/api','--entrypoint','node',image,'dist/main.js')
 try:
  healthy=False
  for attempt in range(40):
   probe=subprocess.run(['docker','exec',api,'node','-e',"fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{if(!r.ok)throw Error();const d=await r.json();if(d.status!=='ok')throw Error()}).catch(()=>process.exit(1))"],capture_output=True)
   if probe.returncode==0:healthy=True;break
   time.sleep(1)
  if not healthy:print(d('logs',api));raise AssertionError('Full API did not start')
  proof['fullApiHealth']=True
 finally:subprocess.run(['docker','rm','-f',api],check=False)
 (r/'db-proof.json').write_text(json.dumps(proof))
finally:
 subprocess.run(['docker','rm','-f',pg],check=False);subprocess.run(['docker','network','rm',network],check=False)
