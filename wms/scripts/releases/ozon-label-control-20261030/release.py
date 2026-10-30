"""FIX: exact own-WMS overlay on freshly verified images; no data/schema/env changes."""
from pathlib import Path
import subprocess,json,hashlib,sys,fcntl,time,urllib.request,re,zipfile,datetime
ROOT=Path('/opt/logoff-wms/wms/work/ozon-label-control-20261030');APP=Path('/opt/logoff-wms/wms')
BASE=json.loads((ROOT/'base.json').read_text())
ROOTS={'api':'/app/apps/api/dist/','web':'/usr/share/nginx/html/'}
ALLOWED={'api':set('modules/client-requests/ozon-assembly-supply.service.js modules/client-requests/ozon-assembly-supply.controller.js modules/administration/administration-internal-api.service.js modules/client-requests/ozon-supply-policy.js modules/tsd/ozon-label-control.js modules/tsd/fbo-two-stage.service.js'.split()),'web':set('index.html assets/ozon-label-control-20261030.js assets/ozon-label-history-core-20261030.js downloads/logoff-tsd-ozon-label-control-248.apk downloads/logoff-tsd.apk downloads/logoff-tsd.json'.split())}

def d(*args):return subprocess.check_output(['docker',*args],text=True).strip()
def check():
 for k,v in BASE.items():assert d('inspect','infra-'+k+'-1','--format','{{.Image}}')==v,'Live base changed: '+k
def hashes(img,k):return {line.split(maxsplit=1)[1].removeprefix(ROOTS[k]):line.split()[0] for line in d('run','--rm','--network','none','--entrypoint','sh',img,'-c','find '+ROOTS[k]+' -type f -exec sha256sum {} +').splitlines()}
def stage():
 check()
 dest=ROOT/'web/payload/downloads';dest.mkdir(parents=True,exist_ok=True)
 name='logoff-tsd-ozon-label-control-248.apk';jar='/opt/logoff-wms-releases/eleonora-release-20260912/apksigner.jar'
 subprocess.run(['sh','-c','. /opt/logoff-wms/secrets/tsd-signing.env; exec java -jar '+jar+' sign --ks "$TSD_KEYSTORE_PATH" --ks-key-alias "$TSD_KEY_ALIAS" --ks-pass env:TSD_KEYSTORE_PASSWORD --key-pass env:TSD_KEY_PASSWORD --out '+str(dest/name)+' '+str(ROOT/'unsigned.apk')],check=True)
 cert=subprocess.check_output(['java','-jar',jar,'verify','--verbose','--print-certs',str(dest/name)],text=True)
 assert re.search(r'Signer #1 certificate SHA-256 digest: (\w+)',cert).group(1)=='52916d7797ade50cc1c50bba8787b9d2307b1e5dfd4ea725bd7c3be0e64f989b'
 with zipfile.ZipFile(ROOT/'unsigned.apk') as a,zipfile.ZipFile(dest/name) as b:
  for n in a.namelist():assert a.read(n)==b.read(n)
 if (dest/(name+'.idsig')).exists():(dest/(name+'.idsig')).unlink()
 data=(dest/name).read_bytes();(dest/'logoff-tsd.apk').write_bytes(data)
 (dest/'logoff-tsd.json').write_text(json.dumps({'versionCode':248,'versionName':'0.1.248-ozon-label-control','apkUrl':'https://wms.logoff.pro/downloads/'+name,'sha256':hashlib.sha256(data).hexdigest(),'size':len(data),'releasedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'releaseNotes':'Ozon: scan the WMS carton then its attached Ozon sticker before completing control.'}))
 v={'base':BASE,'images':{},'hashes':{}}
 for k in BASE:
  ctx=ROOT/k/'payload';expected={p.relative_to(ctx).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in ctx.rglob('*') if p.is_file()};assert set(expected)==ALLOWED[k]
  df=ROOT/k/'Dockerfile';df.write_text('FROM '+BASE[k]+('\nENV WMS_OZON_LABEL_CONTROL_ENABLED=true\n' if k=='api' else '\n')+'COPY payload/ '+ROOTS[k]+'\n');tag='logoff-'+k+':ozon-label-control-20261030'
  subprocess.run(['docker','build','--network','none','-f',str(df),'-t',tag,str(ROOT/k)],check=True)
  img=d('image','inspect',tag,'--format','{{.Id}}');before,after=hashes(BASE[k],k),hashes(img,k)
  assert set(before)<=set(after) and {n for n in after if before.get(n)!=after[n]}==ALLOWED[k]
  assert all(after[n]==h for n,h in expected.items());v['images'][k]=img;v['hashes'][k]=expected
 (ROOT/'verification.json').write_text(json.dumps(v));print(json.dumps(v))
def get(p):return urllib.request.urlopen('https://wms.logoff.pro/'+p,timeout=20).read()
def publish():
 locks=[]
 for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 check();v=json.loads((ROOT/'verification.json').read_text());pr=json.loads((ROOT/'pr.json').read_text());tests=json.loads((ROOT/'tests.json').read_text())
 assert pr['state']=='MERGED' and pr['headRefName']=='feature/ozon-label-box-control' and pr['baseRefName']=='feature/wb-print-check'
 assert tests['api']>=4116 and tests['web']>=569 and tests['android']>=924 and tests['typecheck']
 assert json.loads((ROOT/'browser-proof.json').read_text())['passed']>=6
 assert json.loads((ROOT/'isolated-proof.json').read_text())['postgres']==12
 assert not (ROOT/'published.json').exists()
 for k in BASE:assert all(hashes(v['images'][k],k)[n]==h for n,h in v['hashes'][k].items())
 before=json.loads(d('inspect','infra-api-1'))[0];oldenv=set(before['Config']['Env']);envhash=hashlib.sha256((APP/'.env').read_bytes()).hexdigest()
 others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n not in ['infra-api-1','infra-web-1']}
 for k in BASE:d('tag',BASE[k],'logoff-'+k+':before-ozon-label-control-20261030')
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
  assert set(json.loads(d('inspect','infra-api-1'))[0]['Config']['Env'])==oldenv|{'WMS_OZON_LABEL_CONTROL_ENABLED=true'}
  for n,h in v['hashes']['web'].items():assert hashlib.sha256(get(n if n!='index.html' else '?ozon-stock='+str(pr['number']))).hexdigest()==h
  assert all(d('inspect',n,'--format','{{.Id}}')==ident for n,ident in others.items())
  assert hashlib.sha256((APP/'.env').read_bytes()).hexdigest()==envhash
 except Exception:switch(BASE);raise
 v.update(published=True,pr=pr['number'],at=time.time(),otherContainersUnchanged=True,envFileUnchanged=True)
 (ROOT/'published.json').write_text(json.dumps(v));print('Published and verified')
if __name__=='__main__':publish() if sys.argv[-1]=='publish' else stage()
