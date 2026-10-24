"""Stage and publish an exact catalog overlay on our WMS only."""
from pathlib import Path
import subprocess,json,fcntl,hashlib,urllib.request,time,sys
r=Path('/opt/logoff-wms/wms/work/catalog-overview-20261024');app=Path('/opt/logoff-wms/wms')
base={'api':'sha256:6c684dd449ec2fed17aeece99b2d81d2af314cac3ee057103a0094f18556cd1c','web':'sha256:7d080d9153aa1b43d765946c35764872788be6f7a3e09420741c55361b3231ec'}
roots={'api':'/app/apps/api/dist/','web':'/usr/share/nginx/html/'}
tags={k:'logoff-'+k+':catalog-overview-20261024' for k in base}
def d(*args):return subprocess.check_output(['docker',*args],text=True).strip()
def check():
 for k,v in base.items():assert d('inspect','infra-'+k+'-1','--format','{{.Image}}')==v,'New deployment: '+k
def hashes(image,kind):
 return {line.split(maxsplit=1)[1].removeprefix(roots[kind]):line.split()[0] for line in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find '+roots[kind]+' -type f -exec sha256sum {} +').splitlines()}
def get(name):
 for attempt in range(20):
  try:return urllib.request.urlopen('https://wms.logoff.pro/'+name,timeout=15).read()
  except Exception:
   if attempt==19:raise
   time.sleep(1)
def stage():
 check();proof=json.loads((r/'browser-proof.json').read_text());assert proof['passed']==6 and proof['isolatedApi']
 result={'base':base,'images':{},'hashes':{},'browser':proof}
 for kind in base:
  root=r/kind;(root/'Dockerfile').write_text('FROM '+base[kind]+'\nCOPY payload/ '+roots[kind]+'\n')
  subprocess.run(['docker','build','--network','none','-t',tags[kind],str(root)],check=True)
  image=d('image','inspect',tags[kind],'--format','{{.Id}}');before,after=hashes(base[kind],kind),hashes(image,kind)
  expected=json.loads((r/(kind+'-hashes.json')).read_text());assert set(before)<=set(after)
  assert {n for n in after if before.get(n)!=after[n]}==set(expected)
  assert all(after[n]==h for n,h in expected.items());result['images'][kind]=image;result['hashes'][kind]=expected
 runtime=subprocess.check_output(['docker','run','--rm','-i','-w','/app/apps/api','--network','none','--entrypoint','node',result['images']['api']],input=(r/'runtime-test.cjs').read_bytes()).decode();print(runtime);assert json.loads(runtime)['passed']==8;result['runtime']=json.loads(runtime)
 (r/'verification.json').write_text(json.dumps(result));print(json.dumps(result['images']))
def publish():
 locks=[]
 for p in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  h=open(p,'a');fcntl.flock(h,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(h)
 check();result=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());assert pr['state']=='MERGED' and pr['number']==685
 assert not (r/'published.json').exists();env=(app/'.env').read_bytes();apk=get('downloads/logoff-tsd.json')
 others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n not in ['infra-api-1','infra-web-1']}
 for kind in base:
  assert d('image','inspect',tags[kind],'--format','{{.Id}}')==result['images'][kind]
  d('tag',base[kind],'logoff-'+kind+':before-catalog-overview-20261024')
 def switch(images):
  for k,img in images.items():d('tag',img,'infra-'+k+':latest')
  subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','api','web'],check=True)
 try:
  switch(result['images']);assert json.loads(get('api/v1/health'))['status']=='ok'
  for k in base:
   assert d('inspect','infra-'+k+'-1','--format','{{.Image}}')==result['images'][k]
   actual=hashes(result['images'][k],k);assert all(actual[n]==v for n,v in result['hashes'][k].items())
  for name,h in result['hashes']['web'].items():assert hashlib.sha256(get(name if name!='index.html' else '?catalog-release=685')).hexdigest()==h
  assert env==(app/'.env').read_bytes() and apk==get('downloads/logoff-tsd.json')
  assert all(d('inspect',n,'--format','{{.Id}}')==v for n,v in others.items())
 except Exception:
  switch(base);raise
 (r/'published.json').write_text(json.dumps(dict(result,published=True,pr=685,at=time.time(),otherContainersUnchanged=True,apkUnchanged=True,businessRecordsChanged=False)));print('Published PR685; health and exact hashes passed')
if __name__=='__main__':
 if sys.argv[-1]=='publish':publish()
 else:stage()
