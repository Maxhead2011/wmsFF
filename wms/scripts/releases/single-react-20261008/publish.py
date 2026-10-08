import pathlib,json,subprocess,fcntl,time,urllib.request,urllib.error,hashlib
r=pathlib.Path('/opt/logoff-wms/wms/work/soul-runtime-fix-20261008');app=pathlib.Path('/opt/logoff-wms/wms');locks=[]
for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
 f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def get(n):
 for attempt in range(15):
  try:return urllib.request.urlopen('https://wms.logoff.pro/'+n,timeout=15).read()
  except urllib.error.HTTPError as e:
   if e.code not in [502,503,504] or attempt==14:raise
   time.sleep(2)
def switch(image):
 d('tag',image,'infra-web:latest');subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','--timeout','30','web'],check=True)
v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());assert v['passed'] and pr['merged'];assert d('inspect','infra-web-1','--format','{{.Image}}')==v['base']
assert not (r/'published.json').exists()
others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='infra-web-1'};apk=get('downloads/logoff-tsd.json');env=(app/'.env').read_bytes()
d('tag',v['base'],'logoff-web:before-single-react-20261008')
try:
 switch(v['candidate'])
 for i in range(15):
  try:assert json.loads(get('api/v1/health'))['status']=='ok';break
  except Exception:
   if i==14:raise
   time.sleep(2)
 for n in json.loads((r/'web-changes.json').read_text()):assert hashlib.sha256(get(n)).hexdigest()==v['hashes'][n],n
 assert all(d('inspect',n,'--format','{{.Id}}')==i for n,i in others.items());assert apk==get('downloads/logoff-tsd.json') and env==(app/'.env').read_bytes()
except Exception:switch(v['base']);raise
out={'published':True,'at':time.time(),'pr':pr['number'],'image':v['candidate'],'base':v['base'],'apiApkFlagsUnchanged':True};(r/'published.json').write_text(json.dumps(out));print(json.dumps(out))
