"""FIX: pinned two-module own-WMS overlay; no business data migration."""
import subprocess,json,hashlib,fcntl,time,urllib.request,sys
from pathlib import Path
ROOT=Path('/opt/logoff-wms/wms/work/fbo-shipment-prefix-20261031')
APP=Path('/opt/logoff-wms/wms')
BASE='sha256:884a0905f5562e9ae5d9b10512d5b2ec75cee3234f4282de383d0544f659afa3'
FILE='common/kiz-shipment-prefix.js'
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def hashes(img):return {l.split(maxsplit=1)[1]:l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',img,'-c','find /app/apps/api/dist -type f -exec sha256sum {} +').splitlines()}
def stage():
 assert d('inspect','infra-api-1','--format','{{.Image}}')==BASE
 (ROOT/'Dockerfile').write_text('FROM '+BASE+'\nCOPY payload/ /app/apps/api/dist/\nENV WMS_KIZ_SHIPMENT_PREFIX_ENABLED=true\n')
 subprocess.run(['docker','build','--network','none','-t','logoff-api:fbo-shipment-prefix-20261031',str(ROOT)],check=True)
 img=d('image','inspect','logoff-api:fbo-shipment-prefix-20261031','--format','{{.Id}}')
 before,after=hashes(BASE),hashes(img)
 assert set(before)<=set(after)
 assert {k for k in after if before.get(k)!=after[k]}=={'/app/apps/api/dist/'+FILE,'/app/apps/api/dist/common/kiz-shipment-reads.js'}
 proofs={}
 result={'base':BASE,'image':img,'changed':{n:after['/app/apps/api/dist/'+n] for n in [FILE,'common/kiz-shipment-reads.js']},'files':len(after),'proofs':proofs}
 (ROOT/'verification.json').write_text(json.dumps(result));print(json.dumps(result))
def publish():
 locks=[]
 for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 assert d('inspect','infra-api-1','--format','{{.Image}}')==BASE
 v=json.loads((ROOT/'verification.json').read_text());pr=json.loads((ROOT/'pr.json').read_text())
 assert pr['merged'] and pr['head']['ref']=='fix/fbo-shipment-read-timeout' and pr['base']['ref']=='feature/wb-print-check'
 tests=json.loads((ROOT/'tests.json').read_text());assert tests['api']==4206 and tests['web']==582 and tests['typecheck']
 isolated=json.loads((ROOT/'isolated-proof.json').read_text());assert isolated['fullApiHealth'] and isolated['postgres']==10 and isolated['image']==v['image']
 before=json.loads(d('inspect','infra-api-1'))[0]
 others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='infra-api-1'}
 envhash=hashlib.sha256((APP/'.env').read_bytes()).hexdigest()
 d('tag',BASE,'logoff-api:before-fbo-shipment-prefix-20261031')
 def switch(img):
  d('tag',img,'infra-api:latest')
  subprocess.run(['docker','compose','--env-file',str(APP/'.env'),'-f',str(APP/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','api'],check=True)
 try:
  switch(v['image'])
  for attempt in range(30):
   try:
    if json.load(urllib.request.urlopen('https://wms.logoff.pro/api/v1/health',timeout=10))['status']=='ok':break
   except Exception:pass
   time.sleep(1)
  else:raise RuntimeError('API health failed')
  after=json.loads(d('inspect','infra-api-1'))[0]
  assert after['Image']==v['image'] and set(after['Config']['Env'])==set(before['Config']['Env'])|{'WMS_KIZ_SHIPMENT_PREFIX_ENABLED=true'}
  for name,value in v['changed'].items():assert d('exec','infra-api-1','sha256sum','/app/apps/api/dist/'+name).split()[0]==value
  assert all(d('inspect',n,'--format','{{.Id}}')==x for n,x in others.items())
  assert hashlib.sha256((APP/'.env').read_bytes()).hexdigest()==envhash
 except Exception:switch(BASE);raise
 v.update(published=True,pr=pr['number'],at=time.time(),otherContainersUnchanged=True,existingEnvironmentPreserved=True)
 (ROOT/'published.json').write_text(json.dumps(v));print(json.dumps(v))
if __name__=='__main__':publish() if sys.argv[-1]=='publish' else stage()
