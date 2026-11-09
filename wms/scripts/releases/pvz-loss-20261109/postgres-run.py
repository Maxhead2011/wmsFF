# TEST: schema-only read, then all writes occur in a disposable, externally isolated PostgreSQL.
import subprocess,time,json,pathlib,sys
r=pathlib.Path(sys.argv[1])
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
assert not d('ps','-aq','--filter','name=^pvz-loss-test-pg$')
schema=d('exec','wms-local-postgres','pg_dump','-U','wms','-d','wms','--schema-only','--no-owner','--no-privileges')
pg=d('inspect','wms-local-postgres','--format','{{.Image}}');d('network','create','--internal','pvz-loss-test')
try:
 d('run','-d','--name','pvz-loss-test-pg','--network','pvz-loss-test','-e','POSTGRES_USER=test','-e','POSTGRES_PASSWORD=test','-e','POSTGRES_DB=test',pg)
 for _ in range(40):
  if subprocess.run(['docker','exec','pvz-loss-test-pg','pg_isready','-h','127.0.0.1','-U','test'],capture_output=True).returncode==0:break
  time.sleep(1)
 subprocess.run(['docker','exec','-i','pvz-loss-test-pg','psql','-v','ON_ERROR_STOP=1','-U','test','-d','test'],input=schema,text=True,capture_output=True,check=True)
 result=d('run','--rm','--network','pvz-loss-test','-e','NODE_ENV=test','-e','DATABASE_URL=postgresql://test:test@pvz-loss-test-pg:5432/test','-v',str(r/'postgres.cjs')+':/app/apps/api/pvz-test.cjs:ro','-w','/app/apps/api','--entrypoint','node','wms-local-api:pvz-loss-20261109','pvz-test.cjs')
 (r/'postgres-proof.json').write_text(result);print(result)
finally:
 d('rm','-f','-v','pvz-loss-test-pg');d('network','rm','pvz-loss-test')

