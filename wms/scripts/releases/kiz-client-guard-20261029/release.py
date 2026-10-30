"""FIX: own-WMS-only pinned overlay, additive schema, immutable history and rollback."""
from pathlib import Path
import subprocess,json,hashlib,sys,fcntl,time,urllib.request
ROOT=Path('/opt/logoff-wms/wms/work/kiz-client-guard-20261029')
APP=Path('/opt/logoff-wms/wms')
BASE={'api':'sha256:b99d8dafcf402fbdf04f4baca725a0a680b7ddd8a555126e324dd5263d56b4be',
      'web':'sha256:4f4ac23ce16bdb0aab407ca9b900af9899399a74aa6ddc5c254ec37ece6b207d'}
ROOTS={'api':'/app/apps/api/dist/','web':'/usr/share/nginx/html/'}
ALLOWED={'api':set('''common/kiz-client-registry.js common/kiz-client-review.js common/kiz-review-queue.js
common/stock/wb-order-stock-lifecycle.js common/reconciliation/wb-background.js
modules/marketplace-connections/marketplace-connections.service.js modules/stock/stock-operations.service.js
modules/tsd/tsd-receipt.service.js modules/tsd/tsd-review.service.js modules/tsd/kiz-receipt-conflict.js
modules/tsd/tsd-operation-log.service.js modules/tsd/tsd-device.controller.js modules/tsd/tsd-sync.service.js
modules/tsd/fbo-two-stage.service.js modules/tsd/fbo-unboxed-picking.js modules/imports/imports.service.js
modules/warehouse/warehouse.service.js modules/administration/administration-internal-api.service.js'''.split()),
'web':{'index.html','assets/kiz-client-guard-20261029.js','downloads/logoff-tsd-kiz-duplicate-stop-244.apk','downloads/logoff-tsd.apk','downloads/logoff-tsd.json'}}
def d(*args):return subprocess.check_output(['docker',*args],text=True).strip()
def check():
 for k,v in BASE.items():assert d('inspect','infra-'+k+'-1','--format','{{.Image}}')==v,'Published baseline changed: '+k
