from pathlib import Path
import subprocess,json,fcntl,urllib.request,time
r=Path('/opt/logoff-wms/wms/work/original-sticker-sorted-20261022');app=Path('/opt/logoff-wms/wms')
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
locks=[]
for n in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
 f=open(n,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());assert pr['merged'];assert v['runtime']['passed']==11;assert not (r/'published.json').exists();assert all(d('inspect',n,'--format','{{.Image}}')==i for n,i in v['base'].items())
others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='infra-api-1'};env=(app/'.env').read_bytes()
d('tag',v['base']['infra-api-1'],'logoff-api:before-original-sticker-sorted-20261022')
def switch(image):
 d('tag',image,'infra-api:latest');subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','api'],check=True)
try:
 switch(v['api'])
 for attempt in range(45):
  try:
   assert urllib.request.urlopen('https://wms.logoff.pro/api/v1/health',timeout=10).status==200;break
  except Exception:
   if attempt==44:raise
   time.sleep(2)
 for n,h in v['apiHashes'].items():assert d('exec','infra-api-1','sha256sum','/app/apps/api/dist/'+n).split()[0]==h
 assert all(d('inspect',n,'--format','{{.Id}}')==i for n,i in others.items());assert (app/'.env').read_bytes()==env
except Exception:
 switch(v['base']['infra-api-1']);raise
out={'published':True,'api':v['api'],'pr':pr['number'],'webAndOthersUnchanged':True};(r/'published.json').write_text(json.dumps(out));print(json.dumps(out))
