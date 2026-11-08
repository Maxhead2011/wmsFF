"""FIX: API-only exact overlay, with guarded rollback; web, schema and environment unchanged."""
from pathlib import Path
import subprocess,json,fcntl,hashlib,sys,time
R=Path(sys.argv[1]);C=Path('/opt/wms-restore/compose.json')
BASE='sha256:48595b98f735dbef559cbe9d45917bcce50b63f037e897cb210b660b685181ab'
WEB='sha256:79a1d9a4ef78c04a77c8efa933b58045f461d5a59e8130c148988ee8137d535c'
PREFIX='/app/apps/api/dist/'
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def sha(b):return hashlib.sha256(b).hexdigest()
def current():return d('inspect','wms-local-api','--format','{{.Image}}')
def files(image):return {n:h for h,n in (l.split(None,1) for l in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find '+PREFIX+' -type f -exec sha256sum {} +').splitlines())}
def health():
 for _ in range(35):
  p=subprocess.run(['docker','exec','wms-local-api','node','-e',"fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{if(!r.ok||(await r.json()).status!=='ok')throw Error()}).catch(()=>process.exit(1))"],capture_output=True)
  if p.returncode==0:return
  time.sleep(1)
 raise RuntimeError('Health failed')
if sys.argv[-1]=='stage':
 assert current()==BASE
 assert json.loads((R/'runtime-api-proof.json').read_text())['passed']==6
 (R/'Dockerfile').write_text('FROM '+BASE+'\nCOPY api-payload/ '+PREFIX+'\n')
 tag='wms-local-api:wb-label-selected-read-20261108'
 d('build','--network','none','-q','-t',tag,str(R));image=d('image','inspect',tag,'--format','{{.Id}}')
 a,b=files(BASE),files(image);expected={PREFIX+n for n in json.loads((R/'api-changes.json').read_text())}
 assert set(a)<=set(b);assert {n for n in b if a.get(n)!=b[n]}==expected
 (R/'stage.json').write_text(json.dumps({'images':{'api':image,'web':WEB},'base':BASE,'composeHash':sha(C.read_bytes()),'hashes':b}))
 print('API2 stage verified; all other bytes retained')
else:
 locks=[]
 for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 v=json.loads((R/'stage.json').read_text());pr=json.loads((R/'pr.json').read_text())
 assert pr['state']=='MERGED' and pr['baseRefName']=='feature/la_panthera' and pr['headRefName']=='fix/wb-label-selected-read'
 assert json.loads((R/'isolated-proof.json').read_text())['fullApiHealth']
 assert current()==BASE and d('inspect','wms-local-web','--format','{{.Image}}')==WEB
 old=C.read_bytes();assert sha(old)==v['composeHash'];(R/'compose.before.json').write_bytes(old)
 other={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='wms-local-api'}
 env=sorted(json.loads(d('inspect','wms-local-api','--format','{{json .Config.Env}}')))
 def start():d('compose','-f',str(C),'up','-d','--no-deps','--no-build','--pull','never','api')
 try:
  config=json.loads(old);config['services']['api']['image']=v['images']['api'];C.write_text(json.dumps(config,indent=2));start();health()
  assert current()==v['images']['api'];assert files(current())==v['hashes']
  assert sorted(json.loads(d('inspect','wms-local-api','--format','{{json .Config.Env}}')))==env
  assert all(d('inspect',n,'--format','{{.Id}}')==i for n,i in other.items())
 except Exception:
  C.write_bytes(old);start();health();raise
 (R/'published.json').write_text(json.dumps({'pr':pr['number'],'health':True,'otherContainersUnchanged':True,'environmentUnchanged':True,**v}))
 print('Published API2; web and other containers unchanged')
