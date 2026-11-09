"""Guarded API/web overlay release. No schema or warehouse data writes."""
from pathlib import Path
import sys,json,subprocess,hashlib,time,fcntl
R=Path(sys.argv[1]);mode=sys.argv[2];C=Path('/opt/wms-restore/compose.json')
def docker(*args):return subprocess.check_output(['docker',*args],text=True).strip()
def sha(data):return hashlib.sha256(data).hexdigest()
def image(s):return docker('inspect','wms-local-'+s,'--format','{{.Image}}')
def env(s):return sha(json.dumps(sorted(json.loads(docker('inspect','wms-local-'+s,'--format','{{json .Config.Env}}')))).encode())
def hashes(img,service):
 prefix='/app/apps/api/dist/'if service=='api'else'/usr/share/nginx/html/'
 raw=docker('run','--rm','--network','none','--entrypoint','sh',img,'-c','find '+prefix+' -type f -exec sha256sum {} +')
 return{line.split(None,1)[1][len(prefix):]:line.split(None,1)[0]for line in raw.splitlines()}
def health():
 for _ in range(40):
  if subprocess.run(['docker','exec','wms-local-api','node','-e',"fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{if(!r.ok||(await r.json()).status!=='ok')throw Error()}).catch(()=>process.exit(1))"],capture_output=True).returncode==0:return
  time.sleep(1)
 raise RuntimeError('API health failed')
base={line.split()[0].replace('/wms-local-',''):line.split()[1]for line in(R/'images.txt').read_text().splitlines()}
if mode=='stage':
 assert all(image(s)==v for s,v in base.items())
 proof=json.loads((R/'browser-proof.json').read_text());assert all(proof.values())
 before=json.loads((R/'base-hashes.json').read_text());result={'base':base,'images':dict(base),'changes':{'web':{}},'composeHash':sha(C.read_bytes())}
 for service in ['api']:
  prefix='/app/apps/api/dist/'if service=='api'else'/usr/share/nginx/html/'
  (R/('Dockerfile.'+service)).write_text('FROM '+base[service]+'\nCOPY '+service+'-payload/ '+prefix+'\n')
  tag='wms-local-'+service+':pvz-loss-priority-20261109'
  docker('build','--network','none','-q','-t',tag,'-f',str(R/('Dockerfile.'+service)),str(R));new=docker('image','inspect',tag,'--format','{{.Id}}');actual=hashes(new,service)
  expected=set(json.loads((R/(service+'-changes.json')).read_text()));changed={n for n in actual if before[service].get(n)!=actual[n]}
  assert set(before[service])<=set(actual) and changed==expected and len(changed)==2,(service,changed,expected)
  result['images'][service]=new;result['changes'][service]={n:actual[n]for n in changed}
 docker('run','--rm','--network','none','-w','/app/apps/api','--entrypoint','node',result['images']['api'],'-e',"require('./dist/modules/marketplace-connections/marketplace-connections.module');console.log('Module load OK')")
 docker('run','--rm','--network','none','-v',str(R/'priority.test.cjs')+':/tmp/runtime.test.cjs:ro','--entrypoint','node',result['images']['api'],'/tmp/runtime.test.cjs','/app/apps/api/dist')
 (R/'stage.json').write_text(json.dumps(result));print('Stage PASS: exact API2/web0, module loading, all other files retained')
elif mode=='publish':
 locks=[]
 for n in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  Path(n).parent.mkdir(parents=True,exist_ok=True);f=open(n,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 stage=json.loads((R/'stage.json').read_text());pr=json.loads((R/'pr.json').read_text());assert pr['state']=='MERGED'and pr['baseRefName']=='feature/la_panthera'and pr['headRefName']=='fix/record-pvz-loss-release'
 assert json.loads((R/'browser-proof.json').read_text())['priority4'];assert all(image(s)==v for s,v in base.items());assert sha(C.read_bytes())==stage['composeHash']
 savedEnvs={s:dict(x.split('=',1)for x in json.loads(docker('inspect','wms-local-'+s,'--format','{{json .Config.Env}}'))) for s in base}
 old=C.read_bytes();(R/'compose.before.json').write_bytes(old);config=json.loads(old);environment={s:env(s)for s in base};others={n:docker('inspect',n,'--format','{{.Id}}')for n in docker('ps','--format','{{.Names}}').splitlines()if n not in ['wms-local-api','wms-local-web']}
 def start(s):docker('compose','-f',str(C),'up','-d','--no-deps','--no-build','--pull','never',s)
 try:
  for s in base:config['services'][s]['image']=stage['images'][s]
  originalEnv=config['services']['api'].get('environment',{})
  assert isinstance(originalEnv,dict)
  originalEnv['WMS_FBS_PVZ_LOSS_SETTLEMENT_ENABLED']='true'
  C.write_text(json.dumps(config,indent=2));start('api');health();start('web')
  for s in base:
   assert image(s)==stage['images'][s]
   actualEnv=dict(x.split('=',1)for x in json.loads(docker('inspect','wms-local-'+s,'--format','{{json .Config.Env}}')))
   assert actualEnv=={**savedEnvs[s],**({'WMS_FBS_PVZ_LOSS_SETTLEMENT_ENABLED':'true'} if s=='api' else {})}
   assert hashes(image(s),s)=={**json.loads((R/'base-hashes.json').read_text())[s],**stage['changes'][s]}
  assert all(docker('inspect',n,'--format','{{.Id}}')==v for n,v in others.items())
 except Exception:
  C.write_bytes(old);start('api');health();start('web');raise
 (R/'published.json').write_text(json.dumps({**stage,'pr':pr['number'],'health':True,'environmentPreservedExceptApprovedPurposeFlag':True,'otherContainersUnchanged':True}));print('Published: hashes, health, environment and other containers verified')
else:raise ValueError(mode)
