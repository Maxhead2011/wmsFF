"""FIX: own-WMS web-only delta, pinned PR721 base and rollback; no business writes."""
from pathlib import Path
import subprocess,json,hashlib,fcntl,sys,time,urllib.request
r=Path('/opt/logoff-wms/wms/work/lamoda-layout-20261028');app=Path('/opt/logoff-wms/wms')
base='sha256:c609ee9aa33bb11840adc9de67574082db3972a7e53187b4707f95ecdd33a2bf'
api='sha256:f2edb08d3cb55808622e9d0b9ce9770c8e3924b41db3bc148d48ccb0e051231e'
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def check():
 assert d('inspect','infra-web-1','--format','{{.Image}}')==base
 assert d('inspect','infra-api-1','--format','{{.Image}}')==api
def hashes(image):
 return {line.split(maxsplit=1)[1].removeprefix('/usr/share/nginx/html/'):line.split()[0] for line in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find /usr/share/nginx/html -type f -exec sha256sum {} +').splitlines()}
def get(name):return urllib.request.urlopen('https://wms.logoff.pro/'+name,timeout=20).read()
def stage():
 check();ctx=r/'web';(ctx/'Dockerfile').write_text('FROM '+base+'\nCOPY payload/ /usr/share/nginx/html/\n')
 subprocess.run(['docker','build','--network','none','-t','logoff-web:lamoda-layout-20261028',str(ctx)],check=True)
 image=d('image','inspect','logoff-web:lamoda-layout-20261028','--format','{{.Id}}');before,after=hashes(base),hashes(image)
 expected={p.relative_to(ctx/'payload').as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in (ctx/'payload').rglob('*') if p.is_file()}
 assert set(before)<=set(after);assert {n for n in after if before.get(n)!=after[n]}==set(expected)
 assert all(after[n]==v for n,v in expected.items());assert set(expected)=={'index.html','assets/workspace-lamoda-layout-20261028.js','assets/workspace-lamoda-layout-20261028.css'}
 (r/'verification.json').write_text(json.dumps({'base':base,'image':image,'hashes':expected}));print(image)
def publish():
 locks=[]
 for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 check();assert not (r/'published.json').exists();v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());proof=json.loads((r/'browser-proof.json').read_text())
 assert pr['state']=='MERGED' and pr['headRefName']=='fix/lamoda-ozon-layout';assert proof['passed']>=28 and proof['isolatedApi'];assert proof['webHashes']==v['hashes']
 others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='infra-web-1'}
 d('tag',base,'logoff-web:before-lamoda-layout-20261028')
 def switch(image):
  d('tag',image,'infra-web:latest');subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','web'],check=True)
 try:
  switch(v['image'])
  for attempt in range(15):
   try:
    assert hashlib.sha256(get('?lamoda-inline='+str(pr['number']))).hexdigest()==v['hashes']['index.html'];break
   except Exception:
    if attempt==14:raise
    time.sleep(1)
  for name,value in v['hashes'].items():assert hashlib.sha256(get(name)).hexdigest()==value
  assert json.loads(get('api/v1/health'))['status']=='ok'
  assert all(d('inspect',name,'--format','{{.Id}}')==ident for name,ident in others.items())
 except Exception:switch(base);raise
 v.update(published=True,images={'api':api,'web':v['image']},pr=pr['number'],at=time.time(),otherContainersUnchanged=True,browserProof=proof);(r/'published.json').write_text(json.dumps(v));print('Published: web hashes, API health and unchanged containers verified')
if __name__=='__main__':publish() if sys.argv[-1]=='publish' else stage()
