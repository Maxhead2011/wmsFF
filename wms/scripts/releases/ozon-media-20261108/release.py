"""FIX: guarded exact-runtime release; no schema changes or business mutations."""
from pathlib import Path
import subprocess, json, fcntl, hashlib, sys, time
R=Path(sys.argv[1]); C=Path('/opt/wms-restore/compose.json')
BASE={'api':'sha256:0f49b1a75a845ba606ac17ee6c8424e38944aa881c01323897a5a8a9cbf7ecea','web':'sha256:30733c98a48b18636294570901654635d28d56ca8c55508502febed48ad99480'}
PREFIX={'api':'/app/apps/api/dist/','web':'/usr/share/nginx/html/'}
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def sha(b):return hashlib.sha256(b).hexdigest()

def env_hash(raw):
 # FIX: Docker may reorder environment entries when recreating an identical configuration.
 entries=json.loads(raw);keys=[x.split('=',1)[0] for x in entries]
 assert len(keys)==len(set(keys)), 'Duplicate environment keys'
 return sha(json.dumps(sorted(entries),ensure_ascii=False).encode())
def files(img,service):return {n:h for h,n in (l.split(None,1) for l in d('run','--rm','--network','none','--entrypoint','sh',img,'-c','find '+PREFIX[service]+' -type f -exec sha256sum {} +').splitlines())}
def current(service):return d('inspect','wms-local-'+service,'--format','{{.Image}}')
def health():
 for i in range(35):
  p=subprocess.run(['docker','exec','wms-local-api','node','-e',"fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{if(!r.ok||(await r.json()).status!=='ok')throw Error()}).catch(()=>process.exit(1))"],capture_output=True)
  if p.returncode==0:return
  time.sleep(1)
 raise RuntimeError('API health failed')
if sys.argv[-1]=='stage':
 assert all(current(k)==v for k,v in BASE.items())
 assert json.loads((R/'runtime-api-proof.json').read_text())['passed']==12
 assert json.loads((R/'runtime-browser-proof.json').read_text())['passed']==3
 result={'base':BASE,'images':{},'hashes':{},'composeHash':sha(C.read_bytes())}
 for service in BASE:
  (R/('Dockerfile.'+service)).write_text('FROM '+BASE[service]+'\nCOPY '+service+'-payload/ '+PREFIX[service]+'\n')
  tag='wms-local-'+service+':ozon-media-20261108'
  d('build','--network','none','-q','-f',str(R/('Dockerfile.'+service)),'-t',tag,str(R));image=d('image','inspect',tag,'--format','{{.Id}}')
  a,b=files(BASE[service],service),files(image,service);expected={PREFIX[service]+n for n in json.loads((R/(service+'-changes.json')).read_text())}
  assert set(a)<=set(b);assert {n for n in b if a.get(n)!=b[n]}==expected
  result['images'][service]=image;result['hashes'][service]={n:b[n] for n in expected}
 (R/'stage.json').write_text(json.dumps(result));print('Stage verified: API3/web3, all other files preserved')
else:
 locks=[]
 for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  Path(name).parent.mkdir(parents=True,exist_ok=True);f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 v=json.loads((R/'stage.json').read_text());pr=json.loads((R/'pr.json').read_text())
 assert pr['state']=='MERGED' and pr['baseRefName']=='feature/la_panthera' and pr['headRefName']=='fix/ozon-label-proportions'
 assert json.loads((R/'isolated-proof.json').read_text())['fullApiHealth']
 assert all(current(k)==b for k,b in BASE.items());assert sha(C.read_bytes())==v['composeHash']
 old=C.read_bytes();(R/'compose.before.json').write_bytes(old)
 other={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n not in ['wms-local-api','wms-local-web']}
 env={s:env_hash(d('inspect','wms-local-'+s,'--format','{{json .Config.Env}}')) for s in BASE}
 config=json.loads(old)
 def start(service):d('compose','-f',str(C),'up','-d','--no-deps','--no-build','--pull','never',service)
 try:
  config['services']['api']['image']=v['images']['api'];C.write_text(json.dumps(config,indent=2));start('api');health()
  config['services']['web']['image']=v['images']['web'];C.write_text(json.dumps(config,indent=2));start('web')
  d('exec','wms-local-web','wget','-qO-','http://127.0.0.1/')
  for service in BASE:
   assert current(service)==v['images'][service]
   assert env_hash(d('inspect','wms-local-'+service,'--format','{{json .Config.Env}}'))==env[service]
   for n,h in v['hashes'][service].items():assert d('exec','wms-local-'+service,'sha256sum',n).split()[0]==h
  assert all(d('inspect',n,'--format','{{.Id}}')==i for n,i in other.items())
 except Exception:
  C.write_bytes(old);start('api');start('web');health();raise
 (R/'published.json').write_text(json.dumps({'pr':pr['number'],'health':True,'otherContainersUnchanged':True,'environmentUnchanged':True,**v}));print('Published: API health, hashes, environment and other containers verified')
