import pathlib,subprocess,json,time
r=pathlib.Path('/opt/logoff-wms-releases/fbo-sequential-20260924')
name='logoff-fbo283-focused-tests'
assert subprocess.run(['docker','inspect',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0
db=subprocess.check_output(['docker','run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_USER=codex_tests','-e','POSTGRES_DB=kiz_duplicate_tests','postgres:16-alpine','-p','55469']).decode().strip()
try:
 for i in range(30):
  if subprocess.run(['docker','exec',db,'pg_isready','-U','codex_tests','-p','55469'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:break
  time.sleep(1)
 else:raise Exception('Isolated database startup failed')
 subprocess.run(['docker','exec',db,'psql','-U','codex_tests','-p','55469','-d','kiz_duplicate_tests','-c','CREATE EXTENSION IF NOT EXISTS pg_trgm'],check=True)
 url='postgresql://codex_tests@127.0.0.1:55469/kiz_duplicate_tests'
 args=['docker','run','--rm','--cpus','2','--memory','4g','--network','container:'+db]
 for key in ['DATABASE_URL','FBO_TEST_DATABASE_URL','KIZ_DUPLICATE_TEST_DATABASE_URL']:args+=['-e',key+'='+url]
 args+=['-v',str(r/'tests/api/fbs-relabel-route-sync.spec.ts')+':/app/apps/api/test/fbs-relabel-route-sync.spec.ts:ro','-v','/opt/logoff-wms-releases/fbo-sequential-20260924/tests/api/fbo-two-stage.integration.spec.ts:/app/apps/api/test/fbo-two-stage.integration.spec.ts:ro','--entrypoint','sh','logoff-api:fbo-sequential-build','-c','cd /app/apps/api && node node_modules/prisma/build/index.js db push --skip-generate && node node_modules/vitest/vitest.mjs run test/fbo-two-stage.integration.spec.ts test/fbo-problems-policy.spec.ts test/fbo-local-route.spec.ts test/fbs-sequential-route.spec.ts test/fbs-sequential-ownership.spec.ts test/fbs-relabel-route-sync.spec.ts --no-file-parallelism']
 with (r/'focused-api-tests.log').open('w') as log:rc=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT).returncode
 tail=(r/'focused-api-tests.log').read_text()[-9000:]
 print(tail,flush=True)
 assert rc==0,'Integrated API tests failed'
 (r/'focused-api-tests.json').write_text(json.dumps({'passed':True,'isolatedDatabase':True,'network':'none'}))
finally:subprocess.run(['docker','stop','--time','5',db],stdout=subprocess.DEVNULL,check=True)
