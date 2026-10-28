# TEST: never connect to production; mount the four candidate modules over the verified image.
from pathlib import Path
import subprocess, json, time, base64
root = Path('/opt/logoff-wms/wms/work/kubrin-stock-fix-20261028')
image = json.loads((root/'verification.json').read_text())['images']['api']
network, pg = 'kubrin-stock-test', 'kubrin-stock-test-pg'
def run(*args, **kw): return subprocess.run(['docker', *args], check=True, **kw)
assert network not in subprocess.check_output(['docker','network','ls','--format','{{.Name}}'],text=True).splitlines()
run('network','create','--internal',network)
try:
 run('run','-d','--name',pg,'--network',network,'-e','POSTGRES_PASSWORD=isolated-test','-e','POSTGRES_DB=kubrin_stock_test','postgres:16-alpine')
 for attempt in range(30):
  if subprocess.run(['docker','exec',pg,'pg_isready','-U','postgres'],capture_output=True).returncode==0: break
  time.sleep(1)
 run('exec',pg,'createdb','-U','postgres','kubrin_analytics_test')
 env=['--network',network,'-e',f'DATABASE_URL=postgresql://postgres:isolated-test@{pg}:5432/kubrin_stock_test',
      '-e',f'ANALYTICS_DATABASE_URL=postgresql://postgres:isolated-test@{pg}:5432/kubrin_analytics_test','-e','NODE_ENV=test','-e','WMS_LAMODA_ENABLED=true','-e','WMS_LAMODA_FBO_ASSEMBLY_ENABLED=true',
      '-e','WMS_LAMODA_SECRET_KEY='+base64.b64encode(bytes(range(32))).decode(),
      '-e','WMS_RECEIPT_CHANNELS_ENABLED=false','-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules']
 run('run','--rm',*env,'--entrypoint','sh',image,'-c','cd /app/apps/api && pnpm exec prisma db push --schema prisma/schema.prisma --skip-generate')
 result=run('run','--rm','-i',*env,'--entrypoint','node',image,input=(root/'postgres.cjs').read_bytes(),capture_output=True)
 print(result.stdout.decode())
 proof=json.loads(result.stdout.decode().splitlines()[-1]);assert proof['passed']==8
 run('run','--rm',*env,'--entrypoint','sh',image,'-c','cd /app/apps/api && pnpm exec prisma db push --schema prisma/analytics/schema.prisma --skip-generate')
 api='kubrin-stock-test-api'
 run('run','-d','--name',api,*env,'-e','JWT_ACCESS_SECRET=synthetic-test-access','-e','JWT_REFRESH_SECRET=synthetic-test-refresh','-e','API_PORT=3000','-w','/app/apps/api','--entrypoint','node',image,'dist/main.js')
 try:
  healthy=False
  for attempt in range(40):
   probe=subprocess.run(['docker','exec',api,'node','-e',"fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{if(!r.ok||(await r.json()).status!=='ok')throw Error()}).catch(()=>process.exit(1))"],capture_output=True)
   if probe.returncode==0:healthy=True;break
   time.sleep(1)
  if not healthy:raise AssertionError('Full API did not start')
  proof['fullApiHealth']=True
 finally:subprocess.run(['docker','rm','-f',api],check=False)
 proof['image']=image
 (root/'db-proof.json').write_text(json.dumps(proof));print(json.dumps(proof))
except subprocess.CalledProcessError as error:
 if error.stdout: print(error.stdout.decode())
 if error.stderr: print(error.stderr.decode())
 raise
finally:
 subprocess.run(['docker','rm','-f',pg],check=False)
 subprocess.run(['docker','network','rm',network],check=False)
