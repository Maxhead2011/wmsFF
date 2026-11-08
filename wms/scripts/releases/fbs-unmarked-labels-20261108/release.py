"""FIX: guarded API-only overlay; one explicit printing flag, no data/schema changes."""
from pathlib import Path
import subprocess,json,hashlib,sys,time,fcntl
R=Path(sys.argv[1]); C=Path('/opt/wms-restore/compose.json')
BASE='sha256:9ab7e83ff22cb7f0a79de7316a301bc52ff726ed003187c75c93d7177066c297'
WEB='sha256:675d2be1b1f649a0bd2347c23bf56db03f667f425ec18fa32088256a49447e46'
PREFIX='/app/apps/api/dist/'
FLAG='WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED'
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def sha(b):return hashlib.sha256(b).hexdigest()
def current():return d('inspect','wms-local-api','--format','{{.Image}}')
def envhash():return sha(json.dumps(sorted(x for x in json.loads(d('inspect','wms-local-api','--format','{{json .Config.Env}}')) if not x.startswith(FLAG+'='))).encode())
def files(img):return {n:h for h,n in (l.split(None,1) for l in d('run','--rm','--network','none','--entrypoint','sh',img,'-c','find '+PREFIX+' -type f -exec sha256sum {} +').splitlines())}
def health():
 for _ in range(35):
  p=subprocess.run(['docker','exec','wms-local-api','node','-e',"fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{if(!r.ok||(await r.json()).status!=='ok')throw Error()}).catch(()=>process.exit(1))"],capture_output=True)
  if p.returncode==0:return
  time.sleep(1)
 raise RuntimeError('API health failed')
if sys.argv[-1]=='stage':
 assert current()==BASE
 assert json.loads((R/'api-candidate-proof.json').read_text())['passed']==4
 (R/'Dockerfile').write_text('FROM '+BASE+'\nCOPY api-payload/ '+PREFIX+'\n')
 tag='wms-local-api:fbs-unmarked-labels-20261108'
 d('build','--network','none','-q','-t',tag,str(R));image=d('image','inspect',tag,'--format','{{.Id}}')
 a,b=files(BASE),files(image);expected={PREFIX+n for n in json.loads((R/'api-changes.json').read_text())}
 assert set(a)<=set(b) and {n for n in b if a.get(n)!=b[n]}==expected
 (R/'stage.json').write_text(json.dumps({'base':BASE,'images':{'api':image,'web':WEB},'hashes':{n:b[n] for n in expected},'allApiHashes':b,'composeHash':sha(C.read_bytes())}))
 print('Staged exact one-file API overlay; all other files preserved')
else:
 locks=[]
 for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  Path(name).parent.mkdir(parents=True,exist_ok=True);f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 v=json.loads((R/'stage.json').read_text());pr=json.loads((R/'pr.json').read_text())
 assert pr['state']=='MERGED' and pr['baseRefName']=='feature/la_panthera' and pr['headRefName']=='fix/fbs-unmarked-paired-labels'
 isolated=json.loads((R/'isolated-proof.json').read_text())
 assert isolated['fullApiHealth'] and isolated['image']==v['images']['api']
 assert current()==BASE and d('inspect','wms-local-web','--format','{{.Image}}')==WEB
 assert sha(C.read_bytes())==v['composeHash']
 old=C.read_bytes();(R/'compose.before.json').write_bytes(old)
 others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='wms-local-api'}
 env=envhash();config=json.loads(old)
 def start():d('compose','-f',str(C),'up','-d','--no-deps','--no-build','--pull','never','api')
 try:
  config['services']['api']['image']=v['images']['api']
  environment=config['services']['api'].setdefault('environment',{})
  if isinstance(environment,dict):environment[FLAG]='true'
  else:config['services']['api']['environment']=[x for x in environment if not x.startswith(FLAG+'=')]+[FLAG+'=true']
  C.write_text(json.dumps(config,indent=2));start();health()
  assert current()==v['images']['api'] and envhash()==env
  assert [x for x in json.loads(d('inspect','wms-local-api','--format','{{json .Config.Env}}')) if x.startswith(FLAG+'=')]==[FLAG+'=true']
  live={n:h for h,n in (l.split(None,1) for l in d('exec','wms-local-api','sh','-c','find '+PREFIX+' -type f -exec sha256sum {} +').splitlines())}
  assert live==v['allApiHashes']
  assert all(d('inspect',n,'--format','{{.Id}}')==i for n,i in others.items())
 except Exception:
  C.write_bytes(old);start();health();raise
 (R/'published.json').write_text(json.dumps({'pr':pr['number'],'health':True,'otherEnvironmentUnchanged':True,'enabledFlag':FLAG,'otherContainersUnchanged':True,**v}))
 print('Published: full API hashes, health, environment and other containers verified')
