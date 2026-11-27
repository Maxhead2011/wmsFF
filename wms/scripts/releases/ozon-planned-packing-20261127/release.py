import json,sys,hashlib,subprocess,time,fcntl
from pathlib import Path
r=Path(sys.argv[1]);action=sys.argv[2]
def run(*args):return subprocess.check_output(args,text=True).strip()
def image(kind):return run('docker','inspect','wms-local-'+kind,'--format','{{.Image}}')
def env(kind):return dict(x.split('=',1) for x in json.loads(run('docker','inspect','wms-local-'+kind,'--format','{{json .Config.Env}}')))
def hashes(img,kind):
 root='/app/apps/api/dist' if kind=='api' else '/usr/share/nginx/html'
 raw=run('docker','run','--rm','--network','none','--entrypoint','sh',img,'-c','find '+root+' -type f -exec sha256sum {} +')
 return {l.split(None,1)[1].removeprefix(root+'/'):l.split()[0] for l in raw.splitlines()}
base=json.loads((r/'base.json').read_text());expected={}
for kind in ['api','web']:
 assert image(kind)==base[kind],kind+' base drift'
 assert hashes(base[kind],kind)==base[kind+'Files'],kind+' baseline drift'
 expected[kind]=dict(base[kind+'Files'])
 for f in (r/kind).rglob('*'):
  if f.is_file():expected[kind][f.relative_to(r/kind).as_posix()]=hashlib.sha256(f.read_bytes()).hexdigest()
for kind in ['api','web']:
 assert {n for n in expected[kind] if expected[kind].get(n)!=base[kind+'Files'].get(n)}==set(json.loads((r/(kind+'-changes.json')).read_text()))
 assert set(base[kind+'Files']).issubset(expected[kind])
if action=='stage':
 images={}
 for kind in ['api','web']:
  root='/app/apps/api/dist' if kind=='api' else '/usr/share/nginx/html'
  (r/('Dockerfile.'+kind)).write_text('FROM '+base[kind]+'\nCOPY '+kind+'/ '+root+'/\n')
  tag='logoff-'+kind+':ozon-planned-packing-20261127'
  run('docker','build','--network','none','-f',str(r/('Dockerfile.'+kind)),'-t',tag,str(r))
  images[kind]=run('docker','image','inspect',tag,'--format','{{.Id}}');assert hashes(images[kind],kind)==expected[kind]
 envfile=r/'runtime.env';envfile.write_text('\n'.join(k+'='+v for k,v in env('api').items() if k=='DATABASE_URL' or k.startswith('WMS_') and v in ['true','false'])+'\n');envfile.chmod(0o600)
 proof=run('docker','run','--rm','--network','container:wms-local-api','--env-file',str(envfile),'--entrypoint','node','-v',str(r/'runtime-test.cjs')+':/tmp/fulfillment-runtime-test.cjs:ro','-w','/app/apps/api',images['api'],'/tmp/fulfillment-runtime-test.cjs','/app/apps/api/dist');(r/'runtime-proof.json').write_text(proof);print(proof)
 (r/'stage.json').write_text(json.dumps({'images':images,'hashes':expected}));print(json.dumps({'staged':images,'apiFiles':len(expected['api']),'webFiles':len(expected['web'])}));sys.exit()
assert action=='publish'
locks=[]
for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock','/opt/wms-restore/.release-pr863.lock']:
 f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
for kind in ['api','web']:assert image(kind)==base[kind],kind+' changed under release lock'
pr=json.loads((r/'pr.json').read_text());assert pr['merged'] and pr['head']==json.loads((r/'verification.json').read_text())['head'] and pr['base']=='feature/la_panthera'
assert json.loads((r/'verification.json').read_text())['passed'] and not (r/'published.json').exists()
stage=json.loads((r/'stage.json').read_text());assert stage['hashes']==expected
for kind in ['api','web']:assert hashes(stage['images'][kind],kind)==expected[kind]
compose=Path('/opt/wms-restore/compose.json');old=compose.read_bytes();config=json.loads(old);oldenv={k:env(k) for k in ['api','web']}
other={n:run('docker','inspect',n,'--format','{{.Id}}') for n in run('docker','ps','--format','{{.Names}}').splitlines() if n not in ['wms-local-api','wms-local-web']}
(r/'compose.before.json').write_bytes(old);(r/'compose.before.json').chmod(0o600)
for kind in ['api','web']:run('docker','tag',base[kind],'logoff-'+kind+':before-ozon-planned-packing-20261127')
def start(kind):run('docker','compose','-f',str(compose),'up','-d','--no-deps','--no-build','--pull','never',kind)
def health():
 for _ in range(40):
  response=subprocess.run(['curl','-fsS','--max-time','3','https://wms.logoff.pro/api/v1/health'],capture_output=True)
  if response.returncode==0 and json.loads(response.stdout).get('status')=='ok':return
  time.sleep(1)
 raise RuntimeError('health failed')
try:
 for kind in ['api','web']:config['services'][kind]['image']=stage['images'][kind]
 assert oldenv['api'].get('WMS_OZON_FBO_IMPORT_ENABLED')=='true','Existing own-WMS selected-label feature required'
 config['services']['api'].setdefault('environment',{})['WMS_OZON_PLANNED_PACKING_ENABLED']='true'
 compose.write_text(json.dumps(config,indent=2));start('api');health();start('web');health()
 assert env('api')=={**oldenv['api'],'WMS_OZON_PLANNED_PACKING_ENABLED':'true'} and env('web')==oldenv['web'],'Unexpected environment change'
 for kind in ['api','web']:assert image(kind)==stage['images'][kind] and hashes(image(kind),kind)==expected[kind]
 assert all(run('docker','inspect',n,'--format','{{.Id}}')==v for n,v in other.items()),'Other container changed'

except BaseException:
 compose.write_bytes(old);start('api');start('web');health();raise
result={'published':True,'pr':pr['number'],'mergeCommitSha':pr['mergeCommitSha'],'head':pr['head'],'images':stage['images'],'health':True,'allHashesVerified':True,'apiFiles':len(expected['api']),'webFiles':len(expected['web']),'environmentChanges':{'WMS_OZON_PLANNED_PACKING_ENABLED':'true'},'otherContainersUnchanged':True,'businessRecordsChangedByRelease':False}
(r/'published.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
