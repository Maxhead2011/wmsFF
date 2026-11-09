"""TEST: full candidate boot on disposable PostgreSQL; no production network or credentials."""
from pathlib import Path
import subprocess,json,time,base64,sys
r=Path(sys.argv[1]);image=json.loads((r/'stage.json').read_text())['images']['api'];network='wb-ribbon-print-test';pg=network+'-pg';app=network+'-api'
def run(*a,**kw):return subprocess.run(['docker',*a],check=True,**kw)
assert network not in subprocess.check_output(['docker','network','ls','--format','{{.Name}}'],text=True).splitlines()
run('network','create','--internal',network)
try:
 run('run','-d','--name',pg,'--network',network,'--memory','512m','-e','POSTGRES_PASSWORD=isolated-test','-e','POSTGRES_DB=ozon_test','postgres:16-alpine')
 for n in range(30):
  if subprocess.run(['docker','exec',pg,'pg_isready','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(1)
 run('exec',pg,'createdb','-U','postgres','ozon_analytics_test')
 env=['--network',network,'--memory','1g','-e',f'DATABASE_URL=postgresql://postgres:isolated-test@{pg}:5432/ozon_test','-e',f'ANALYTICS_DATABASE_URL=postgresql://postgres:isolated-test@{pg}:5432/ozon_analytics_test','-e','NODE_ENV=test','-e','WMS_FBO_DELIVERY_SYNC_ENABLED=false','-e','NODE_PATH=/app/apps/api/node_modules:/app/node_modules','-e','WMS_LAMODA_SECRET_KEY='+base64.b64encode(bytes(range(32))).decode(),'-e','WMS_OZON_FBO_IMPORT_ENABLED=true','-w','/app/apps/api']
 for schema in ['prisma/schema.prisma','prisma/analytics/schema.prisma']:
  run('run','--rm',*env,'--entrypoint','sh',image,'-c','pnpm exec prisma db push --schema '+schema+' --skip-generate')
 run('run','-d','--name',app,*env,'-e','JWT_ACCESS_SECRET=synthetic-access-test','-e','JWT_REFRESH_SECRET=synthetic-refresh-test','-e','API_PORT=3000','--entrypoint','node',image,'dist/main.js')
 for n in range(40):
  p=subprocess.run(['docker','exec',app,'node','-e',"fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{if(!r.ok||(await r.json()).status!=='ok')throw Error()}).catch(()=>process.exit(1))"],capture_output=True)
  if p.returncode==0:break
  time.sleep(1)
 else:raise RuntimeError('Isolated full API failed health')
 (r/'isolated-proof.json').write_text(json.dumps({'image':image,'fullApiHealth':True,'syntheticOnly':True}));print('Isolated PostgreSQL and full API health passed')
finally:
 subprocess.run(['docker','rm','-f',app,pg],check=False);subprocess.run(['docker','network','rm',network],check=False)
