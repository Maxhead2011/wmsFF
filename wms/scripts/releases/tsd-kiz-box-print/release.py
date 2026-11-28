from pathlib import Path
import subprocess,json,sys,fcntl,time,hashlib
r=Path(__file__).resolve().parent;base='sha256:951a6a53a11d89587f7423bb3de0e5d11fe988fad41035dec3c0cfc6db204507'
allowed={'modules/tsd/'+n+'.js' for n in ['tsd-kiz-box-print.service','tsd-kiz-box-print.controller','tsd-kiz-box-label','tsd.module']}|{'modules/marketplace-connections/marketplace-connections.service.js','modules/administration/administration-internal-api.service.js'}
def run(*a):return subprocess.check_output(a,text=True).strip()
def live(n):return run('docker','inspect',n,'--format','{{.Image}}')
def hashes(image):
 s=run('docker','run','--rm','--network','none','--entrypoint','sh',image,'-c','find /app/apps/api/dist -type f -exec sha256sum {} +')
 return {l.split(None,1)[1].replace('/app/apps/api/dist/',''):l.split(None,1)[0] for l in s.splitlines()}
if sys.argv[1]=='stage':
 assert live('wms-local-api')==base
 (r/'Dockerfile').write_text('FROM '+base+'\nCOPY api-payload/ /app/apps/api/dist/\n')
 run('docker','build','--network','none','-t','wms-local-api:kiz-box-print-277',str(r));image=run('docker','image','inspect','wms-local-api:kiz-box-print-277','--format','{{.Id}}')
 before,after=hashes(base),hashes(image);changed={k for k,v in after.items() if before.get(k)!=v};assert set(before)<=set(after) and changed==allowed,changed
 run('docker','run','--rm','--network','none','--entrypoint','node',image,'-e',"require('/app/apps/api/dist/modules/tsd/tsd.module');console.log('loads')")
 (r/'stage.json').write_text(json.dumps({'base':base,'image':image,'changes':sorted(changed),'files':len(after)}));print((r/'stage.json').read_text());sys.exit()
locks=[]
for n in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/opt/wms-restore/.release-pr863.lock']:
 f=open(n,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
pr=json.loads((r/'pr.json').read_text());assert pr['merged'] and pr['base']=='feature/la_panthera'
stage=json.loads((r/'stage.json').read_text());assert json.loads((r/'isolated-proof.json').read_text())['fullNestHealth'];assert live('wms-local-api')==base
cfg=Path('/opt/wms-restore/compose.json');old=cfg.read_bytes();config=json.loads(old);(r/'compose.before.json').write_bytes(old)
web=live('wms-local-web');others={n:run('docker','inspect',n,'--format','{{.Id}}') for n in run('docker','ps','--format','{{.Names}}').splitlines() if n!='wms-local-api'}
config['services']['api']['image']=stage['image'];config['services']['api']['environment']['WMS_TSD_KIZ_BOX_PRINT_ENABLED']='true'
def start():run('docker','compose','-f',str(cfg),'up','-d','--no-deps','--no-build','--pull','never','api')
def health():
 for _ in range(45):
  try:
   if json.loads(run('curl','-fsS','--max-time','4','https://wms.logoff.pro/api/v1/health'))['status']=='ok':return
  except Exception:pass
  time.sleep(1)
 raise RuntimeError('health failed')
try:
 cfg.write_text(json.dumps(config,indent=2));start();health();assert live('wms-local-api')==stage['image'];assert live('wms-local-web')==web
 assert hashes(stage['image'])==hashes(live('wms-local-api'))
 assert all(run('docker','inspect',n,'--format','{{.Id}}')==i for n,i in others.items())
except BaseException:
 cfg.write_bytes(old);start();health();raise
(r/'published.json').write_text(json.dumps({**stage,'web':web,'health':True,'otherContainersUnchanged':True,'pr':pr}));print((r/'published.json').read_text())
