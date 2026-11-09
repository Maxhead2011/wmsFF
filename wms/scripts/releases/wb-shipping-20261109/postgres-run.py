# TEST: schema-only read, then all writes occur in a disposable, externally isolated PostgreSQL.
import subprocess,time,json,pathlib,sys
r=pathlib.Path(sys.argv[1])
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
assert not d('ps','-aq','--filter','name=^wb-shipping-test-pg$')
schema=d('exec','wms-local-postgres','pg_dump','-U','wms','-d','wms','--schema-only','--no-owner','--no-privileges')
pg=d('inspect','wms-local-postgres','--format','{{.Image}}');d('network','create','--internal','wb-shipping-test')
try:
 d('run','-d','--name','wb-shipping-test-pg','--network','wb-shipping-test','-e','POSTGRES_USER=test','-e','POSTGRES_PASSWORD=test','-e','POSTGRES_DB=test',pg)
 for _ in range(40):
  if subprocess.run(['docker','exec','wb-shipping-test-pg','pg_isready','-h','127.0.0.1','-U','test'],capture_output=True).returncode==0:break
  time.sleep(1)
 subprocess.run(['docker','exec','-i','wb-shipping-test-pg','psql','-v','ON_ERROR_STOP=1','-U','test','-d','test'],input=schema,text=True,capture_output=True,check=True)
 result=d('run','--rm','--network','wb-shipping-test','-e','NODE_ENV=test','-e','DATABASE_URL=postgresql://test:test@wb-shipping-test-pg:5432/test','-v',str(r/'postgres.cjs')+':/app/apps/api/shipping-test.cjs:ro','-w','/app/apps/api','--entrypoint','node','wms-local-api:wb-shipping-20261109','shipping-test.cjs')
 (r/'postgres-proof.json').write_text(result);print(result)
finally:
 d('rm','-f','-v','wb-shipping-test-pg');d('network','rm','wb-shipping-test')
