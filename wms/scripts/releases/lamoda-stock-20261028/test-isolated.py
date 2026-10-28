# TEST: never connect to production; mount the two candidate modules over the verified image.
from pathlib import Path
import subprocess, json, time, base64
root = Path('/opt/logoff-wms/wms/work/lamoda-stock-20261028')
image = 'sha256:c508378d6c5ae11cdf18e918ef36fd8ea8bc59c0fc91c8f7cfd47ce5e51e4f08'
network, pg = 'lamoda-stock-test', 'lamoda-stock-test-pg'
def run(*args, **kw): return subprocess.run(['docker', *args], check=True, **kw)
assert network not in subprocess.check_output(['docker','network','ls','--format','{{.Name}}'],text=True).splitlines()
run('network','create','--internal',network)
try:
 run('run','-d','--name',pg,'--network',network,'-e','POSTGRES_PASSWORD=isolated-test','-e','POSTGRES_DB=lamoda_stock_test','postgres:16-alpine')
 for attempt in range(30):
  if subprocess.run(['docker','exec',pg,'pg_isready','-U','postgres'],capture_output=True).returncode==0: break
  time.sleep(1)
 env=['--network',network,'-e',f'DATABASE_URL=postgresql://postgres:isolated-test@{pg}:5432/lamoda_stock_test',
      '-e','NODE_ENV=test','-e','WMS_LAMODA_ENABLED=true','-e','WMS_LAMODA_FBO_ASSEMBLY_ENABLED=true',
      '-e','WMS_LAMODA_SECRET_KEY='+base64.b64encode(bytes(range(32))).decode(),
      '-e','WMS_RECEIPT_CHANNELS_ENABLED=false','-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules']
 mounts=[]
 for name in ['lamoda.service.js','lamoda-stock-guard.js']:
  mounts += ['-v',f'{root}/{name}:/app/apps/api/dist/modules/lamoda/{name}:ro']
 run('run','--rm',*env,'--entrypoint','sh',image,'-c','cd /app/apps/api && pnpm exec prisma db push --schema prisma/schema.prisma --skip-generate')
 result=run('run','--rm','-i',*env,*mounts,'--entrypoint','node',image,input=(root/'postgres.cjs').read_bytes(),capture_output=True)
 print(result.stdout.decode())
 proof=json.loads(result.stdout.decode().splitlines()[-1]);assert proof['passed']==6
 (root/'db-proof.json').write_text(json.dumps(proof))
except subprocess.CalledProcessError as error:
 if error.stdout: print(error.stdout.decode())
 if error.stderr: print(error.stderr.decode())
 raise
finally:
 subprocess.run(['docker','rm','-f',pg],check=False)
 subprocess.run(['docker','network','rm',network],check=False)
