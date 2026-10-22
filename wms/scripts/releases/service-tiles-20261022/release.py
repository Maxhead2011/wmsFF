from pathlib import Path
import subprocess,json,fcntl,urllib.request,hashlib,time,sys
r=Path('/opt/logoff-wms/wms/work/service-tiles-20261022');app=Path('/opt/logoff-wms/wms');base='sha256:e8da9906ee5d3d5eeda56d91f47af8dfeeb8d530f8b5172bb291933f923b69e4';api='sha256:a44fc2fbb1641fb022ae3902495c3057393d3de737518b7d4cccb33e9ea0ee91'
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def hashes(image):return {l.split(maxsplit=1)[1].removeprefix('/usr/share/nginx/html/'):l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find /usr/share/nginx/html -type f -exec sha256sum {} +').splitlines()}
def stage():
 assert d('inspect','infra-web-1','--format','{{.Image}}')==base and d('inspect','infra-api-1','--format','{{.Image}}')==api
 assert json.loads((r/'proof.json').read_text())['passed']==6
 (r/'web/Dockerfile').write_text('FROM '+base+'\nCOPY payload/ /usr/share/nginx/html/\n');subprocess.run(['docker','build','--network','none','-t','logoff-web:service-tiles-20261022',str(r/'web')],check=True)
 candidate=d('image','inspect','logoff-web:service-tiles-20261022','--format','{{.Id}}');a,b=hashes(base),hashes(candidate);names=json.loads((r/'web-changes.json').read_text());assert set(a)<=set(b);assert {n for n in b if a.get(n)!=b[n]}==set(names);assert all(a[n]==b[n] for n in a if n!='index.html');v={'base':base,'api':api,'web':candidate,'hashes':{n:b[n] for n in names},'oldFilesPreserved':len(a)-1};(r/'verification.json').write_text(json.dumps(v));print(json.dumps({'staged':True,'web':candidate,'changed':len(names)}))
def publish():
 locks=[]
 for n in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  f=open(n,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());assert pr['merged'];assert not (r/'published.json').exists();assert d('inspect','infra-web-1','--format','{{.Image}}')==base and d('inspect','infra-api-1','--format','{{.Image}}')==api
 env=(app/'.env').read_bytes();others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='infra-web-1'};rollback='logoff-web:before-service-tiles-20261022';d('tag',base,rollback)
 def switch(image):
  d('tag',image,'infra-web:latest');subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','web'],check=True)
 try:
  switch(v['web'])
  for n,h in v['hashes'].items():
   for attempt in range(10):
    try:
     data=urllib.request.urlopen('https://wms.logoff.pro/'+(n if n!='index.html' else '?admin-tiles=20261019'),timeout=15).read();assert hashlib.sha256(data).hexdigest()==h;break
    except Exception:
     if attempt==9:raise
     time.sleep(1)
  assert (app/'.env').read_bytes()==env;assert all(d('inspect',n,'--format','{{.Id}}')==i for n,i in others.items())
 except Exception:
  switch(base);raise
 out={'published':True,'at':time.time(),'api':api,'web':v['web'],'pr':pr['number'],'rollback':rollback,'otherContainersUnchanged':True};(r/'published.json').write_text(json.dumps(out));print(json.dumps(out))
if sys.argv[-1]=='publish':publish()
else:stage()