def hashes(image,kind):return {line.split(maxsplit=1)[1].removeprefix(ROOTS[kind]):line.split()[0] for line in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find '+ROOTS[kind]+' -type f -exec sha256sum {} +').splitlines()}
def get(name):
 for attempt in range(30):
  try:return urllib.request.urlopen('https://wms.logoff.pro/'+name,timeout=15).read()
  except Exception:
   if attempt==29:raise
   time.sleep(1)
def stage():
 check();result={'base':BASE,'images':{},'hashes':{}}
 for kind in BASE:
  ctx=ROOT/kind;expected={p.relative_to(ctx/'payload').as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in (ctx/'payload').rglob('*') if p.is_file()}
  assert set(expected)==ALLOWED[kind],(kind,set(expected)^ALLOWED[kind])
  extra='\nCOPY schema.prisma /app/apps/api/prisma/schema.prisma\nENV WMS_KIZ_CLIENT_GUARD_ENABLED=true\n' if kind=='api' else ''
  (ctx/'Dockerfile').write_text('FROM '+BASE[kind]+'\nCOPY payload/ '+ROOTS[kind]+extra+'\n')
  tag='logoff-'+kind+':kiz-client-guard-20261029';subprocess.run(['docker','build','--network','none','-t',tag,str(ctx)],check=True)
  image=d('image','inspect',tag,'--format','{{.Id}}');before,after=hashes(BASE[kind],kind),hashes(image,kind)
  assert set(before)<=set(after) and {n for n in after if before.get(n)!=after[n]}==ALLOWED[kind]
  assert all(after[n]==v for n,v in expected.items());result['images'][kind]=image;result['hashes'][kind]=expected
 result['schemaSha256']=hashlib.sha256((ROOT/'api/schema.prisma').read_bytes()).hexdigest()
 (ROOT/'verification.json').write_text(json.dumps(result));print(json.dumps(result['images']))
def publish():
 locks=[]
 for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 check();v=json.loads((ROOT/'verification.json').read_text());pr=json.loads((ROOT/'pr.json').read_text())
 assert pr['state']=='MERGED' and pr['headRefName']=='fix/kiz-client-duplicate-guard';assert not (ROOT/'published.json').exists()
 browser=json.loads((ROOT/'web/runtime-test.json').read_text());db=json.loads((ROOT/'db-proof.json').read_text())
 assert browser['checks']>=16 and not browser['browserErrors'] and browser['preservedRuntime']
 web_manifest=json.loads((ROOT/'web/manifest.json').read_text());assert web_manifest['sha256']==v['hashes']['web'][web_manifest['artifact']]
 assert db['passed']>=12 and db['fullApiHealth'] and db['image']==v['images']['api']
 for script,minimum in [('receipt-runtime.cjs',8),('reuse-runtime.cjs',8),('shipment-runtime.cjs',7),('transport-runtime.cjs',3)]:assert db[script]['passed']>=minimum
 tests=json.loads((ROOT/'tests.json').read_text());assert tests['api']['success'] and tests['web']['success'] and tests['typecheck']
 android=json.loads((ROOT/'android-manifest-244.json').read_text())
 assert "versionCode='244'" in android['package'] and 'Verified using v2 scheme (APK Signature Scheme v2): true' in android['signature']
 assert len(android['voiceAssets'])==13 and all(t['tests']>=295 and not t['failures'] and not t['errors'] for t in android['tests'].values())
 assert android['sha256']==v['hashes']['web']['downloads/logoff-tsd.apk']==v['hashes']['web']['downloads/logoff-tsd-kiz-duplicate-stop-244.apk']
 for kind in BASE:
  actual=hashes(v['images'][kind],kind);assert all(actual[n]==h for n,h in v['hashes'][kind].items())
 others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n not in ['infra-api-1','infra-web-1']}
 env_before=hashlib.sha256((APP/'.env').read_bytes()).hexdigest()
 compose=json.loads(subprocess.check_output(['docker','compose','--env-file',str(APP/'.env'),'-f',str(APP/'infra/docker-compose.yml'),'config','--format','json']))
 assert compose['services']['api'].get('environment',{}).get('WMS_KIZ_CLIENT_GUARD_ENABLED') in [None,'true'],'Compose overrides client guard flag'
 # Apply only additive registry/index definitions, then immutable history. No balances are repaired.
 live=json.loads(d('inspect','infra-api-1'))[0]
 db_url=next(x.split('=',1)[1] for x in live['Config']['Env'] if x.startswith('DATABASE_URL='))
 network=next(iter(live['NetworkSettings']['Networks']))
 for script,args in [('receipt-schema.cjs',['--migration=/release/migration.sql','--apply']),('receipt-backfill.cjs',['--apply'])]:
  result=subprocess.run(['docker','run','--rm','--network',network,'--memory','1g','-e','DATABASE_URL='+db_url,
   '-e','NODE_PATH=/app/apps/api/node_modules:/app/node_modules','-v',str(ROOT)+':/release:ro','-w','/app/apps/api',
   '--entrypoint','node',v['images']['api'],'/release/'+script,*args],capture_output=True)
  if result.returncode:raise RuntimeError(result.stderr.decode()[-3000:])
  (ROOT/(script+'.apply.log')).write_bytes(result.stdout)
 for k in BASE:d('tag',BASE[k],'logoff-'+k+':before-kiz-client-guard-20261029')
 def switch(images):
  for k,img in images.items():d('tag',img,'infra-'+k+':latest')
  subprocess.run(['docker','compose','--env-file',str(APP/'.env'),'-f',str(APP/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','api','web'],check=True)
 try:
  switch(v['images']);assert json.loads(get('api/v1/health'))['status']=='ok'
  actual_env=json.loads(d('inspect','infra-api-1'))[0]['Config']['Env'];assert 'WMS_KIZ_CLIENT_GUARD_ENABLED=true' in actual_env
  for kind in BASE:assert d('inspect','infra-'+kind+'-1','--format','{{.Image}}')==v['images'][kind]
  for n,h in v['hashes']['web'].items():assert hashlib.sha256(get(n if n!='index.html' else '?kiz-release='+str(pr['number']))).hexdigest()==h
  assert all(d('inspect',n,'--format','{{.Id}}')==x for n,x in others.items())
  assert hashlib.sha256((APP/'.env').read_bytes()).hexdigest()==env_before
 except Exception:switch(BASE);raise
 v.update(published=True,pr=pr['number'],at=time.time(),otherContainersUnchanged=True,envUnchanged=True,dbProof=db,browserProof=browser)
 (ROOT/'published.json').write_text(json.dumps(v));print('Published: API health, public hashes, APK244 and container isolation verified.')
if __name__=='__main__':publish() if sys.argv[-1]=='publish' else stage()
