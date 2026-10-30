"""TEST: isolated PostgreSQL for receipt guard; never mounts production secrets or networks."""
from pathlib import Path
import subprocess,json,time
root=Path('/opt/logoff-wms/wms/work/kiz-receipt-test-20261029')
image='sha256:b99d8dafcf402fbdf04f4baca725a0a680b7ddd8a555126e324dd5263d56b4be'
network='kiz-receipt-20261029-test';pg=network+'-pg'
def run(*args,**kwargs):return subprocess.run(['docker',*args],check=True,**kwargs)
assert network not in subprocess.check_output(['docker','network','ls','--format','{{.Name}}'],text=True).splitlines()
assert pg not in subprocess.check_output(['docker','ps','-a','--format','{{.Names}}'],text=True).splitlines()
run('network','create','--internal',network)
created=False
try:
 run('run','-d','--name',pg,'--network',network,'--memory','512m','-e','POSTGRES_PASSWORD=isolated-test','-e','POSTGRES_DB=kiz_receipt_test','postgres:16-alpine');created=True
 for n in range(30):
  if subprocess.run(['docker','exec',pg,'pg_isready','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(1)
 env=['--network',network,'--memory','1g','-e',f'DATABASE_URL=postgresql://postgres:isolated-test@{pg}:5432/kiz_receipt_test',
      '-e','KIZ_GUARD_ISOLATED_TEST=true','-e','NODE_ENV=test','-e','WMS_KIZ_CLIENT_GUARD_ENABLED=true',
      '-e','NODE_PATH=/app/apps/api/node_modules:/app/node_modules','-w','/app/apps/api']
 run('run','--rm',*env,'--entrypoint','sh',image,'-c','pnpm exec prisma db push --schema prisma/schema.prisma --skip-generate')
 # TEST: live-safe concurrent-index installer can resume and verifies each index twice.
 schema_mounts=['-v',str(root/'migration.sql')+':/test/migration.sql:ro','-v',str(root/'receipt-schema.cjs')+':/test/receipt-schema.cjs:ro']
 for _ in range(2):run('run','--rm',*env,*schema_mounts,'--entrypoint','node',image,'/test/receipt-schema.cjs','--migration=/test/migration.sql','--apply')
 mounts=[]
 for p in (root/'payload').rglob('*'):
  if p.is_file():mounts+=['-v',str(p)+':/app/apps/api/dist/'+p.relative_to(root/'payload').as_posix()+':ro']
 mounts+=['-v',str(root/'receipt-postgres.cjs')+':/test/receipt-postgres.cjs:ro']
 result=run('run','--rm',*env,*mounts,'--entrypoint','node',image,'/test/receipt-postgres.cjs',capture_output=True)
 print(result.stdout.decode());proof=json.loads(result.stdout.decode().splitlines()[-1]);assert proof['passed']==11
 proof['baseImage']=image;(root/'receipt-db-proof.json').write_text(json.dumps(proof));print(json.dumps(proof))
except subprocess.CalledProcessError as e:
 if e.stdout:print(e.stdout.decode())
 if e.stderr:print(e.stderr.decode())
 raise
finally:
 if created:subprocess.run(['docker','rm','-f',pg],check=False)
 subprocess.run(['docker','network','rm',network],check=False)
