from pathlib import Path
import subprocess,json,hashlib,fcntl,urllib.request,sys,time
r=Path('/opt/logoff-wms/wms/work/receipt-startup-20261027');app=Path('/opt/logoff-wms/wms');base='sha256:05192401f34d6e440f481357e8721c18037a8362b97a99349a9c442cf8a56264'
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def check():assert d('inspect','infra-web-1','--format','{{.Image}}')==base
def hashes(img):return {line.split(maxsplit=1)[1]:line.split()[0] for line in d('run','--rm','--network','none','--entrypoint','sh',img,'-c','find /usr/share/nginx/html -type f -exec sha256sum {} +').splitlines()}
def stage():
 check();(r/'Dockerfile').write_text('FROM '+base+'\nCOPY index.html /usr/share/nginx/html/index.html\n')
 subprocess.run(['docker','build','--network','none','-t','logoff-web:receipt-startup-20261027',str(r)],check=True)
 image=d('image','inspect','logoff-web:receipt-startup-20261027','--format','{{.Id}}');before,after=hashes(base),hashes(image)
 assert before.keys()==after.keys();assert [n for n in after if before[n]!=after[n]]==['/usr/share/nginx/html/index.html']
 (r/'verification.json').write_text(json.dumps({'base':base,'image':image,'indexHash':after['/usr/share/nginx/html/index.html']}))
def publish():
 locks=[]
 for path in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  f=open(path,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 check();pr=json.loads((r/'pr.json').read_text());assert pr['state']=='MERGED' and pr['headRefName']=='fix/receipt-startup-entry';v=json.loads((r/'verification.json').read_text());assert not (r/'published.json').exists()
 others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='infra-web-1'};env=(app/'.env').read_bytes();d('tag',base,'logoff-web:before-receipt-startup-20261027')
 def switch(img):
  d('tag',img,'infra-web:latest');subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','web'],check=True)
 try:
  switch(v['image'])
  for attempt in range(20):
   try:
    b=urllib.request.urlopen('https://wms.logoff.pro/?startup=20261027',timeout=10).read();assert hashlib.sha256(b).hexdigest()==v['indexHash'];break
   except Exception:
    if attempt==19:raise
    time.sleep(1)
  assert json.load(urllib.request.urlopen('https://wms.logoff.pro/api/v1/health',timeout=10))['status']=='ok'
  assert env==(app/'.env').read_bytes() and all(d('inspect',n,'--format','{{.Id}}')==i for n,i in others.items())
 except Exception:switch(base);raise
 v.update(published=True,pr=pr['number'],apiUnchanged=True,onlyIndexChanged=True,at=time.time());(r/'published.json').write_text(json.dumps(v));print(json.dumps(v))
if sys.argv[-1]=='publish':publish()
else:stage()
