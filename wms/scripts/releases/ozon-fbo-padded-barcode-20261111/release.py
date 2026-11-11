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
if mode=='capture':
 baseline=image('api')
 (R/'base.json').write_text(json.dumps({'api':baseline,'composeHash':sha(C.read_bytes())}))
 (R/'base-hashes.json').write_text(json.dumps({'api':hashes(baseline,'api')}))
 sys.exit()
capture=json.loads((R/'base.json').read_text())
base={'api':capture['api']}
module='modules/client-requests/ozon-fbo-import.service.js'
if mode=='stage':
 assert all(image(s)==v for s,v in base.items())
 assert sha(C.read_bytes())==capture['composeHash']
 source=docker('exec','wms-local-api','cat','/app/apps/api/dist/'+module)
 before_lookup='        const matches = await this.db.barcode.findMany({ where: { value: { in: [...new Set(parsed.map(l => l.barcode))] }, sku: { clientId: dto.clientId } }, include: { sku: true } });'
 after_lookup='''        const alternateBarcode = (value) => /^0[0-9]{13}$/.test(value) ? value.slice(1)
            : /^[0-9]{13}$/.test(value) ? `0${value}` : value;
        const values = [...new Set(parsed.flatMap(({ barcode }) => [barcode, alternateBarcode(barcode)]))];
        const matches = await this.db.barcode.findMany({ where: { value: { in: values }, sku: { clientId: dto.clientId } }, include: { sku: true } });'''
 before_filter='            const found = matches.filter(m => m.value === line.barcode);'
 after_filter='''            const alternate = alternateBarcode(line.barcode);
            const found = matches.filter(m => m.value === line.barcode || m.value === alternate);'''
 for old,new in [(before_lookup,after_lookup),(before_filter,after_filter)]:
  assert source.count(old)==1,old
  source=source.replace(old,new)
 target=R/'api-payload'/module
 target.parent.mkdir(parents=True,exist_ok=True)
 target.write_text(source+'\n')
 before=json.loads((R/'base-hashes.json').read_text());result={'base':base,'images':{},'changes':{},'composeHash':sha(C.read_bytes())}
 for service in ['api']:
  prefix='/app/apps/api/dist/'if service=='api'else'/usr/share/nginx/html/'
  (R/('Dockerfile.'+service)).write_text('FROM '+base[service]+'\nCOPY '+service+'-payload/ '+prefix+'\n')
  tag='wms-local-'+service+':ozon-fbo-padded-barcode-20261111'
  docker('build','--network','none','-q','-t',tag,'-f',str(R/('Dockerfile.'+service)),str(R));new=docker('image','inspect',tag,'--format','{{.Id}}');actual=hashes(new,service)
  expected={module};changed={n for n in actual if before[service].get(n)!=actual[n]}
  assert set(before[service])<=set(actual) and changed==expected,(service,changed,expected)
  result['images'][service]=new;result['changes'][service]={n:actual[n]for n in changed}
 docker('run','--rm','--network','none','-w','/app/apps/api','--entrypoint','node',result['images']['api'],'-e',"require('./dist/modules/client-requests/ozon-fbo-import.service');console.log('Module load OK')")
 (R/'stage.json').write_text(json.dumps(result));print('Stage PASS: API1; all other bytes retained')
elif mode=='preview':
 stage=json.loads((R/'stage.json').read_text())
 # Use production network and credentials solely for the guarded read-only preview.
 options=json.loads(docker('inspect','wms-local-api','--format','{{json .Config.Env}}'))
 child_env=dict(__import__('os').environ)
 for entry in options:
  key,_,value=entry.partition('=')
  if key=='DATABASE_URL' or key.startswith('WMS_'):child_env[key]=value
 command=['docker','run','--rm','-i','--network','container:wms-local-api',*[arg for key in child_env if key=='DATABASE_URL' or key.startswith('WMS_') for arg in ('-e',key)],'-w','/app/apps/api','--entrypoint','node',stage['images']['api'],'-']
 result=subprocess.check_output(command,input=(R/'preview.cjs').read_text(),text=True,env=child_env)
 print(result.strip())
 (R/'preview-proof.json').write_text(json.dumps(json.loads(result)))
elif mode=='publish':
 locks=[]
 for n in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  Path(n).parent.mkdir(parents=True,exist_ok=True);f=open(n,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 stage=json.loads((R/'stage.json').read_text());pr=json.loads((R/'pr.json').read_text());assert pr['state']=='MERGED'and pr['baseRefName']=='feature/la_panthera'and pr['headRefName']=='fix/ozon-fbo-padded-barcode'
 assert json.loads((R/'preview-proof.json').read_text())['totalQuantity']>0;assert all(image(s)==v for s,v in base.items());assert sha(C.read_bytes())==stage['composeHash']
 old=C.read_bytes();(R/'compose.before.json').write_bytes(old);config=json.loads(old);environment={s:env(s)for s in base};others={n:docker('inspect',n,'--format','{{.Id}}')for n in docker('ps','--format','{{.Names}}').splitlines()if n not in ['wms-local-api']}
 def start(s):docker('compose','-f',str(C),'up','-d','--no-deps','--no-build','--pull','never',s)
 try:
  for s in base:config['services'][s]['image']=stage['images'][s]
  C.write_text(json.dumps(config,indent=2));start('api');health()
  for s in base:
   assert image(s)==stage['images'][s] and env(s)==environment[s]
   assert hashes(image(s),s)=={**json.loads((R/'base-hashes.json').read_text())[s],**stage['changes'][s]}
  assert all(docker('inspect',n,'--format','{{.Id}}')==v for n,v in others.items())
 except Exception:
  C.write_bytes(old);start('api');health();raise
 (R/'published.json').write_text(json.dumps({**stage,'pr':pr['number'],'health':True,'environmentUnchanged':True,'otherContainersUnchanged':True}));print('Published: hashes, health, environment and other containers verified')
else:raise ValueError(mode)

