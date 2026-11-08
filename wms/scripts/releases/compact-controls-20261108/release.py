"""FIX: exact web-only overlay, guarded against concurrent deployments; no API/DB changes."""
import sys,json,subprocess,hashlib,fcntl
from pathlib import Path
R=Path(sys.argv[1]);C=Path('/opt/wms-restore/compose.json')
BASE='sha256:675d2be1b1f649a0bd2347c23bf56db03f667f425ec18fa32088256a49447e46'
API='sha256:9ba7837c197ebe2a79943fcd02801f6dbc40d6d7117f2eb5ace0edb8ba3b7315'
PREFIX='/usr/share/nginx/html/'
def d(*args):return subprocess.check_output(['docker',*args],text=True).strip()
def sha(b):return hashlib.sha256(b).hexdigest()
def current(name):return d('inspect','wms-local-'+name,'--format','{{.Image}}')
def hashes(image):return {n:h for h,n in (line.split(None,1) for line in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find '+PREFIX+' -type f -exec sha256sum {} +').splitlines())}
def env():return sorted(json.loads(d('inspect','wms-local-web','--format','{{json .Config.Env}}')))
if sys.argv[-1]=='stage':
 assert current('web')==BASE and current('api')==API
 assert json.loads((R/'candidate-browser.json').read_text())['passed']==24
 (R/'Dockerfile').write_text('FROM '+BASE+'\nCOPY web-payload/ '+PREFIX+'\n')
 tag='wms-local-web:compact-controls-20261108';d('build','--network','none','-q','-t',tag,str(R));image=d('image','inspect',tag,'--format','{{.Id}}')
 before,after=hashes(BASE),hashes(image)
 expected={PREFIX+'index.html',PREFIX+'assets/compact-operational-controls-20261108.css'}
 assert set(before)<=set(after) and {n for n in after if before.get(n)!=after[n]}==expected
 (R/'stage.json').write_text(json.dumps({'base':BASE,'api':API,'image':image,'hashes':{n:after[n] for n in expected},'composeHash':sha(C.read_bytes())}))
 print('Verified web2; all unrelated files preserved')
else:
 locks=[]
 for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 v=json.loads((R/'stage.json').read_text());pr=json.loads((R/'pr.json').read_text())
 assert pr['state']=='MERGED' and pr['baseRefName']=='feature/la_panthera' and pr['headRefName']=='fix/compact-request-and-ozon-controls'
 assert current('web')==BASE and current('api')==API and sha(C.read_bytes())==v['composeHash']
 previous=C.read_bytes();(R/'compose.before.json').write_bytes(previous);oldenv=env()
 other={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='wms-local-web'}
 def start():d('compose','-f',str(C),'up','-d','--no-deps','--no-build','--pull','never','web')
 try:
  config=json.loads(previous);config['services']['web']['image']=v['image'];C.write_text(json.dumps(config,indent=2));start()
  d('exec','wms-local-web','wget','-qO-','http://127.0.0.1/')
  assert current('web')==v['image'] and env()==oldenv
  for n,h in v['hashes'].items():assert d('exec','wms-local-web','sha256sum',n).split()[0]==h
  assert all(d('inspect',n,'--format','{{.Id}}')==i for n,i in other.items())
 except Exception:
  C.write_bytes(previous);start();raise
 (R/'published.json').write_text(json.dumps({'pr':pr['number'],'otherContainersUnchanged':True,'environmentUnchanged':True,**v}));print('Published web only; hashes/environment/API verified')
