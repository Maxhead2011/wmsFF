from pathlib import Path
import subprocess,json,fcntl,time,urllib.request,urllib.error
r=Path('/opt/logoff-wms/wms/work/receipt-admin-20261009');app=Path('/opt/logoff-wms/wms');locks=[]
for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
 f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def switch(image):
 d('tag',image,'infra-api:latest');subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','--timeout','30','api'],check=True)
v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());assert v['passed'] and pr['merged'];assert not (r/'published.json').exists();assert d('inspect','infra-api-1','--format','{{.Image}}')==v['base'] and d('inspect','infra-web-1','--format','{{.Image}}')==v['web']
others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='infra-api-1'};env=(app/'.env').read_bytes();d('tag',v['base'],'logoff-api:before-receipt-admin-20261009')
try:
 switch(v['candidate'])
 for i in range(20):
  try:
   assert json.load(urllib.request.urlopen('https://wms.logoff.pro/api/v1/health',timeout=10))['status']=='ok';break
  except Exception:
   if i==19:raise
   time.sleep(2)
 for n in v['changed']:assert d('exec','infra-api-1','sha256sum','/app/apps/api/dist/'+n).split()[0]==v['hashes'][n]
 assert (app/'.env').read_bytes()==env and all(d('inspect',n,'--format','{{.Id}}')==i for n,i in others.items())
except Exception:
 switch(v['base']);raise
out={'published':True,'at':time.time(),'pr':pr['number'],'api':v['candidate'],'web':v['web'],'base':v['base'],'flagsUnchanged':True,'otherContainersUnchanged':True,'businessRecordsChanged':False,'proof':v['proof']};(r/'published.json').write_text(json.dumps(out));print(json.dumps(out))
