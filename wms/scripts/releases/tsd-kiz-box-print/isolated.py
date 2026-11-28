from pathlib import Path
import subprocess,json,time,base64
r=Path(__file__).resolve().parent;image=json.loads((r/'stage.json').read_text())['image'];network='kiz-box-print-test';pg=network+'-pg';app=network+'-api'
def run(*args):return subprocess.check_output(['docker',*args],text=True).strip()
assert network not in run('network','ls','--format','{{.Name}}').splitlines()
run('network','create','--internal',network)
try:
 run('run','-d','--name',pg,'--network',network,'-e','POSTGRES_PASSWORD=test','-e','POSTGRES_DB=test','postgres:16-alpine')
 for _ in range(30):
  if subprocess.run(['docker','exec',pg,'pg_isready','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(1)
 run('exec',pg,'createdb','-U','postgres','analytics')
 env=['--network',network,'-e',f'DATABASE_URL=postgresql://postgres:test@{pg}:5432/test','-e',f'ANALYTICS_DATABASE_URL=postgresql://postgres:test@{pg}:5432/analytics','-e','NODE_ENV=test','-e','NODE_PATH=/app/apps/api/node_modules:/app/node_modules','-e','WMS_TSD_KIZ_BOX_PRINT_ENABLED=true','-e','WMS_LAMODA_SECRET_KEY='+base64.b64encode(bytes(range(32))).decode(),'-e','JWT_ACCESS_SECRET=synthetic-test','-e','JWT_REFRESH_SECRET=synthetic-test','-v',str(r)+':/release','-w','/app/apps/api']
 for schema in ['prisma/schema.prisma','prisma/analytics/schema.prisma']:run('run','--rm',*env,'--entrypoint','sh',image,'-c','pnpm exec prisma db push --skip-generate --schema '+schema)
 result=run('run','--rm',*env,'--entrypoint','node',image,'/release/postgres.cjs');print(result,flush=True)
 run('run','-d','--name',app,*env,'-e','API_PORT=3000','--entrypoint','node',image,'dist/main.js')
 for _ in range(45):
  if subprocess.run(['docker','exec',app,'node','-e',"fetch('http://127.0.0.1:3000/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"],capture_output=True).returncode==0:break
  time.sleep(1)
 else:raise RuntimeError(run('logs','--tail','35',app))
 (r/'isolated-proof.json').write_text(json.dumps({'image':image,'fullNestHealth':True,'result':json.loads(result.splitlines()[-1])}));print('Full Nest health passed',flush=True)
finally:
 subprocess.run(['docker','rm','-f',app,pg],capture_output=True);subprocess.run(['docker','network','rm',network],capture_output=True)
