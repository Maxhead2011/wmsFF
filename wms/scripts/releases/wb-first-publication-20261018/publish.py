from pathlib import Path
import subprocess,json,fcntl,time,urllib.request
r=Path('/opt/logoff-wms/wms/work/wb-first-publication-20261018');app=Path('/opt/logoff-wms/wms');locks=[]
for n in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
 f=open(n,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def get(n):
 for i in range(20):
  try:return urllib.request.urlopen('https://wms.logoff.pro/'+n,timeout=15).read()
  except Exception:
   if i==19:raise
   time.sleep(2)
def flags():return json.loads(d('exec','infra-api-1','node','-e',"console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k,v])=>k.startsWith('WMS_')&&['true','false'].includes(v)))))"))
def switch(image):
 d('tag',image,'infra-api:latest');subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','--timeout','30','api'],check=True)
v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());assert v['passed'] and pr['merged'] and not (r/'published.json').exists()
assert all(d('inspect',n,'--format','{{.Image}}')==image for n,image in v['base'].items())
others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='infra-api-1'}
env=(app/'.env').read_bytes();oldflags=flags();apk=get('downloads/logoff-tsd.json');d('tag',v['base']['infra-api-1'],'logoff-api:before-wb-first-publication-20261018')
try:
 switch(v['candidate']);assert json.loads(get('api/v1/health'))['status']=='ok'
 assert flags()==oldflags
 for n,h in v['hashes'].items():assert d('exec','infra-api-1','sha256sum','/app/apps/api/dist/'+n).split()[0]==h
 assert (app/'.env').read_bytes()==env and get('downloads/logoff-tsd.json')==apk
 assert all(d('inspect',n,'--format','{{.Id}}')==id for n,id in others.items())
except Exception:
 switch(v['base']['infra-api-1']);raise
out={'published':True,'at':time.time(),'api':v['candidate'],'web':v['base']['infra-web-1'],'pr':pr['number'],'flags':flags(),'otherContainersUnchanged':True,'apkUnchanged':True}
(r/'published.json').write_text(json.dumps(out));print(json.dumps(out))
