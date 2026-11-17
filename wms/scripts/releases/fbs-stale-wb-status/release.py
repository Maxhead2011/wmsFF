"""Own-WMS FBS display release with exact hashes, release locks and rollback."""
from pathlib import Path
import sys,json,subprocess,hashlib,time,fcntl
R=Path(sys.argv[1]);mode=sys.argv[2];C=Path('/opt/wms-restore/compose.json')
FILES={'modules/marketplace-connections/marketplace-connections.service.js', 'modules/marketplace-connections/fbs-display-wb-reconcile.js'}
def docker(*args):return subprocess.check_output(['docker',*args],text=True).strip()
def sha(data):return hashlib.sha256(data).hexdigest()
def image():return docker('inspect','wms-local-api','--format','{{.Image}}')
def env():return dict(s.split('=',1) for s in json.loads(docker('inspect','wms-local-api','--format','{{json .Config.Env}}')))
def hashes(img):
 prefix='/app/apps/api/dist/'
 raw=docker('run','--rm','--network','none','--entrypoint','sh',img,'-c','find '+prefix+' -type f -exec sha256sum {} +')
 return{line.split(None,1)[1][len(prefix):]:line.split(None,1)[0]for line in raw.splitlines()}
def health():
 for _ in range(40):
  if subprocess.run(['docker','exec','wms-local-api','node','-e',"fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{if(!r.ok||(await r.json()).status!=='ok')throw Error()}).catch(()=>process.exit(1))"],capture_output=True).returncode==0:return
  time.sleep(1)
 raise RuntimeError('API health failed')
def preview(img):
 return docker('run','--rm','--network','none','-v',str(R)+':/proof:ro','-e','FBS_RUNTIME=/app/apps/api/dist/modules/marketplace-connections/marketplace-connections.service.js','-e','FBS_LIVE_PROOF=/proof/live-proof.json','--entrypoint','node',img,'--test','/proof/runtime.test.cjs')
if mode=='capture':
 expected=json.loads((R/'expected-base.json').read_text())
 assert image()==expected['image'],'Published API changed'
 actual=hashes(image());assert actual==expected['files'],'Published modules differ from materialized base'
 (R/'base.json').write_text(json.dumps({'api':image(),'composeHash':sha(C.read_bytes()),'files':actual}))
 print('Fresh API image and all module hashes match reviewed baseline');sys.exit()
base=json.loads((R/'base.json').read_text())
if mode=='stage':
 assert image()==base['api'] and sha(C.read_bytes())==base['composeHash']
 (R/'Dockerfile').write_text('FROM '+base['api']+'\nCOPY api-payload/ /app/apps/api/dist/\n')
 tag='wms-local-api:fbs-stale-wb-status'
 docker('build','--network','none','-q','-t',tag,str(R));new=docker('image','inspect',tag,'--format','{{.Id}}');actual=hashes(new)
 assert set(base['files'])<=set(actual)
 changes={n:actual[n]for n in actual if base['files'].get(n)!=actual[n]};assert set(changes)==FILES
 output=docker('run','--rm','--network','none','-w','/app/apps/api','--entrypoint','node',new,'-e',"if(typeof require('./dist/modules/marketplace-connections/marketplace-connections.service').MarketplaceConnectionsService!=='function')process.exit(1)")
 proof=preview(new)
 (R/'stage.json').write_text(json.dumps({'image':new,'changes':changes,'runtimeTests':output,'preview':proof}))
 print('Stage PASS: exact two-file delta; isolated runtime tests passed')
elif mode=='publish':
 locks=[]
 for n in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  Path(n).parent.mkdir(parents=True,exist_ok=True);f=open(n,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 stage=json.loads((R/'stage.json').read_text());pr=json.loads((R/'pr.json').read_text())
 assert pr['state']=='MERGED' and pr['baseRefName']=='feature/la_panthera' and pr['headRefName']=='fix/fbs-stale-wb-status'
 assert image()==base['api'] and sha(C.read_bytes())==base['composeHash']
 old=C.read_bytes();(R/'compose.before.json').write_bytes(old);config=json.loads(old);before=env()
 others={n:docker('inspect',n,'--format','{{.Id}}')for n in docker('ps','--format','{{.Names}}').splitlines()if n!='wms-local-api'}
 def start():docker('compose','-f',str(C),'up','-d','--no-deps','--no-build','--pull','never','api')
 try:
  api=config['services']['api'];api['image']=stage['image']
  C.write_text(json.dumps(config,indent=2));start();health()
  assert image()==stage['image'] and env()==before
  assert hashes(image())=={**base['files'],**stage['changes']}
  assert all(docker('inspect',n,'--format','{{.Id}}')==v for n,v in others.items())
  proof=preview(image())
 except Exception:
  C.write_bytes(old);start();health();raise
 (R/'published.json').write_text(json.dumps({**stage,'pr':pr['number'],'health':True,'otherEnvironmentUnchanged':True,'otherContainersUnchanged':True,'publishedPreview':proof}))
 print('Published: API hashes, health, environment and other containers verified; runtime tests passed')
else:raise ValueError(mode)
