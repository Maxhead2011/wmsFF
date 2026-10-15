from pathlib import Path
import subprocess,json,fcntl,hashlib,urllib.request,time
r=Path('/opt/logoff-wms/wms/work/ozon-reopen-233');app=Path('/opt/logoff-wms/wms');locks=[]
for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
 f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
def d(*args):return subprocess.check_output(['docker',*args],text=True).strip()
def get(name):
 for attempt in range(20):
  try:return urllib.request.urlopen('https://wms.logoff.pro/'+name,timeout=20).read()
  except Exception:
   if attempt==19:raise
   time.sleep(2)
def switch(service,image):
 d('tag',image,'infra-'+service+':latest');subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','--timeout','30',service],check=True)
def flags():return json.loads(d('exec','infra-api-1','node','-e',"console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k,v])=>k.startsWith('WMS_')&&['true','false'].includes(v)))))"))
v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());assert v['passed'] and v['proof']['passed'] and pr['merged'];assert not (r/'published.json').exists()
assert d('inspect','infra-web-1','--format','{{.Image}}')==v['base'];assert d('inspect','infra-api-1','--format','{{.Image}}')==v['api']
others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n not in ['infra-api-1','infra-web-1']};env=(app/'.env').read_bytes();oldflags=flags()
d('tag',v['base'],'logoff-web:before-ozon-reopen-233');d('tag',v['api'],'logoff-api:before-ozon-reopen-233')
try:
 switch('api',v['apiCandidate']);assert json.loads(get('api/v1/health'))['status']=='ok'
 switch('web',v['candidate']);assert json.loads(get('api/v1/health'))['status']=='ok'
 for n in v['changed']:assert hashlib.sha256(get(n)).hexdigest()==v['hashes'][n]
 for n in v['apiChanged']:assert d('exec','infra-api-1','sha256sum','/app/apps/api/dist/'+n).split()[0]==v['apiHashes'][n]
 assert all(d('inspect',n,'--format','{{.Id}}')==i for n,i in others.items());assert (app/'.env').read_bytes()==env
 assert flags()=={**oldflags,'WMS_OZON_REOPEN_BOX_ENABLED':'true'}
except Exception:
 switch('web',v['base']);switch('api',v['api']);raise
out={'published':True,'at':time.time(),'pr':pr['number'],'api':v['apiCandidate'],'web':v['candidate'],'base':v['api'],'webBase':v['base'],'apk':v['apk'],'flags':flags(),'proof':v['proof'],'otherContainersUnchanged':True,'businessRecordsChanged':False}
(r/'published.json').write_text(json.dumps(out,indent=2));print(json.dumps({'published':True,'api':out['api'],'web':out['web'],'apk':233}))
