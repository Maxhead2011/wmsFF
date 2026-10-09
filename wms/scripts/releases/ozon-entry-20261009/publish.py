from pathlib import Path
import subprocess,json,fcntl,time,hashlib,urllib.request,urllib.error
r=Path('/opt/logoff-wms/wms/work/ozon-entry-20261009');app=Path('/opt/logoff-wms/wms');locks=[]
for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
 f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def get(name):
 for attempt in range(20):
  try:return urllib.request.urlopen('https://wms.logoff.pro/'+name,timeout=15).read()
  except urllib.error.HTTPError as e:
   if e.code not in [502,503,504] or attempt==19:raise
   time.sleep(2)
def switch(service,image):
 d('tag',image,'infra-'+service+':latest');subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','--timeout','30',service],check=True)
def flags():return json.loads(d('exec','infra-api-1','node','-e',"console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k,v])=>k.startsWith('WMS_')&&['true','false'].includes(v)))))"))
v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());assert v['passed'] and pr['merged'];assert not (r/'published.json').exists()
assert d('inspect','infra-api-1','--format','{{.Image}}')==v['base'] and d('inspect','infra-web-1','--format','{{.Image}}')==v['web']['base']
others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n not in ['infra-api-1','infra-web-1']};oldflags=flags();env=(app/'.env').read_bytes();apk=get('downloads/logoff-tsd.json')
d('tag',v['base'],'logoff-api:before-ozon-entry-20261009');d('tag',v['web']['base'],'logoff-web:before-ozon-entry-20261009')
try:
 switch('api',v['candidate']);assert json.loads(get('api/v1/health'))['status']=='ok'
 switch('web',v['web']['candidate']);assert json.loads(get('api/v1/health'))['status']=='ok'
 assert flags()==oldflags and (app/'.env').read_bytes()==env and get('downloads/logoff-tsd.json')==apk
 for n in v['changed']:assert d('exec','infra-api-1','sha256sum','/app/apps/api/dist/'+n).split()[0]==v['hashes'][n]
 for n in v['web']['changed']:assert hashlib.sha256(get(n)).hexdigest()==v['web']['hashes'][n]
 assert all(d('inspect',n,'--format','{{.Id}}')==i for n,i in others.items())
except Exception:
 switch('api',v['base']);switch('web',v['web']['base']);raise
out={'published':True,'at':time.time(),'pr':pr['number'],'api':v['candidate'],'web':v['web']['candidate'],'base':v['base'],'webBase':v['web']['base'],'apk':json.loads(apk),'flags':oldflags,'proof':v['proof'],'otherContainersUnchanged':True,'businessRecordsChanged':False}
(r/'published.json').write_text(json.dumps(out,indent=2));print(json.dumps({'published':True,'api':out['api'],'web':out['web'],'apkUnchanged':True}))
