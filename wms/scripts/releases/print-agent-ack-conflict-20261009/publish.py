"""Publish only the tested agent download after a merged PR, with release locks and rollback."""
from pathlib import Path
import subprocess,json,fcntl,hashlib,urllib.request,urllib.error,time
r=Path('/opt/logoff-wms/wms/work/print-agent-ack-conflict-20261009');app=Path('/opt/logoff-wms/wms');locks=[]
for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
 f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def get(name):
 for attempt in range(10):
  try:return urllib.request.urlopen('https://wms.logoff.pro/'+name,timeout=15).read()
  except urllib.error.HTTPError as e:
   if e.code not in [502,503,504] or attempt==9:raise
   time.sleep(2)
def switch(image):
 d('tag',image,'infra-web:latest')
 subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','--timeout','30','web'],check=True)
v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());assert v['passed'] and pr['merged'];assert not (r/'published.json').exists()
assert d('inspect','infra-web-1','--format','{{.Image}}')==v['base']
assert d('inspect','infra-api-1','--format','{{.Image}}')==v['api']
others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='infra-web-1'}
envHash=hashlib.sha256((app/'.env').read_bytes()).hexdigest();apk=get('downloads/logoff-tsd.json');index=get('')
d('tag',v['base'],'logoff-web:before-print-agent-ack-conflict-20261009')
try:
 switch(v['candidate'])
 assert json.loads(get('api/v1/health'))['status']=='ok'
 assert hashlib.sha256(get('downloads/LOGOFF-FBS-Print-Agent.zip')).hexdigest()==v['packageSha256']
 assert get('')==index and get('downloads/logoff-tsd.json')==apk
 assert hashlib.sha256((app/'.env').read_bytes()).hexdigest()==envHash
 assert all(d('inspect',n,'--format','{{.Id}}')==i for n,i in others.items())
except Exception:
 switch(v['base']);raise
out={'published':True,'at':time.time(),'pr':pr['number'],'web':v['candidate'],'webBase':v['base'],'api':v['api'],'packageSha256':v['packageSha256'],'changed':v['changed'],'apiAndOtherContainersUnchanged':True,'apkAndConfigurationUnchanged':True,'installedOnPrintingComputer':False}
(r/'published.json').write_text(json.dumps(out,indent=2));print(json.dumps(out))
