from pathlib import Path
import subprocess,json,fcntl,time,urllib.request,hashlib
r=Path('/opt/logoff-wms/wms/work/sorting-cancel-20261019');app=Path('/opt/logoff-wms/wms');locks=[]
for n in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
 f=open(n,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def get(n):
 for i in range(15):
  try:return urllib.request.urlopen('https://wms.logoff.pro/'+n,timeout=15).read()
  except Exception:
   if i==14:raise
   time.sleep(2)
def switch(api,web):
 d('tag',api,'infra-api:latest');d('tag',web,'infra-web:latest');subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','--timeout','30','api','web'],check=True)
v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());assert pr['merged'] and not (r/'published.json').exists();assert all(d('inspect',n,'--format','{{.Image}}')==i for n,i in v['base'].items())
env=(app/'.env').read_bytes();apk=get('downloads/logoff-tsd.json');others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n not in v['base']}
for kind in ['api','web']:d('tag',v['base']['infra-'+kind+'-1'],'logoff-'+kind+':before-sorting-cancel-20261019')
try:
 switch(v['api'],v['web']);assert json.loads(get('api/v1/health'))['status']=='ok'
 for kind,root in [('api','/app/apps/api/dist/'),('web','/usr/share/nginx/html/')]:
  for n,h in v[kind+'Hashes'].items():assert d('exec','infra-'+kind+'-1','sha256sum',root+n).split()[0]==h
 for n,h in v['webHashes'].items():assert hashlib.sha256(get(n if n!='index.html' else '?sorting-cancel=20261019')).hexdigest()==h
 assert (app/'.env').read_bytes()==env and get('downloads/logoff-tsd.json')==apk;assert all(d('inspect',n,'--format','{{.Id}}')==i for n,i in others.items())
except Exception:
 switch(v['base']['infra-api-1'],v['base']['infra-web-1']);raise
out={'published':True,'at':time.time(),'api':v['api'],'web':v['web'],'pr':pr['number'],'configurationUnchanged':True,'apkUnchanged':True,'otherContainersUnchanged':True,'rollback':{'api':'logoff-api:before-sorting-cancel-20261019','web':'logoff-web:before-sorting-cancel-20261019'}};(r/'published.json').write_text(json.dumps(out));print(json.dumps(out))
