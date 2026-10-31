"""TEST: full candidate boot against disposable PostgreSQL, never production data."""
from pathlib import Path
import subprocess,json,time,base64
r=Path('/opt/logoff-wms/wms/work/cargo-pickup-20261031');image=json.loads((r/'verification.json').read_text())['images']['api']
network='cargo-pickup-test';pg=network+'-pg';app=network+'-api'
def run(*args,**kw):return subprocess.run(['docker',*args],check=True,**kw)
assert network not in subprocess.check_output(['docker','network','ls','--format','{{.Name}}'],text=True).splitlines()
run('network','create','--internal',network)
try:
 run('run','-d','--name',pg,'--network',network,'--memory','512m','-e','POSTGRES_PASSWORD=isolated-test','-e','POSTGRES_DB=client_stores_test','postgres:16-alpine')
 for n in range(30):
  if subprocess.run(['docker','exec',pg,'pg_isready','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(1)
 run('exec',pg,'createdb','-U','postgres','client_stores_analytics_test')
 env=['--network',network,'--memory','1g','-e',f'DATABASE_URL=postgresql://postgres:isolated-test@{pg}:5432/client_stores_test','-e',f'ANALYTICS_DATABASE_URL=postgresql://postgres:isolated-test@{pg}:5432/client_stores_analytics_test','-e','NODE_ENV=test','-e','WMS_FBO_DELIVERY_SYNC_ENABLED=false','-e','NODE_PATH=/app/apps/api/node_modules:/app/node_modules','-e','WMS_LAMODA_SECRET_KEY='+base64.b64encode(bytes(range(32))).decode(),'-e','WMS_RECEIPT_CHANNELS_ENABLED=false','-v',str(r)+':/release:ro','-w','/app/apps/api']
 for schema in ['prisma/schema.prisma','prisma/analytics/schema.prisma']:
  run('run','--rm',*env,'--entrypoint','sh',image,'-c','pnpm exec prisma db push --schema '+schema+' --skip-generate')
 run('exec','-i',pg,'psql','-U','postgres','-d','client_stores_test','-v','ON_ERROR_STOP=1',input=(r/'billing.sql').read_bytes())
 run('run','--rm',*env,'--entrypoint','node',image,'/release/postgres.cjs')
 run('run','-d','--name',app,*env,'-e','JWT_ACCESS_SECRET=synthetic-access-test','-e','JWT_REFRESH_SECRET=synthetic-refresh-test','-e','API_PORT=3000','--entrypoint','node',image,'dist/main.js')
 for n in range(45):
  p=subprocess.run(['docker','exec',app,'node','-e',"fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{if(!r.ok||(await r.json()).status!=='ok')throw Error()}).catch(()=>process.exit(1))"],capture_output=True)
  if p.returncode==0:break
  time.sleep(1)
 else:
  subprocess.run(['docker','logs',app],check=False)
  raise RuntimeError('Full isolated API failed health')
 proof={'image':image,'fullApiHealth':True,'syntheticOnly':True,'postgres':8};(r/'isolated-proof.json').write_text(json.dumps(proof));print(json.dumps(proof))
finally:
 subprocess.run(['docker','rm','-f',app,pg],check=False);subprocess.run(['docker','network','rm',network],check=False)
