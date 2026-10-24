from pathlib import Path
import subprocess,time,json
r=Path('/opt/logoff-wms/wms/work/request-removal-20261024-v2')
def run(*a,**kw):return subprocess.run(['docker',*a],check=True,**kw)
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
network='request-removal-test';pg='request-removal-test-pg'
# Dedicated internal network; no ports or production volumes.
assert network not in d('network','ls','--format','{{.Name}}').splitlines()
run('network','create','--internal',network)
try:
 run('run','-d','--name',pg,'--network',network,'-e','POSTGRES_PASSWORD=isolated-test','-e','POSTGRES_DB=removal_test','postgres:16-alpine')
 for attempt in range(30):
  if subprocess.run(['docker','exec',pg,'pg_isready','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(1)
 image=json.loads((r/'verification.json').read_text())['api']
 env=['--network',network,'-e','DATABASE_URL=postgresql://postgres:isolated-test@'+pg+':5432/removal_test','-e','NODE_ENV=test','-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules']
 run('run','--rm',*env,'--entrypoint','sh',image,'-c','cd /app/apps/api && pnpm exec prisma db push --skip-generate')
 result=run('run','--rm','-i',*env,'--entrypoint','node',image,input=(r/'postgres.cjs').read_bytes(),capture_output=True)
 print(result.stdout.decode());proof=json.loads(result.stdout.decode().splitlines()[-1]);assert proof['passed']==9;(r/'db-proof.json').write_text(json.dumps(proof))
finally:
 subprocess.run(['docker','rm','-f',pg],check=False)
 subprocess.run(['docker','network','rm',network],check=False)
