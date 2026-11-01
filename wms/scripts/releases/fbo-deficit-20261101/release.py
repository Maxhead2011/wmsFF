"""FIX: exact own-WMS required KIZ and review fixes; existing flags, no schema changes."""
from pathlib import Path
import subprocess,json,hashlib,sys,fcntl,time,urllib.request
ROOT=Path('/opt/logoff-wms/wms/work/fbo-deficit-release-20261101');APP=Path('/opt/logoff-wms/wms')
BASE=json.loads((ROOT/'base.json').read_text());ROOTS={'api':'/app/apps/api/dist/','web':'/usr/share/nginx/html/'}
ALLOWED={'web': {'assets/fbo-deficit-20261101.js', 'index.html', 'downloads/logoff-tsd.json', 'assets/warehouse-problems-20261101.js', 'downloads/logoff-tsd-fbo-deficit-250.apk', 'assets/warehouse-problems-20261101.css', 'downloads/logoff-tsd.apk'}, 'api': {'modules/client-requests/dto/create-client-request.dto.js', 'modules/tsd/fbo-picking-capacity.js', 'modules/administration/administration-internal-api.service.js', 'modules/client-requests/client-requests.service.js', 'modules/inventory/inventory.controller.js', 'modules/tsd/fbo-two-stage.service.js', 'common/stock/fbo-missing-stock.js', 'modules/inventory/inventory.service.js', 'modules/client-requests/client-request-xlsx.service.js', 'modules/tsd/fbo-fbs-reservations.js', 'modules/client-requests/dto/preview-client-request-availability.dto.js', 'modules/tsd/dto/fbo-action.dto.js', 'common/stock/wb-order-stock-lifecycle.js'}}
def d(*args):return subprocess.check_output(['docker',*args],text=True).strip()
def check():
 for k,v in BASE.items():assert d('inspect','infra-'+k+'-1','--format','{{.Image}}')==v,'Live base changed: '+k
