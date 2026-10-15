from pathlib import Path
import subprocess,json,fcntl,hashlib,urllib.request,time
r=Path('/opt/logoff-wms/wms/work/fbs-polling-20261015');app=Path('/opt/logoff-wms/wms');locks=[]
for n in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
 f=open(n,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def get(n):
 for attempt in range(20):
  try:return urllib.request.urlopen('https://wms.logoff.pro/'+n,timeout=15).read()
  except Exception:
   if attempt==19:raise
   time.sleep(2)
def switch(image):
 d('tag',image,'infra-web:latest')
 subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','--timeout','30','web'],check=True)
v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text())
assert v['passed'] and pr['merged'] and not (r/'published.json').exists()
assert all(d('inspect',n,'--format','{{.Image}}')==image for n,image in v['base'].items())
others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='infra-web-1'}
env=(app/'.env').read_bytes();apk=get('downloads/logoff-tsd.json');d('tag',v['base']['infra-web-1'],'logoff-web:before-fbs-polling-20261015')
try:
 switch(v['candidate']);assert json.loads(get('api/v1/health'))['status']=='ok'
 for n,h in v['hashes'].items():assert hashlib.sha256(get(n)).hexdigest()==h,n
 assert get('downloads/logoff-tsd.json')==apk and (app/'.env').read_bytes()==env
 assert all(d('inspect',n,'--format','{{.Id}}')==id for n,id in others.items())
except Exception:
 switch(v['base']['infra-web-1']);raise
out={'published':True,'at':time.time(),'web':v['candidate'],'api':v['base']['infra-api-1'],'pr':pr['number'],'otherContainersUnchanged':True,'apkUnchanged':True}
(r/'published.json').write_text(json.dumps(out));print(json.dumps(out))
