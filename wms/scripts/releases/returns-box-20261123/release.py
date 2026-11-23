"""Own API only: exact one-file overlay, pinned release, no warehouse writes."""
from pathlib import Path
import subprocess,json,sys,hashlib,time,fcntl
r=Path(sys.argv[1]);action=sys.argv[2]
def run(*a):return subprocess.check_output(a,text=True).strip()
def image():return run('docker','inspect','wms-local-api','--format','{{.Image}}')
# FIX: Docker may reorder entries on recreation; compare every key/value, not list order.
def env():return dict(item.split('=',1) for item in json.loads(run('docker','inspect','wms-local-api','--format','{{json .Config.Env}}')))
base=json.loads((r/'base.json').read_text());assert image()==base['baseApi']
name='modules/returns/returns.service.js'
def hashes(img):
 code="const fs=require('fs'),c=require('crypto'),o={};function w(d,p=''){for(const e of fs.readdirSync(d,{withFileTypes:true})){let q=p+e.name;if(e.isDirectory())w(d+'/'+e.name,q+'/');else if(q.endsWith('.js'))o[q]=c.createHash('sha256').update(fs.readFileSync(d+'/'+e.name)).digest('hex')}}w('/app/apps/api/dist');console.log(JSON.stringify(o))"
 return json.loads(run('docker','run','--rm','--entrypoint','node',img,'-e',code))
expected=json.loads((r/'manifest.json').read_text())['artifacts']['api-runtime.tar.gz']['files']
expected[name]=hashlib.sha256((r/'returns.service.js').read_bytes()).hexdigest()
if action=='stage':
 (r/'Dockerfile').write_text('FROM '+base['baseApi']+'\nCOPY returns.service.js /app/apps/api/dist/'+name+'\n')
 subprocess.run(['docker','build','-t','logoff-api:returns-box-20261123',str(r)],check=True)
 new=run('docker','image','inspect','logoff-api:returns-box-20261123','--format','{{.Id}}')
 assert hashes(new)==expected
 (r/'stage.json').write_text(json.dumps({'images':{'api':new},'allHashesVerified':True}));print(new);sys.exit()
assert action=='publish'
locks=[]
for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/opt/wms-restore/.release-pr863.lock']:
 f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
assert image()==base['baseApi']
stage=json.loads((r/'stage.json').read_text());proof=json.loads((r/'isolated-proof.json').read_text());pr=json.loads((r/'pr.json').read_text())
assert proof['image']==stage['images']['api'] and proof['markAndCloseVerified'] and proof['fullApiHealth']
assert pr['state']=='MERGED' and pr['headRefName']=='fix/returns-create-box' and pr['baseRefName']=='feature/la_panthera'
assert hashes(stage['images']['api'])==expected
assert not (r/'published.json').exists()
compose=Path('/opt/wms-restore/compose.json');old=compose.read_bytes();config=json.loads(old);oldenv=env()
other={n:run('docker','inspect',n,'--format','{{.Id}}') for n in run('docker','ps','--format','{{.Names}}').splitlines() if n!='wms-local-api'}
(r/'compose.before.json').write_bytes(old);(r/'compose.before.json').chmod(0o600)
def start():run('docker','compose','-f',str(compose),'up','-d','--no-deps','--no-build','--pull','never','api')
def health():
 for _ in range(40):
  if subprocess.run(['curl','-fsS','--max-time','3','https://wms.logoff.pro/api/v1/health'],capture_output=True).returncode==0:return
  time.sleep(1)
 raise RuntimeError('health failed')
try:
 config['services']['api']['image']=stage['images']['api'];compose.write_text(json.dumps(config,indent=2));start();health()
 assert image()==stage['images']['api'] and env()==oldenv
 assert all(run('docker','inspect',n,'--format','{{.Id}}')==v for n,v in other.items())
 assert hashes(image())==expected
except Exception:
 compose.write_bytes(old);start();health();raise
result=dict(pr=pr['number'],images=stage['images'],health=True,allHashesVerified=True,environmentUnchanged=True,otherContainersUnchanged=True,noBusinessWrites=True)
(r/'published.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
