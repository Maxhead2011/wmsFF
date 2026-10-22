from pathlib import Path
import subprocess,json,fcntl,urllib.request,time
r=Path('/opt/logoff-wms/wms/work/receipt-date-fast-20261020');app=Path('/opt/logoff-wms/wms');locks=[]
for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock']:
 f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
def d(*args):return subprocess.check_output(['docker',*args],text=True).strip()
def switch(image):
 d('tag',image,'infra-api:latest');subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','--timeout','30','api'],check=True)
def flags():return json.loads(d('exec','infra-api-1','node','-e',"console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k,v])=>k.startsWith('WMS_')&&['true','false'].includes(v)))))"))
v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());assert v['passed'] and v['proof']['passed'] and pr['merged'];assert not (r/'published.json').exists()
assert d('inspect','infra-api-1','--format','{{.Image}}')==v['base'];assert d('inspect','infra-web-1','--format','{{.Image}}')==v['web']
others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='infra-api-1'};env=(app/'.env').read_bytes();oldflags=flags();d('tag',v['base'],'logoff-api:before-receipt-date-fast-20261020')
try:
 switch(v['candidate'])
 for attempt in range(20):
  try:
   assert json.loads(urllib.request.urlopen('https://wms.logoff.pro/api/v1/health',timeout=15).read())['status']=='ok';break
  except Exception:
   if attempt==19:raise
   time.sleep(2)
 for n in v['changed']:assert d('exec','infra-api-1','sha256sum','/app/apps/api/dist/'+n).split()[0]==v['hashes'][n]
 assert flags()==oldflags
 assert (app/'.env').read_bytes()==env and all(d('inspect',n,'--format','{{.Id}}')==i for n,i in others.items())
except Exception:
 switch(v['base']);raise
out={'published':True,'at':time.time(),'pr':pr['number'],'api':v['candidate'],'web':v['web'],'base':v['base'],'apk':233,'flags':flags(),'proof':v['proof'],'otherContainersUnchanged':True,'stockMutationByPublisher':False}
(r/'published.json').write_text(json.dumps(out,indent=2));print(json.dumps({'published':True,'api':out['api']}))
