"""FIX: deploy a pinned additive FBO overlay with hashes, release lock and rollback."""
import fcntl,hashlib,json,pathlib,shutil,subprocess,sys,time,urllib.request,re
ROOT=pathlib.Path('/opt/logoff-wms-releases/fbo-processing-20261005');SLUG='fbo-processing-20261005'
CF=pathlib.Path('/opt/logoff-wms/wms/infra/docker-compose.yml');ENV=pathlib.Path('/opt/logoff-wms/wms/.env')
COMPOSE=['docker','compose','--project-name','infra','--env-file',str(ENV),'-f',str(CF)]
def run(*args):return subprocess.check_output(args,text=True).strip()
def sha(data):return hashlib.sha256(data).hexdigest()
def image(name):return run('docker','inspect','--format','{{.Image}}',name)
def hashes(cid,folder):return{line.split('  ',1)[1][len(folder)+1:]:line.split('  ',1)[0] for line in run('docker','exec',cid,'find',folder,'-type','f','-exec','sha256sum','{}',';').splitlines()}
def verify(before,after,allowed):
 if set(before)-set(after) or {n for n,d in after.items() if before.get(n)!=d}!=set(allowed) or any(after.get(n)!=d for n,d in allowed.items()):raise RuntimeError('Unexpected runtime delta')
def health():
 for _ in range(35):
  try:
   with urllib.request.urlopen('https://wms.logoff.pro/api/v1/health',timeout=5) as response:
    if response.status==200:return
  except Exception:pass
  time.sleep(1)
 raise RuntimeError('API health failed')
def public(allowed):
 for n,d in allowed.items():
  with urllib.request.urlopen('https://wms.logoff.pro/'+n,timeout=20) as response:
   if response.status!=200 or sha(response.read())!=d:raise RuntimeError('Public hash mismatch '+n)
def main():
 manifest=json.loads((ROOT/'manifest.json').read_text());wp=json.loads((ROOT/'web/proof.json').read_text());ap=json.loads((ROOT/'api-proof.json').read_text());bases={n:v['image'] for n,v in manifest['containers'].items()}
 with open('/opt/logoff-wms/.release.lock','a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  for n,d in bases.items():
   if image(n)!=d:raise RuntimeError('Fresh runtime capture required: '+n)
  before={k:hashes('infra-'+k+'-1',folder) for k,folder in [('api','/app/apps/api/dist'),('web','/usr/share/nginx/html')]}
  for k in before:
   if before[k]!=manifest['artifacts'][k+'-runtime.tar.gz']['files']:raise RuntimeError('Baseline file drift '+k)
  allowed={'api':{n:v['sha256'] for n,v in ap['files'].items()},'web':{'index.html':wp['indexAfterSha'],**{'assets/'+n:v['sha256'] for n,v in wp['files'].items()}}}
  for k in ['api','web']:
   payload=ROOT/(k+'-payload');payload.mkdir(exist_ok=True)
   for n,d in allowed[k].items():
    source=ROOT/k/(n.removeprefix('assets/') if k=='web' else n)
    if sha(source.read_bytes())!=d:raise RuntimeError('Upload mismatch '+n)
    target=payload/n;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
   folder='/app/apps/api/dist/' if k=='api' else '/usr/share/nginx/html/'
   df=ROOT/('Dockerfile.'+k);df.write_text('FROM '+bases['infra-'+k+'-1']+'\nCOPY '+k+'-payload/ '+folder+'\n')
   subprocess.run(['docker','build','--network','none','-f',str(df),'-t','logoff-'+k+':'+SLUG,str(ROOT)],check=True)
   cid=run('docker','create','--network','none','--entrypoint','sh','logoff-'+k+':'+SLUG,'-c','sleep 300')
   try:
    run('docker','start',cid);verify(before[k],hashes(cid,folder.rstrip('/')),allowed[k])
    if k=='api':
     run('docker','cp',str(ROOT/'runtime-check.cjs'),cid+':/tmp/fbo-runtime-check.cjs');print(run('docker','exec','--workdir','/app/apps/api',cid,'node','/tmp/fbo-runtime-check.cjs'))
   finally:run('docker','rm','-f',cid)
   run('docker','tag',bases['infra-'+k+'-1'],'logoff-'+k+':before-'+SLUG)
  if '--prepare-only' in sys.argv:print('PREPARED: API/web candidate hashes and runtime fixtures verified; production unchanged');return
  untouched={n:run('docker','inspect','--format','{{.Id}}',n) for n in bases if n not in ['infra-api-1','infra-web-1']};compose_before=CF.read_bytes();env_before=ENV.read_bytes()
  key=b'WMS_FBO_PROCESSING_PRICING_ENABLED';pattern=rb'(?m)^'+key+rb'=[^\r\n]*';matches=re.findall(pattern,env_before)
  if len(matches)>1:raise RuntimeError('Duplicate FBO flag')
  env_after=re.sub(pattern,key+b'=true',env_before) if matches else env_before+(b'' if env_before.endswith(b'\n') else b'\n')+key+b'=true\n'
  run('docker','cp',str(ROOT/'migration.sql'),'infra-api-1:/tmp/fbo-migration.sql');run('docker','cp',str(ROOT/'migrate.cjs'),'infra-api-1:/tmp/fbo-migrate.cjs');print(run('docker','exec','--workdir','/app/apps/api','infra-api-1','node','/tmp/fbo-migrate.cjs','/tmp/fbo-migration.sql'))
  try:
   if ENV.read_bytes()!=env_before:raise RuntimeError('Environment changed before flag activation')
   ENV.write_bytes(env_after)
   for k in ['api','web']:run('docker','tag','logoff-'+k+':'+SLUG,'infra-'+k)
   subprocess.run(COMPOSE+['up','-d','--no-deps','--no-build','--pull','never','--force-recreate','api','web'],check=True)
   health()
   for k,folder in [('api','/app/apps/api/dist'),('web','/usr/share/nginx/html')]:verify(before[k],hashes('infra-'+k+'-1',folder),allowed[k])
   public(allowed['web']);public({n:d for n,d in before['web'].items() if n.startswith('downloads/')})
   for n,identity in untouched.items():
    if run('docker','inspect','--format','{{.Id}}',n)!=identity:raise RuntimeError('Unrelated container changed '+n)
   if CF.read_bytes()!=compose_before:raise RuntimeError('Compose changed')
   flag=run('docker','exec','infra-api-1','node','-e','process.stdout.write(String(process.env.WMS_FBO_PROCESSING_PRICING_ENABLED))')
   if flag!='true':raise RuntimeError('FBO flag is not enabled')
  except Exception:
   if ENV.read_bytes()==env_after:ENV.write_bytes(env_before)
   else:raise RuntimeError('Environment drift prevents automatic flag rollback')
   for k in ['api','web']:run('docker','tag',bases['infra-'+k+'-1'],'infra-'+k)
   subprocess.run(COMPOSE+['up','-d','--no-deps','--no-build','--pull','never','--force-recreate','api','web'],check=True);health()
   for k,folder in [('api','/app/apps/api/dist'),('web','/usr/share/nginx/html')]:
    if hashes('infra-'+k+'-1',folder)!=before[k]:raise RuntimeError('Rollback mismatch '+k)
   raise
  result={'api':image('infra-api-1'),'web':image('infra-web-1'),'apiFiles':len(allowed['api']),'webChunksAdded':len(wp['files']),'downloadsUnchanged':True,'otherContainersUnchanged':True,'sourceParityVerified':False,'legacyPricesMigrated':False,'fboPricingEnabled':True};(ROOT/'published.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':main()
