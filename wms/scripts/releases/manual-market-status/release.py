from pathlib import Path
import json,subprocess,hashlib,fcntl,time,urllib.request,sys
R=Path('/opt/wms-restore/releases/manual-market-status-20261104');C=Path('/opt/wms-restore/compose.json');base='sha256:29c18df547e05e6126c6cee8e16915234c2e7bfd60123e6f33b92a1dc6bc74dc'
def d(*args):return subprocess.check_output(['docker',*args],text=True).strip()
def sha(x):return hashlib.sha256(x).hexdigest()
def image():return d('inspect','wms-local-api','--format','{{.Image}}')
def files(img):return {n:h for h,n in (l.split(None,1) for l in d('run','--rm','--network','none','--entrypoint','sh',img,'-c','find /app/apps/api/dist -type f -exec sha256sum {} +').splitlines())}
if sys.argv[-1]=='stage':
 assert image()==base
 (R/'compose.before.json').write_bytes(C.read_bytes())
 (R/'Dockerfile').write_text('FROM '+base+'\nENV WMS_REQUEST_MARKET_STATUS_MANUAL_ENABLED=true\nCOPY payload/ /app/apps/api/dist/\n')
 tag='wms-local-api:manual-market-status-20261104';d('build','--network','none','-q','-t',tag,str(R));candidate=d('image','inspect',tag,'--format','{{.Id}}')
 a,b=files(base),files(candidate);expected={'/app/apps/api/dist/modules/client-requests/'+n for n in ['request-market-status.controller.js','fbo-delivery-sync.service.js']};assert set(a)==set(b);assert {n for n in a if a[n]!=b[n]}==expected
 result=d('run','--rm','--network','none','-v',str(R)+':/release:ro','-w','/app/apps/api','--entrypoint','node',candidate,'/release/runtime.cjs');assert json.loads(result)['passed']==6
 (R/'stage.json').write_text(json.dumps({'base':base,'candidate':candidate,'hashes':{n:b[n] for n in expected},'runtime':json.loads(result),'composeSha256':sha(C.read_bytes())}));print('Staged exact API2; runtime6 passed')
else:
 locks=[]
 for f in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  Path(f).parent.mkdir(parents=True,exist_ok=True);x=open(f,'a');fcntl.flock(x,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(x)
 proof=json.loads((R/'stage.json').read_text());tests=json.loads((R/'tests.json').read_text());pr=json.loads((R/'pr.json').read_text());assert pr['state']=='MERGED' and pr['baseRefName']=='feature/la_panthera';assert tests['api']>=4294 and tests['types']
 assert image()==base and sha(C.read_bytes())==proof['composeSha256'];before=json.loads(C.read_text());oldenv=json.loads(d('inspect','wms-local-api'))[0]['Config']['Env'];others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='wms-local-api'}
 candidate=json.loads(C.read_text());candidate['services']['api']['image']=proof['candidate'];assert {k:v for k,v in before['services']['api'].items() if k!='image'}=={k:v for k,v in candidate['services']['api'].items() if k!='image'}
 def switch(config):
  C.write_text(json.dumps(config,indent=2));d('compose','-f',str(C),'up','-d','--no-deps','--no-build','--pull','never','api')
 try:
  switch(candidate)
  for attempt in range(30):
   try:
    d('exec','wms-local-api','node','-e',"fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{if(!r.ok||(await r.json()).status!=='ok')process.exit(1)}).catch(()=>process.exit(1))");break
   except subprocess.CalledProcessError:
    if attempt==29:raise
    time.sleep(1)
  env=json.loads(d('inspect','wms-local-api'))[0]['Config']['Env'];assert 'WMS_FBO_DELIVERY_SYNC_ENABLED=false' in env and 'WMS_REQUEST_MARKET_STATUS_MANUAL_ENABLED=true' in env;assert all(v in env for v in oldenv if not v.startswith('WMS_REQUEST_MARKET_STATUS_MANUAL_ENABLED='));assert all(d('inspect',n,'--format','{{.Id}}')==v for n,v in others.items());assert image()==proof['candidate']
 except Exception:
  switch(before);raise
 (R/'published.json').write_text(json.dumps({'pr':pr['number'],'backgroundPaused':True,'otherContainersUnchanged':True,**proof}));print('Published API2; health, paused background and other containers verified')
