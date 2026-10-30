"""FIX: pinned own-WMS overlay with exact-file checks and rollback."""
from pathlib import Path
import subprocess,json,hashlib,sys,fcntl,time,urllib.request
ROOT=Path('/opt/logoff-wms/wms/work/found-unit-20261030');APP=Path('/opt/logoff-wms/wms')
BASE={'api':'sha256:a6869f7a212a8d34a9a7998ed3c86f17d21b6d3f8af0b741d0a2e2fc31691cb2','web':'sha256:1337bf9d6d252aee214d58220380529a0dd6d0a8ec9054938d0013b2fca7f185'}
ROOTS={'api':'/app/apps/api/dist/','web':'/usr/share/nginx/html/'}
ALLOWED={'api':set('''modules/inventory/inventory.controller.js modules/inventory/inventory.service.js modules/inventory/dto/inventory.dto.js modules/inventory/confirmed-kiz-transfer.js modules/inventory/found-unit-review.js modules/administration/administration.service.js modules/administration/administration-internal-api.service.js modules/tsd/fbo-known-kiz.js modules/tsd/fbo-two-stage.service.js'''.split()),'web':{'index.html','assets/inventory-found-unit-20261030.js'}}
def d(*args):return subprocess.check_output(['docker',*args],text=True).strip()
def check():
 for k,v in BASE.items():assert d('inspect','infra-'+k+'-1','--format','{{.Image}}')==v,'Live base changed: '+k
def hashes(img,k):return {line.split(maxsplit=1)[1].removeprefix(ROOTS[k]):line.split()[0] for line in d('run','--rm','--network','none','--entrypoint','sh',img,'-c','find '+ROOTS[k]+' -type f -exec sha256sum {} +').splitlines()}
def stage():
 check();v={'base':BASE,'images':{},'hashes':{}}
 for k in BASE:
  ctx=ROOT/(k+'-payload');expected={p.relative_to(ctx).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in ctx.rglob('*') if p.is_file()}
  assert set(expected)==ALLOWED[k]
  dockerfile=ROOT/('Dockerfile.'+k);dockerfile.write_text('FROM '+BASE[k]+'\nCOPY '+k+'-payload/ '+ROOTS[k]+('\nENV WMS_INVENTORY_FOUND_UNIT_ENABLED=true' if k=='api' else '')+'\n')
  tag='logoff-'+k+':found-unit-20261030';subprocess.run(['docker','build','--network','none','-f',str(dockerfile),'-t',tag,str(ROOT)],check=True)
  img=d('image','inspect',tag,'--format','{{.Id}}');before,after=hashes(BASE[k],k),hashes(img,k)
  assert set(before)<=set(after) and {n for n in after if before.get(n)!=after[n]}==ALLOWED[k]
  assert all(after[n]==h for n,h in expected.items());v['images'][k]=img;v['hashes'][k]=expected
 result=d('run','--rm','--network','none','-e','NODE_PATH=/app/apps/api/node_modules:/app/node_modules','-v',str(ROOT)+':/release:ro','--entrypoint','node',v['images']['api'],'/release/runtime.cjs')
 v['runtime']=json.loads(result.splitlines()[-1]);assert v['runtime']['passed']==10
 (ROOT/'verification.json').write_text(json.dumps(v));print(json.dumps(v))
def get(p):return urllib.request.urlopen('https://wms.logoff.pro/'+p,timeout=20).read()
def publish():
 locks=[]
 for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 check();v=json.loads((ROOT/'verification.json').read_text());pr=json.loads((ROOT/'pr.json').read_text());tests=json.loads((ROOT/'tests.json').read_text())
 assert pr['state']=='MERGED' and pr['headRefName']=='fix/inventory-found-kiz-review' and pr['baseRefName']=='feature/wb-print-check'
 assert tests['api']==4070 and tests['web']==557 and tests['typecheck']
 assert json.loads((ROOT/'isolated-proof.json').read_text())['fullApiHealth']
 assert json.loads((ROOT/'browser-proof.json').read_text())['passed']>=5
 assert not (ROOT/'published.json').exists()
 for k in BASE:assert all(hashes(v['images'][k],k)[n]==h for n,h in v['hashes'][k].items())
 before=json.loads(d('inspect','infra-api-1'))[0];oldenv=set(before['Config']['Env']);envhash=hashlib.sha256((APP/'.env').read_bytes()).hexdigest()
 assert not any(x.startswith('WMS_INVENTORY_FOUND_UNIT_ENABLED=') for x in oldenv)
 others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n not in ['infra-api-1','infra-web-1']}
 for k in BASE:d('tag',BASE[k],'logoff-'+k+':before-found-unit-20261030')
 def switch(images):
  for k,img in images.items():d('tag',img,'infra-'+k+':latest')
  subprocess.run(['docker','compose','--env-file',str(APP/'.env'),'-f',str(APP/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','api','web'],check=True)
 try:
  switch(v['images'])
  for attempt in range(30):
   try:
    if json.loads(get('api/v1/health'))['status']=='ok':break
   except Exception:pass
   time.sleep(1)
  else:raise RuntimeError('Health failed')
  for k in BASE:assert d('inspect','infra-'+k+'-1','--format','{{.Image}}')==v['images'][k]
  assert set(json.loads(d('inspect','infra-api-1'))[0]['Config']['Env'])==oldenv|{'WMS_INVENTORY_FOUND_UNIT_ENABLED=true'}
  for n,h in v['hashes']['web'].items():assert hashlib.sha256(get(n if n!='index.html' else '?found-unit='+str(pr['number']))).hexdigest()==h
  assert all(d('inspect',n,'--format','{{.Id}}')==ident for n,ident in others.items())
  assert hashlib.sha256((APP/'.env').read_bytes()).hexdigest()==envhash
 except Exception:switch(BASE);raise
 v.update(published=True,pr=pr['number'],at=time.time(),otherContainersUnchanged=True,envFileUnchanged=True)
 (ROOT/'published.json').write_text(json.dumps(v));print('Published and verified')
if __name__=='__main__':publish() if sys.argv[-1]=='publish' else stage()
