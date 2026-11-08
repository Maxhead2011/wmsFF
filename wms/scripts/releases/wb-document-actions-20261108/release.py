"""FIX: guarded web-only overlay; preserve API, configuration and all other containers."""
from pathlib import Path
import json,subprocess,sys,hashlib,fcntl
R=Path(sys.argv[1]);C=Path('/opt/wms-restore/compose.json')
BASE='sha256:79a1d9a4ef78c04a77c8efa933b58045f461d5a59e8130c148988ee8137d535c'
API='sha256:9d9cc419a8adfa851aaaedc6ad0bd501a38ebc8e87ba5e96a42fa04f46c733f4'
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def sha(b):return hashlib.sha256(b).hexdigest()
def current(n):return d('inspect','wms-local-'+n,'--format','{{.Image}}')
def hashes(image):return {n:h for h,n in (l.split(None,1) for l in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find /usr/share/nginx/html -type f -exec sha256sum {} +').splitlines())}
assert current('api')==API and current('web')==BASE
assert json.loads((R/'runtime-browser-proof.json').read_text())['passed']==7
if sys.argv[-1]=='stage':
 (R/'Dockerfile').write_text('FROM '+BASE+'\nCOPY web-payload/ /usr/share/nginx/html/\n')
 image=d('build','--network','none','-q','-t','wms-local-web:wb-document-actions-20261108',str(R))
 a,b=hashes(BASE),hashes(image);expected={'/usr/share/nginx/html/'+x for x in json.loads((R/'web-changes.json').read_text())}
 assert set(a)<=set(b) and {n for n in b if a.get(n)!=b[n]}==expected
 (R/'stage.json').write_text(json.dumps({'base':BASE,'image':image,'hashes':{n:b[n] for n in expected},'composeHash':sha(C.read_bytes())}));print('Stage verified: web2 only')
else:
 locks=[]
 for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 assert current('api')==API and current('web')==BASE
 v=json.loads((R/'stage.json').read_text());pr=json.loads((R/'pr.json').read_text())
 assert pr['state']=='MERGED' and pr['baseRefName']=='feature/la_panthera' and pr['headRefName']=='fix/wb-document-actions'
 old=C.read_bytes();assert sha(old)==v['composeHash'];(R/'compose.before.json').write_bytes(old)
 other={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='wms-local-web'}
 env=sorted(json.loads(d('inspect','wms-local-web','--format','{{json .Config.Env}}')))
 def start():d('compose','-f',str(C),'up','-d','--no-deps','--no-build','--pull','never','web')
 try:
  config=json.loads(old);config['services']['web']['image']=v['image'];C.write_text(json.dumps(config,indent=2));start()
  d('exec','wms-local-web','wget','-qO-','http://127.0.0.1/')
  assert current('web')==v['image'];assert sorted(json.loads(d('inspect','wms-local-web','--format','{{json .Config.Env}}')))==env
  for n,h in v['hashes'].items():assert d('exec','wms-local-web','sha256sum',n).split()[0]==h
  assert all(d('inspect',n,'--format','{{.Id}}')==i for n,i in other.items())
 except Exception:
  C.write_bytes(old);start();raise
 (R/'published.json').write_text(json.dumps({'pr':pr['number'],'apiUnchanged':True,'otherContainersUnchanged':True,'environmentUnchanged':True,**v}));print('Published and verified')
