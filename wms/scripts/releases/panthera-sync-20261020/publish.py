from pathlib import Path
import subprocess,json,fcntl,time,urllib.request,hashlib
r=Path('/opt/logoff-wms/wms/work/panthera-sync-20261020');app=Path('/opt/logoff-wms/wms');locks=[]
for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
 f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
def d(*args):return subprocess.check_output(['docker',*args],text=True).strip()
v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text())
assert pr['merged'] and v['proof']['passed'] and not (r/'published.json').exists()
assert d('inspect','infra-api-1','--format','{{.Image}}')==v['baseApi']
assert d('inspect','infra-web-1','--format','{{.Image}}')==v['baseWeb']
env=(app/'.env').read_bytes();others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n not in ['infra-api-1','infra-web-1']}
def switch(kind,image):
 d('tag',image,'infra-'+kind+':latest')
 subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','--timeout','30',kind],check=True)
for kind,key in [('api','baseApi'),('web','baseWeb')]:d('tag',v[key],'logoff-'+kind+':before-panthera-sync-20261020')
try:
 switch('api',v['api']['image'])
 for attempt in range(20):
  try:
   assert json.loads(urllib.request.urlopen('https://wms.logoff.pro/api/v1/health',timeout=10).read())['status']=='ok';break
  except Exception:
   if attempt==19:raise
   time.sleep(2)
 for name,h in v['api']['hashes'].items():assert d('exec','infra-api-1','sha256sum','/app/apps/api/dist/'+name).split()[0]==h
 switch('web',v['web']['image'])
 for name,h in v['web']['hashes'].items():
  for attempt in range(10):
   try:
    data=urllib.request.urlopen('https://wms.logoff.pro/'+(name if name!='index.html' else '?release=panthera-sync-20261020'),timeout=15).read()
    assert hashlib.sha256(data).hexdigest()==h;break
   except Exception:
    if attempt==9:raise
    time.sleep(1)
 assert (app/'.env').read_bytes()==env and all(d('inspect',n,'--format','{{.Id}}')==old for n,old in others.items())
except Exception:
 switch('web',v['baseWeb']);switch('api',v['baseApi']);raise
out={'published':True,'pr':pr['number'],'api':v['api']['image'],'web':v['web']['image'],'otherContainersUnchanged':True,'configUnchanged':True}
(r/'published.json').write_text(json.dumps(out));print(json.dumps(out))
