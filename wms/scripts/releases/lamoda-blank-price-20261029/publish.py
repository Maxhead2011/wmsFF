"""FIX: exact own-WMS overlay, unchanged schema, locked release and image rollback."""
from pathlib import Path
import subprocess,json,hashlib,sys,fcntl,time,urllib.request,os,re,zipfile,datetime,uuid
r=Path('/opt/logoff-wms/wms/work/lamoda-blank-price-20261029');app=Path('/opt/logoff-wms/wms')
base={'api':'sha256:f33531eec9e46367f3ca2b131201ac9ee781bf1288afdd41abe0166c04aa5688','web':'sha256:27b0d707b39797cbe0763e7c453cde8a10933da497d68b7e2d02081239467036'}
roots={'api':'/app/apps/api/dist/','web':'/usr/share/nginx/html/'}
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def check():
 for k,v in base.items():assert d('inspect','infra-'+k+'-1','--format','{{.Image}}')==v,'Server changed: '+k
def hashes(image,kind):return {line.split(maxsplit=1)[1].removeprefix(roots[kind]):line.split()[0] for line in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find '+roots[kind]+' -type f -exec sha256sum {} +').splitlines()}
def get(name):
 for i in range(30):
  try:return urllib.request.urlopen('https://wms.logoff.pro/'+name,timeout=15).read()
  except Exception:
   if i==29:raise
   time.sleep(1)
def publish():
 locks=[]
 for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 check();v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());assert pr['state']=='MERGED' and pr['headRefName']=='feature/lamoda-blank-price-template';assert not (r/'published.json').exists()
 db=json.loads((r/'db-proof.json').read_text());browser=json.loads((r/'browser-proof.json').read_text());assert db['passed']>=10 and db['fullApiHealth'] and browser['passed']>=9 and browser['isolatedApi']
 v['hashes']={}
 for kind in base:
  before,after=hashes(base[kind],kind),hashes(v['images'][kind],kind)
  expected={p.relative_to(r/kind/'payload').as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in (r/kind/'payload').rglob('*') if p.is_file()}
  assert set(before)<=set(after) and {n for n in after if before.get(n)!=after[n]}==set(expected)
  assert all(after[n]==h for n,h in expected.items());v['hashes'][kind]=expected
 os.umask(0o077);others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n not in ['infra-api-1','infra-web-1']}
 for k in base:d('tag',base[k],'logoff-'+k+':before-lamoda-blank-price-20261029')
 def switch(images):
  for k,img in images.items():d('tag',img,'infra-'+k+':latest')
  subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','api','web'],check=True)
 try:
  switch(v['images']);assert json.loads(get('api/v1/health'))['status']=='ok'
  for kind in base:assert d('inspect','infra-'+kind+'-1','--format','{{.Image}}')==v['images'][kind]
  for n,h in v['hashes']['web'].items():assert hashlib.sha256(get(n if n!='index.html' else '?lamoda-fbo='+str(pr['number']))).hexdigest()==h
  assert all(d('inspect',n,'--format','{{.Id}}')==x for n,x in others.items())
 except Exception:switch(base);raise
 v.update(published=True,pr=pr['number'],at=time.time(),otherContainersUnchanged=True,dbProof=db,browserProof=browser);(r/'published.json').write_text(json.dumps(v));print('Published; health, public hashes and isolation verified')
if __name__=='__main__':publish()
