import pathlib,json,subprocess,fcntl,time,urllib.request
r=pathlib.Path('/opt/logoff-wms/wms/work/tsd-receipt-scoped-20261008');app=pathlib.Path('/opt/logoff-wms/wms');locks=[]
for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-api-release.lock']:
 f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def get(n):return urllib.request.urlopen('https://wms.logoff.pro/'+n,timeout=20).read()
def flags():return json.loads(d('exec','infra-api-1','node','-e',"console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k,v])=>k.startsWith('WMS_')&&['true','false'].includes(v)))))"))
def health():
 for i in range(25):
  try:assert json.loads(get('api/v1/health'))['status']=='ok';return
  except Exception:
   if i==24:raise
   time.sleep(2)
def switch(image):
 d('tag',image,'infra-api:latest');subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','--timeout','30','api'],check=True)
v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());old=json.loads((r/'before.json').read_text())
assert v['passed'] and pr['merged'];assert d('inspect','infra-api-1','--format','{{.Image}}')==v['base'];assert flags()==old['flags']
assert not (r/'published.json').exists()
others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='infra-api-1'};apk=get('downloads/logoff-tsd.json');env=(app/'.env').read_bytes()
d('tag',v['base'],'logoff-api:before-tsd-receipt-scoped-20261008')
try:
 switch(v['candidate']);health();assert flags()==old['flags']
 root='/app/apps/api/dist';actual={l.split(maxsplit=1)[1].removeprefix(root+'/'):l.split()[0] for l in d('exec','infra-api-1','sh','-c','find '+root+' -type f -exec sha256sum {} +').splitlines()};assert actual==v['hashes']
 smoke=d('exec','-w','/app/apps/api','-e','CANDIDATE_MODULE=/app/apps/api/dist/modules/warehouse/receipt-channel-policy','infra-api-1','node','-e',(r/'live-smoke.cjs').read_text());assert json.loads(smoke)['passed'];print(smoke)
 assert all(d('inspect',n,'--format','{{.Id}}')==i for n,i in others.items());assert apk==get('downloads/logoff-tsd.json') and env==(app/'.env').read_bytes()
except Exception:switch(v['base']);health();raise
out={'published':True,'at':time.time(),'pr':pr['number'],'apiImage':v['candidate'],'base':v['base'],'webApkFlagsUnchanged':True,'businessRecordsChanged':False,'smoke':json.loads(smoke)};(r/'published.json').write_text(json.dumps(out));print(json.dumps(out))
