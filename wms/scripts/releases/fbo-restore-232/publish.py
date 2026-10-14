from pathlib import Path
import subprocess,json,fcntl,hashlib,urllib.request,time
r=Path('/opt/logoff-wms/wms/work/fbo-restore-232');app=Path('/opt/logoff-wms/wms');locks=[]
for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
 f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
def d(*args):return subprocess.check_output(['docker',*args],text=True).strip()
def get(name):
 for attempt in range(15):
  try:return urllib.request.urlopen('https://wms.logoff.pro/'+name,timeout=30).read()
  except Exception:
   if attempt==14:raise
   time.sleep(2)
def switch(image):
 d('tag',image,'infra-web:latest');subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','--timeout','30','web'],check=True)
v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());assert v['passed'] and pr['merged'];assert not (r/'published.json').exists()
assert d('inspect','infra-web-1','--format','{{.Image}}')==v['base'];assert d('inspect','infra-api-1','--format','{{.Image}}')==v['api']
others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='infra-web-1'};env=(app/'.env').read_bytes()
d('tag',v['base'],'logoff-web:before-fbo-restore-232')
try:
 switch(v['candidate']);assert json.loads(get('api/v1/health'))['status']=='ok'
 for n in v['changed']:assert hashlib.sha256(get(n)).hexdigest()==v['hashes'][n]
 assert all(d('inspect',n,'--format','{{.Id}}')==i for n,i in others.items());assert (app/'.env').read_bytes()==env
except Exception:
 switch(v['base']);raise
out={'published':True,'at':time.time(),'pr':pr['number'],'api':v['api'],'web':v['candidate'],'webBase':v['base'],'apk':v['apk'],'otherContainersUnchanged':True,'businessRecordsChanged':False}
(r/'published.json').write_text(json.dumps(out,indent=2));print(json.dumps(out))
