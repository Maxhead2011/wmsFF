"""FIX: guarded web-only receipt release; no API, database, APK or compose changes."""
import fcntl,hashlib,json,pathlib,shutil,subprocess,sys,time,urllib.request
ROOT=pathlib.Path('/opt/logoff-wms-releases/billing-receipt-loading-20261005')
SLUG='billing-receipt-loading-20261005'
CF=pathlib.Path('/opt/logoff-wms/wms/infra/docker-compose.yml')
COMPOSE=['docker','compose','--project-name','infra','--env-file','/opt/logoff-wms/wms/.env','-f',str(CF)]
def run(*a):return subprocess.check_output(a,text=True).strip()
def sha(data):return hashlib.sha256(data).hexdigest()
def image(name):return run('docker','inspect','--format','{{.Image}}',name)
def hashes(container,folder):return {line.split('  ',1)[1][len(folder)+1:]:line.split('  ',1)[0] for line in run('docker','exec',container,'find',folder,'-type','f','-exec','sha256sum','{}',';').splitlines()}
def verify(before,after,allowed):
 if set(before)-set(after) or {name for name,digest in after.items() if before.get(name)!=digest}!=set(allowed):raise RuntimeError('Unexpected web runtime delta')
 if any(after.get(name)!=digest for name,digest in allowed.items()):raise RuntimeError('Web checksum mismatch')
def public_hashes(allowed):
 for name,digest in allowed.items():
  with urllib.request.urlopen('https://wms.logoff.pro/'+('' if name=='index.html' else name),timeout=20) as response:
   if response.status!=200 or sha(response.read())!=digest:raise RuntimeError('Public content mismatch '+name)
def health():
 for attempt in range(25):
  try:
   with urllib.request.urlopen('https://wms.logoff.pro/api/v1/health',timeout=5) as response:
    if response.status==200:return
  except Exception:pass
  time.sleep(1)
 raise RuntimeError('Health failed')
def main():
 manifest=json.loads((ROOT/'manifest.json').read_text());proof=json.loads((ROOT/'web/proof.json').read_text())
 bases={name:item['image'] for name,item in manifest['containers'].items()}
 with open('/opt/logoff-wms/.release.lock','a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  for name,digest in bases.items():
   if image(name)!=digest:raise RuntimeError('Production changed; fresh baseline required: '+name)
  before=hashes('infra-web-1','/usr/share/nginx/html')
  if before!=manifest['artifacts']['web-runtime.tar.gz']['files']:raise RuntimeError('Web baseline file drift')
  api_before=hashes('infra-api-1','/app/apps/api/dist')
  if api_before!=manifest['artifacts']['api-runtime.tar.gz']['files']:raise RuntimeError('API baseline file drift')
  if before['index.html']!=proof['indexBeforeSha']:raise RuntimeError('Entry point drift')
  for item in proof['files'].values():
   if before.get('assets/'+item['original'])!=item['originalSha256']:raise RuntimeError('Active graph drift')
  untouched={name:run('docker','inspect','--format','{{.Id}}',name) for name in bases if name!='infra-web-1'}
  allowed={'index.html':proof['indexAfterSha'],**{'assets/'+name:item['sha256'] for name,item in proof['files'].items()}}
  payload=ROOT/'web-payload';payload.mkdir(exist_ok=True)
  for name,digest in allowed.items():
   source=ROOT/'web'/name.removeprefix('assets/')
   if sha(source.read_bytes())!=digest:raise RuntimeError('Upload mismatch '+name)
   target=payload/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
  dockerfile=ROOT/'Dockerfile.web';dockerfile.write_text('FROM '+bases['infra-web-1']+'\nCOPY web-payload/ /usr/share/nginx/html/\n')
  subprocess.run(['docker','build','--network','none','-f',str(dockerfile),'-t','logoff-web:'+SLUG,str(ROOT)],check=True)
  candidate=run('docker','create','--network','none','--entrypoint','sh','logoff-web:'+SLUG,'-c','sleep 300')
  try:run('docker','start',candidate);verify(before,hashes(candidate,'/usr/share/nginx/html'),allowed)
  finally:run('docker','rm','-f',candidate)
  run('docker','tag',bases['infra-web-1'],'logoff-web:before-'+SLUG)
  if '--prepare-only' in sys.argv:print('PREPARED: candidate verified; production unchanged');return
  compose_before=CF.read_bytes()
  try:
   run('docker','tag','logoff-web:'+SLUG,'infra-web')
   subprocess.run(COMPOSE+['up','-d','--no-deps','--no-build','--pull','never','--force-recreate','web'],check=True)
   health();verify(before,hashes('infra-web-1','/usr/share/nginx/html'),allowed);public_hashes(allowed)
   # Download checks preserve the Android update shipped by another chat.
   public_hashes({name:digest for name,digest in before.items() if name.startswith('downloads/')})
   if hashes('infra-api-1','/app/apps/api/dist')!=api_before:raise RuntimeError('API files changed')
   for name,identity in untouched.items():
    if run('docker','inspect','--format','{{.Id}}',name)!=identity:raise RuntimeError('Unrelated container restarted '+name)
   if CF.read_bytes()!=compose_before:raise RuntimeError('Compose changed')
  except Exception:
   run('docker','tag',bases['infra-web-1'],'infra-web')
   subprocess.run(COMPOSE+['up','-d','--no-deps','--no-build','--pull','never','--force-recreate','web'],check=True)
   health()
   if hashes('infra-web-1','/usr/share/nginx/html')!=before:raise RuntimeError('Rollback verification failed')
   raise
  result={'api':image('infra-api-1'),'web':image('infra-web-1'),'webChunksAdded':len(proof['files']),'preservedWebFiles':len(before)-1,'apiUnchanged':True,'otherContainersUnchanged':True,'downloadsUnchanged':True,'noBusinessWrites':True,'sourceParityVerified':False}
  (ROOT/'published.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':main()
