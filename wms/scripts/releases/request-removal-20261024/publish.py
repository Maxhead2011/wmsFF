from pathlib import Path
import subprocess,json,fcntl,urllib.request,hashlib,time
r=Path('/opt/logoff-wms/wms/work/request-removal-20261024-v2');app=Path('/opt/logoff-wms/wms')
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
locks=[]
for n in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
 f=open(n,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());assert pr['merged'];assert not (r/'published.json').exists();assert all(d('inspect',n,'--format','{{.Image}}')==i for n,i in v['base'].items())
assert json.loads((r/'db-proof.json').read_text())['passed']==9
assert json.loads((r/'browser-proof.json').read_text())['passed']==8
env=(app/'.env').read_bytes();others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n not in v['base']}
for kind in ['api','web']:d('tag',v['base']['infra-'+kind+'-1'],'logoff-'+kind+':before-request-removal-20261024-v2')
def switch(api,web):
 d('tag',api,'infra-api:latest');d('tag',web,'infra-web:latest');subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','api','web'],check=True)
try:
 switch(v['api'],v['web'])
 for attempt in range(45):
  try:
   assert urllib.request.urlopen('https://wms.logoff.pro/api/v1/health',timeout=10).status==200;break
  except Exception:
   if attempt==44:raise
   time.sleep(2)
 for n,h in v['webHashes'].items():
  data=urllib.request.urlopen('https://wms.logoff.pro/'+(n if n!='index.html' else '?request-removal=20261024'),timeout=20).read();assert hashlib.sha256(data).hexdigest()==h
 for n,h in v['apiHashes'].items():assert d('exec','infra-api-1','sha256sum','/app/apps/api/dist/'+n).split()[0]==h
 assert (app/'.env').read_bytes()==env;assert all(d('inspect',n,'--format','{{.Id}}')==i for n,i in others.items())
except Exception:
 switch(v['base']['infra-api-1'],v['base']['infra-web-1']);raise
out={'published':True,'at':time.time(),'api':v['api'],'web':v['web'],'pr':pr['number'],'otherContainersUnchanged':True};(r/'published.json').write_text(json.dumps(out));print(json.dumps(out))
