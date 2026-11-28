"""Exact two-service overlay, guarded by image IDs and a merged PR."""
from pathlib import Path
import json,subprocess,sys,fcntl,hashlib,time
r=Path(__file__).resolve().parent
bases={'api':'sha256:60e7c712f8113115461315edfe6fdc3fb2afe0638158619bf852bee1befca1fa'}
def run(*a):return subprocess.check_output(a,text=True).strip()
def image(s):return run('docker','inspect','-f','{{.Image}}','wms-local-'+s)
def hashes(img,folder):
 data=run('docker','run','--rm','--network','none','--entrypoint','sh',img,'-c',f'cd {folder} && find . -type f -exec sha256sum {{}} +')
 return {line.split('  ',1)[1].removeprefix('./'):line.split('  ',1)[0] for line in data.splitlines()}
locks=[]
for p in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock','/opt/wms-restore/.release-pr863.lock']:
 f=open(p,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
assert all(image(s)==b for s,b in bases.items()),'Published version changed'
targets={}
for s,base in bases.items():
 folder='/app/apps/api/dist' if s=='api' else '/usr/share/nginx/html'
 tag='logoff-'+s+':pallet-recovery-pairs-20261128'
 if sys.argv[1]=='stage':
  (r/('Dockerfile.'+s)).write_text(f'FROM {base}\nCOPY {s}-payload/ {folder}/\n')
  run('docker','build','--network','none','-f',str(r/('Dockerfile.'+s)),'-t',tag,str(r))
 targets[s]=run('docker','image','inspect','-f','{{.Id}}',tag)
 before=hashes(base,folder);after=hashes(targets[s],folder)
 expected={p.relative_to(r/(s+'-payload')).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in (r/(s+'-payload')).rglob('*') if p.is_file()}
 assert not before.keys()-after.keys()
 assert {k:v for k,v in after.items() if before.get(k)!=v}==expected
if sys.argv[1]=='stage':
 run('docker','run','--rm','--network','none','--entrypoint','node',targets['api'],'-e','require("/app/apps/api/dist/modules/warehouse/pallet-recovery-pairs.js")')
 (r/'targets.json').write_text(json.dumps(targets));print(json.dumps(targets));sys.exit()
assert targets==json.loads((r/'targets.json').read_text())
proof=json.loads((r/'isolated-proof.json').read_text());assert proof['image']==targets['api'] and proof['fullNestHealth'] and proof['result']['passed']
pr=json.loads((r/'merge.json').read_text());assert pr['state']=='MERGED' and pr['baseRefName']=='feature/la_panthera'
compose=Path('/opt/wms-restore/compose.json');old=compose.read_bytes();config=json.loads(old);(r/'compose-before.json').write_bytes(old)
other=run('docker','ps','--format','{{.Names}} {{.ID}}');other='\n'.join(l for l in other.splitlines() if not l.startswith(('wms-local-api ','wms-local-web ')))
def start():run('docker','compose','-f',str(compose),'up','-d','--no-deps','--no-build','--pull','never','api')
try:
 for s in targets:config['services'][s]['image']=targets[s]
 config['services']['api']['environment']['WMS_TSD_PALLET_RECOVERY_PAIRS_ENABLED']='true'
 compose.write_text(json.dumps(config,indent=2));start()
 for i in range(45):
  try:
   health=json.loads(run('curl','-fsS','https://wms.logoff.pro/api/v1/health'))
   if health.get('status')=='ok':break
  except Exception:pass
  time.sleep(1)
 else:raise RuntimeError('health timeout')
 for p in (r/'web-payload').rglob('*'):
  if p.is_file():
   data=subprocess.check_output(['curl','--retry','4','--retry-all-errors','-fsS','https://wms.logoff.pro/'+p.relative_to(r/'web-payload').as_posix()]);assert hashlib.sha256(data).digest()==hashlib.sha256(p.read_bytes()).digest()
 assert all(image(s)==targets[s] for s in targets)
 now=run('docker','ps','--format','{{.Names}} {{.ID}}');assert other=='\n'.join(l for l in now.splitlines() if not l.startswith(('wms-local-api ','wms-local-web ')))
except BaseException:
 compose.write_bytes(old);start();raise
(r/'published.json').write_text(json.dumps({'pr':pr['number'],'images':targets,'health':True,'otherContainersUnchanged':True,'configurationDelta':['api.image','api.environment.WMS_TSD_PALLET_RECOVERY_PAIRS_ENABLED']},indent=2));print('Published; health and public bytes verified')