def hashes(img,k):return {line.split(maxsplit=1)[1].removeprefix(ROOTS[k]):line.split()[0] for line in d('run','--rm','--network','none','--entrypoint','sh',img,'-c','find '+ROOTS[k]+' -type f -exec sha256sum {} +').splitlines()}
def sign():
 import zipfile,re,datetime,shutil
 tests=json.loads((ROOT/'tests.json').read_text());assert tests['android']>0
 unsigned=ROOT/'unsigned.apk';assert hashlib.sha256(unsigned.read_bytes()).hexdigest()==tests['unsignedSha256']
 dest=ROOT/'web-payload/downloads';dest.mkdir(parents=True,exist_ok=True);target=dest/'logoff-tsd-fbo-deficit-250.apk'
 jar='/opt/logoff-wms-releases/eleonora-release-20260912/apksigner.jar'
 command='. /opt/logoff-wms/secrets/tsd-signing.env; exec java -jar '+jar+' sign --ks "$TSD_KEYSTORE_PATH" --ks-key-alias "$TSD_KEY_ALIAS" --ks-pass env:TSD_KEYSTORE_PASSWORD --key-pass env:TSD_KEY_PASSWORD --out '+str(target)+' '+str(unsigned)
 subprocess.run(['sh','-c',command],check=True)
 verified=subprocess.check_output(['java','-jar',jar,'verify','--verbose','--print-certs',str(target)],text=True)
 cert=re.search(r'Signer #1 certificate SHA-256 digest: (\w+)',verified).group(1);assert cert=='52916d7797ade50cc1c50bba8787b9d2307b1e5dfd4ea725bd7c3be0e64f989b'
 with zipfile.ZipFile(unsigned) as a,zipfile.ZipFile(target) as b:
  for n in a.namelist():assert a.read(n)==b.read(n)
 shutil.copyfile(target,dest/'logoff-tsd.apk')
 meta={'versionCode':250,'versionName':'0.1.250-fbo-deficit','apkUrl':'https://wms.logoff.pro/downloads/'+target.name,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'size':target.stat().st_size,'releasedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'releaseNotes':'Сигналы ФБО и актуализация короба с ТСД.'}
 (dest/'logoff-tsd.json').write_text(json.dumps(meta,ensure_ascii=False));target.with_suffix('.apk.idsig').unlink(missing_ok=True)
 (ROOT/'signed-proof.json').write_text(json.dumps({'certificate':cert,'payloadUnchanged':True,**meta}))

def stage():
 check();sign();v={'base':BASE,'images':{},'hashes':{}}
 for k in BASE:
  ctx=ROOT/(k+'-payload');expected={p.relative_to(ctx).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in ctx.rglob('*') if p.is_file()};assert set(expected)==ALLOWED[k]
  df=ROOT/('Dockerfile.'+k);df.write_text('FROM '+BASE[k]+'\nCOPY '+k+'-payload/ '+ROOTS[k]+( '\nENV WMS_FBO_EXCEL_PICK_CHECK_ENABLED=true' if k=='api' else '')+'\n');tag='logoff-'+k+':fbo-deficit-release-20261101'
  subprocess.run(['docker','build','--network','none','-f',str(df),'-t',tag,str(ROOT)],check=True)
  img=d('image','inspect',tag,'--format','{{.Id}}');before,after=hashes(BASE[k],k),hashes(img,k)
  assert set(before)<=set(after) and {n for n in after if before.get(n)!=after[n]}==ALLOWED[k]
  assert all(after[n]==h for n,h in expected.items());v['images'][k]=img;v['hashes'][k]=expected
 (ROOT/'verification.json').write_text(json.dumps(v));print(json.dumps(v))
def get(p):return urllib.request.urlopen('https://wms.logoff.pro/'+p,timeout=30).read()
def publish():
 locks=[]
 for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 check();v=json.loads((ROOT/'verification.json').read_text());pr=json.loads((ROOT/'pr.json').read_text());tests=json.loads((ROOT/'tests.json').read_text())
 assert pr['state']=='MERGED' and pr['headRefName']=='fix/fbo-client-deficit-actions' and pr['baseRefName']=='feature/wb-print-check'
 assert tests['api']>=4233 and tests['web']>=587 and tests['typecheck']
 assert json.loads((ROOT/'browser-proof.json').read_text())['passed']>=3
 isolated=json.loads((ROOT/'isolated-proof.json').read_text())
 assert isolated['postgres']>=8 and isolated['image']==v['images']['api'] and isolated['fullApiHealth']
 assert v['base']==BASE
 bootstrap=json.loads((ROOT/'bootstrap-proof.json').read_text());assert bootstrap['passed']==5 and not bootstrap['errors'] and not bootstrap['warnings']
 assert all(len(c['boots'])==1 for c in bootstrap['checks'])
 assert not (ROOT/'published.json').exists()
 for k in BASE:assert all(hashes(v['images'][k],k)[n]==h for n,h in v['hashes'][k].items())
 oldenv=set(json.loads(d('inspect','infra-api-1'))[0]['Config']['Env']);envhash=hashlib.sha256((APP/'.env').read_bytes()).hexdigest()
 others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n not in ['infra-api-1','infra-web-1']}
 for k in BASE:d('tag',BASE[k],'logoff-'+k+':before-fbo-deficit-release-20261101')
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
  assert set(json.loads(d('inspect','infra-api-1'))[0]['Config']['Env'])==(oldenv|{'WMS_FBO_EXCEL_PICK_CHECK_ENABLED=true'})
  for n,h in v['hashes']['web'].items():assert hashlib.sha256(get(n if n!='index.html' else '?wb-fbo-tracking='+str(pr['number']))).hexdigest()==h
  assert all(d('inspect',n,'--format','{{.Id}}')==ident for n,ident in others.items())
  assert hashlib.sha256((APP/'.env').read_bytes()).hexdigest()==envhash
 except Exception:switch(BASE);raise
 v.update(published=True,pr=pr['number'],at=time.time(),otherContainersUnchanged=True,existingEnvironmentPreserved=True)
 (ROOT/'published.json').write_text(json.dumps(v));print('Published and verified')
if __name__=='__main__':publish() if sys.argv[-1]=='publish' else stage()
