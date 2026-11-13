"""Exact web-only host-scope overlay; API, data and unrelated containers retained."""
from pathlib import Path
import sys,json,subprocess,hashlib,fcntl
R=Path(sys.argv[1]);mode=sys.argv[2];C=Path('/opt/wms-restore/compose.json')
def docker(*args):return subprocess.check_output(['docker',*args],text=True).strip()
def sha(b):return hashlib.sha256(b).hexdigest()
def inspect(name,field):return docker('inspect',name,'--format','{{'+field+'}}')
def environment():return sorted(json.loads(inspect('wms-local-web','json .Config.Env')))
def hashes(img):
 prefix='/usr/share/nginx/html/'
 raw=docker('run','--rm','--network','none','--entrypoint','sh',img,'-c','find '+prefix+' -type f -exec sha256sum {} +')
 return {line.split(None,1)[1][len(prefix):]:line.split(None,1)[0] for line in raw.splitlines()}
if mode=='capture':
 R.mkdir(parents=True,exist_ok=True)
 base={'web':inspect('wms-local-web','.Image'),'api':inspect('wms-local-api','.Image'),'apiContainer':inspect('wms-local-api','.Id'),'composeHash':sha(C.read_bytes())}
 base['hashes']=hashes(base['web']);(R/'base.json').write_text(json.dumps(base));print(json.dumps({k:v for k,v in base.items() if k!='hashes'}))
elif mode=='stage':
 base=json.loads((R/'base.json').read_text());assert inspect('wms-local-web','.Image')==base['web']
 proof=json.loads((R/'browser-proof.json').read_text());assert proof['exactPdf'] and proof['printerSelection'] and proof['syntheticPdf'] and proof['noPrintJob']
 assert json.loads((R/'controls/controls-check.json').read_text())['passed']==24
 (R/'Dockerfile').write_text('FROM '+base['web']+'\nCOPY web-payload/ /usr/share/nginx/html/\n')
 tag='wms-local-web:ozon-request-labels-20261113';docker('build','--network','none','-q','-t',tag,str(R));new=docker('image','inspect',tag,'--format','{{.Id}}');actual=hashes(new)
 expected=set(json.loads((R/'web-changes.json').read_text()));changed={p for p in actual if actual[p]!=base['hashes'].get(p)}
 assert set(base['hashes'])<=set(actual) and changed==expected and len(changed)==5
 (R/'stage.json').write_text(json.dumps({'image':new,'changes':{p:actual[p]for p in changed}}));print('Stage PASS: web5 only; every other file unchanged')
elif mode=='publish':
 locks=[]
 for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 base=json.loads((R/'base.json').read_text());stage=json.loads((R/'stage.json').read_text());pr=json.loads((R/'pr.json').read_text())
 assert pr['headRefOid']==json.loads((R/'source.json').read_text())['head']
 assert pr['state']=='MERGED' and pr['headRefName']=='fix/ozon-request-label-actions' and pr['baseRefName']=='feature/la_panthera'
 assert inspect('wms-local-web','.Image')==base['web'] and inspect('wms-local-api','.Image')==base['api'] and inspect('wms-local-api','.Id')==base['apiContainer'] and sha(C.read_bytes())==base['composeHash']
 old=C.read_bytes();(R/'compose.before.json').write_bytes(old);config=json.loads(old)
 others={n:inspect(n,'.Id')for n in docker('ps','--format','{{.Names}}').splitlines()if n!='wms-local-web'}
 env=environment()
 def start():docker('compose','-f',str(C),'up','-d','--no-deps','--no-build','--pull','never','web')
 try:
  config['services']['web']['image']=stage['image'];C.write_text(json.dumps(config,indent=2));start()
  assert inspect('wms-local-web','.Image')==stage['image'] and environment()==env
  assert hashes(stage['image'])=={**base['hashes'],**stage['changes']}
  assert all(inspect(n,'.Id')==v for n,v in others.items())
  docker('exec','wms-local-api','node','-e',"fetch('http://127.0.0.1:3000/api/v1/health').then(r=>{if(!r.ok)throw Error()}).catch(()=>process.exit(1))")
 except Exception:
  C.write_bytes(old);start();raise
 (R/'published.json').write_text(json.dumps({**stage,'pr':pr['number'],'apiImage':base['api'],'apiContainerUnchanged':True,'environmentUnchanged':True,'otherContainersUnchanged':True,'health':True}));print('Published and verified web5; API/environment/other containers retained')
else:raise ValueError(mode)

