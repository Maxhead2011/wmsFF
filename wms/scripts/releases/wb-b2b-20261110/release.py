"""FIX: own API-only overlay, image/compose guards, rollback and runtime tests."""
from pathlib import Path
import sys,json,subprocess,hashlib,time,fcntl
R=Path(sys.argv[1]); mode=sys.argv[2]; C=Path('/opt/wms-restore/compose.json')
FLAG='WMS_AUTO_ASSEMBLY_DURABLE_ENABLED'
MODULES={'modules/marketplace-connections/marketplace-connections.service.js','modules/marketplace-connections/wb-label-orders.js'}
def docker(*args): return subprocess.check_output(['docker',*args],text=True).strip()
def sha(b): return hashlib.sha256(b).hexdigest()
def image(s): return docker('inspect','wms-local-'+s,'--format','{{.Image}}')
def hashes(img):
 raw=docker('run','--rm','--network','none','--entrypoint','sh',img,'-c','find /app/apps/api/dist/ -type f -exec sha256sum {} +')
 return {line.split(None,1)[1][len('/app/apps/api/dist/'):]:line.split(None,1)[0] for line in raw.splitlines()}
def environment(s): return dict(x.split('=',1) for x in json.loads(docker('inspect','wms-local-'+s,'--format','{{json .Config.Env}}')))
def health():
 for _ in range(40):
  if subprocess.run(['docker','exec','wms-local-api','node','-e',"fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{if(!r.ok||(await r.json()).status!=='ok')throw Error()}).catch(()=>process.exit(1))"],capture_output=True).returncode==0: return
  time.sleep(1)
 raise RuntimeError('health failed')
manifest=json.loads((R/'manifest.json').read_text())
base={s:manifest['containers']['infra-'+s+'-1']['image'] for s in ['api','web']}
expected=manifest['artifacts']['api-runtime.tar.gz']['files']
if mode=='stage':
 assert all(image(s)==v for s,v in base.items()),'live base changed'
 assert hashes(base['api'])==expected,'baseline differs from live image'
 (R/'Dockerfile').write_text('FROM '+base['api']+'\nCOPY api-payload/ /app/apps/api/dist/\n')
 tag='wms-local-api:b2b-20261110'
 docker('build','--network','none','-q','-t',tag,str(R))
 new=docker('image','inspect',tag,'--format','{{.Id}}'); actual=hashes(new)
 assert set(actual)==set(expected)
 assert {n for n in actual if actual[n]!=expected[n]}==MODULES
 docker('run','--rm','--network','none','-w','/app/apps/api','--entrypoint','node',new,'-e',"require('./dist/modules/marketplace-connections/marketplace-connections.module')")
 testargs=['run','--rm','--network','none','-v',str(R/'runtime.test.cjs')+':/tmp/runtime.test.cjs:ro','--entrypoint','node']
 before=subprocess.run(['docker',*testargs,base['api'],'/tmp/runtime.test.cjs'],capture_output=True,text=True)
 assert before.returncode!=0 and 'AssertionError' in before.stderr,'regression must fail before fix'
 proof=docker(*testargs,new,'/tmp/runtime.test.cjs')
 (R/'stage.json').write_text(json.dumps({'base':base,'image':new,'composeHash':sha(C.read_bytes()),'hashes':actual,'runtime':proof}))
 print('PASS staged API2; runtime RED/GREEN; module load; full baseline hashes')
elif mode=='publish':
 locks=[]
 for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  Path(name).parent.mkdir(parents=True,exist_ok=True); f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 stage=json.loads((R/'stage.json').read_text()); pr=json.loads((R/'pr.json').read_text())
 assert pr['state']=='MERGED' and pr['headRefName']=='fix/wb-b2b-supply-grouping' and pr['baseRefName']=='feature/la_panthera'
 assert all(image(s)==v for s,v in base.items()) and sha(C.read_bytes())==stage['composeHash']
 old=C.read_bytes(); (R/'compose.before.json').write_bytes(old); config=json.loads(old)
 beforeEnv=environment('api')
 others={n:docker('inspect',n,'--format','{{.Id}}') for n in docker('ps','--format','{{.Names}}').splitlines() if n!='wms-local-api'}
 def start(): docker('compose','-f',str(C),'up','-d','--no-deps','--no-build','--pull','never','api')
 try:
  config['services']['api']['image']=stage['image']
  assert isinstance(config['services']['api'].get('environment'),dict)
  assert beforeEnv.get(FLAG)=='true', 'own auto assembly flag must already be enabled'
  C.write_text(json.dumps(config,indent=2));start();health()
  assert image('api')==stage['image'] and hashes(stage['image'])==stage['hashes']
  assert environment('api')==beforeEnv
  assert all(docker('inspect',n,'--format','{{.Id}}')==v for n,v in others.items())
 except Exception:
  C.write_bytes(old);start();health();raise
 (R/'published.json').write_text(json.dumps({'pr':pr['number'],'images':{'api':stage['image'],'web':base['web']},'health':True,'otherContainersUnchanged':True,'environmentPreservedExceptApprovedPurposeFlag':True,'runtime':stage['runtime']}))
 print('PASS published: API2, health, hashes, approved flag, other containers unchanged')
else: raise ValueError(mode)
