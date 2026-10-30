"""TEST: final candidate, actual PostgreSQL races and full Nest health on an internal network."""
from pathlib import Path
import subprocess,json,time,base64
r=Path('/opt/logoff-wms/wms/work/kiz-client-guard-20261029')
image=json.loads((r/'verification.json').read_text())['images']['api']
network='kiz-client-guard-final-test';pg=network+'-pg';app=network+'-api'
def run(*args,**kwargs):return subprocess.run(['docker',*args],check=True,**kwargs)
assert network not in subprocess.check_output(['docker','network','ls','--format','{{.Name}}'],text=True).splitlines()
assert not {pg,app}.intersection(subprocess.check_output(['docker','ps','-a','--format','{{.Names}}'],text=True).splitlines())
run('network','create','--internal',network)
try:
 run('run','-d','--name',pg,'--network',network,'--memory','512m','-e','POSTGRES_PASSWORD=isolated-test','-e','POSTGRES_DB=kiz_guard_test','postgres:16-alpine')
 for n in range(30):
  if subprocess.run(['docker','exec',pg,'pg_isready','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(1)
 run('exec',pg,'createdb','-U','postgres','kiz_guard_analytics_test')
 env=['--network',network,'--memory','1g','-e',f'DATABASE_URL=postgresql://postgres:isolated-test@{pg}:5432/kiz_guard_test',
  '-e',f'ANALYTICS_DATABASE_URL=postgresql://postgres:isolated-test@{pg}:5432/kiz_guard_analytics_test',
  '-e','KIZ_GUARD_ISOLATED_TEST=true','-e','NODE_ENV=test','-e','NODE_PATH=/app/apps/api/node_modules:/app/node_modules',
  '-e','WMS_LAMODA_SECRET_KEY='+base64.b64encode(bytes(range(32))).decode(),'-e','WMS_RECEIPT_CHANNELS_ENABLED=false',
  '-v',str(r)+':/release:ro','-w','/app/apps/api']
 for schema in ['prisma/schema.prisma','prisma/analytics/schema.prisma']:
  run('run','--rm',*env,'--entrypoint','sh',image,'-c','pnpm exec prisma db push --schema '+schema+' --skip-generate')
 for _ in range(2):run('run','--rm',*env,'--entrypoint','node',image,'/release/receipt-schema.cjs','--migration=/release/migration.sql','--apply')
 result=run('run','--rm',*env,'--entrypoint','node',image,'/release/receipt-postgres.cjs',capture_output=True)
 print(result.stdout.decode());proof=json.loads(result.stdout.decode().splitlines()[-1]);assert proof['passed']>=12
 for script in ['receipt-runtime.cjs','reuse-runtime.cjs','shipment-runtime.cjs','transport-runtime.cjs']:
  if not (r/script).exists():raise RuntimeError('Missing runtime proof '+script)
  result=run('run','--rm',*env,'--entrypoint','node',image,'/release/'+script,'/app/apps/api/dist',capture_output=True)
  print(result.stdout.decode());proof[script]=json.loads(result.stdout.decode().splitlines()[-1])
 run('run','-d','--name',app,*env,'-e','JWT_ACCESS_SECRET=synthetic-access-test','-e','JWT_REFRESH_SECRET=synthetic-refresh-test',
  '-e','API_PORT=3000','--entrypoint','node',image,'dist/main.js')
 healthy=False
 for n in range(45):
  p=subprocess.run(['docker','exec',app,'node','-e',"fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{if(!r.ok||(await r.json()).status!=='ok')throw Error()}).catch(()=>process.exit(1))"],capture_output=True)
  if p.returncode==0:healthy=True;break
  time.sleep(1)
 if not healthy:print(subprocess.check_output(['docker','logs',app],stderr=subprocess.STDOUT).decode()[-8000:])
 assert healthy,'Full candidate Nest API did not become healthy'
 proof.update(image=image,fullApiHealth=True,syntheticOnly=True);(r/'db-proof.json').write_text(json.dumps(proof));print(json.dumps(proof))
except subprocess.CalledProcessError as e:
 if e.stdout:print(e.stdout.decode())
 if e.stderr:print(e.stderr.decode())
 raise
finally:
 subprocess.run(['docker','rm','-f',app,pg],check=False);subprocess.run(['docker','network','rm',network],check=False)
