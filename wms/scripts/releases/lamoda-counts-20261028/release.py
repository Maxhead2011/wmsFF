"""FIX: publish only verified own-WMS Lamoda modules; lock, image pin and rollback."""
from pathlib import Path
import subprocess,json,hashlib,sys,fcntl,time,urllib.request
r=Path('/opt/logoff-wms/wms/work/lamoda-counts-20261028');app=Path('/opt/logoff-wms/wms')
base={'api':'sha256:d7fa9ae269131c3f3bf7240d6904d3546020962892a4e4ae89291388ee1b3a98','web':'sha256:0ef55e6631c3d61233f0199b7e432239e8ec6a713c8779fa457dc0d40b9f1e3d'}
roots={'api':'/app/apps/api/dist/','web':'/usr/share/nginx/html/'}
allowed={'api':{'modules/client-requests/client-requests.service.js'},'web':{'index.html','assets/lamoda-counts-20261028.js','assets/lamoda-counts-20261028.css'}}
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def check():
 for k,v in base.items():assert d('inspect','infra-'+k+'-1','--format','{{.Image}}')==v,'Release base changed: '+k
def hashes(image,kind):return {line.split(maxsplit=1)[1].removeprefix(roots[kind]):line.split()[0] for line in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find '+roots[kind]+' -type f -exec sha256sum {} +').splitlines()}
def get(name):
 for attempt in range(30):
  try:return urllib.request.urlopen('https://wms.logoff.pro/'+name,timeout=15).read()
  except Exception:
   if attempt==29:raise
   time.sleep(1)
def stage():
 check();result={'base':base,'images':{},'hashes':{}}
 for kind in base:
  ctx=r/kind;expected={p.relative_to(ctx/'payload').as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in (ctx/'payload').rglob('*') if p.is_file()}
  assert set(expected)==allowed[kind]
  (ctx/'Dockerfile').write_text('FROM '+base[kind]+'\nCOPY payload/ '+roots[kind]+'\n');tag='logoff-'+kind+':lamoda-counts-20261028'
  subprocess.run(['docker','build','--network','none','-t',tag,str(ctx)],check=True)
  image=d('image','inspect',tag,'--format','{{.Id}}');before,after=hashes(base[kind],kind),hashes(image,kind)
  assert set(before)<=set(after) and {n for n in after if before.get(n)!=after[n]}==allowed[kind]
  assert all(after[n]==v for n,v in expected.items());result['images'][kind]=image;result['hashes'][kind]=expected
 (r/'verification.json').write_text(json.dumps(result));print(json.dumps(result['images']))
def publish():
 locks=[]
 for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 check();v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text())
 assert pr['state']=='MERGED' and pr['headRefName']=='fix/lamoda-active-card-count';assert not (r/'published.json').exists()
 browser=json.loads((r/'browser-proof.json').read_text());db=json.loads((r/'db-proof.json').read_text())
 assert browser['passed']>=5 and browser['syntheticApi'] and browser['webHashes']==v['hashes']['web']
 assert db['passed']==5 and db['fullApiHealth'] and db['image']==v['images']['api']
 others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n not in ['infra-api-1','infra-web-1']}
 for k in base:d('tag',base[k],'logoff-'+k+':before-lamoda-counts-20261028')
 def switch(images):
  for k,img in images.items():d('tag',img,'infra-'+k+':latest')
  subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','api','web'],check=True)
 try:
  switch(v['images']);assert json.loads(get('api/v1/health'))['status']=='ok'
  for kind in base:assert d('inspect','infra-'+kind+'-1','--format','{{.Image}}')==v['images'][kind]
  for n,h in v['hashes']['web'].items():assert hashlib.sha256(get(n if n!='index.html' else '?lamoda-stock='+str(pr['number']))).hexdigest()==h
  assert all(d('inspect',n,'--format','{{.Id}}')==x for n,x in others.items())
 except Exception:switch(base);raise
 v.update(published=True,pr=pr['number'],at=time.time(),otherContainersUnchanged=True,browserProof=browser,dbProof=db)
 (r/'published.json').write_text(json.dumps(v));print('Published: API health, public hashes and other-container isolation verified')
if __name__=='__main__':publish() if sys.argv[-1]=='publish' else stage()
