"""FIX: guarded own-WMS release after merged PR and exact runtime checks."""
from pathlib import Path
import subprocess,json,sys,hashlib,time,fcntl
r=Path(sys.argv[1]);mode=sys.argv[2];compose=Path('/opt/wms-restore/compose.json')
def docker(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def sha(b):return hashlib.sha256(b).hexdigest()
def image(n):return docker('inspect',n,'--format','{{.Image}}')
def node(script):
 return json.loads(subprocess.check_output(['docker','exec','-i','wms-local-api','node'],input="const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{"+script+"})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());",text=True))
def health():
 for _ in range(40):
  if subprocess.run(['docker','exec','wms-local-api','node','-e',"fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{if(!r.ok||(await r.json()).status!=='ok')throw Error()}).catch(()=>process.exit(1))"],capture_output=True).returncode==0:return
  time.sleep(1)
 raise RuntimeError('API health failed')
stage=json.loads((r/'stage.json').read_text());flags=['WMS_FBS_ACTION_STATUS_ENABLED','WMS_MARKET_STATUS_SCHEDULE_ENABLED']
if mode=='preflight':
 assert image('wms-local-api')==stage['base']
 clients=node("const c=await p.client.findMany({where:{code:{in:['00-00000039','CL-000006']}},select:{id:true,code:true,name:true,isDemo:true}});console.log(JSON.stringify(c));")
 assert len(clients)==2 and all(not c['isDemo'] for c in clients)
 assert any('Бушков' in c['name'] for c in clients) and any('Хрупов' in c['name'] for c in clients)
 keys=['fbs.action-status.v1:'+c['id'] for c in clients]
 settings=node('console.log(JSON.stringify(await p.systemSetting.findMany({where:{key:{in:'+json.dumps(keys)+'}}})));')
 env=json.loads(docker('inspect','wms-local-api','--format','{{json .Config.Env}}'));env=dict(v.split('=',1)for v in env)
 assert env.get('WMS_FBS_REQUEST_AUTO_STATUS_ENABLED')=='true'
 assert env.get('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED')=='true'
 assert env.get('WMS_REQUEST_MARKET_STATUS_MANUAL_ENABLED')=='true'
 other={n:docker('inspect',n,'--format','{{.Id}}')for n in docker('ps','--format','{{.Names}}').splitlines()if n!='wms-local-api'}
 (r/'preflight.json').write_text(json.dumps({'composeHash':sha(compose.read_bytes()),'settings':settings,'keys':keys,'other':other,'environment':env}));(r/'preflight.json').chmod(0o600)
 print('PASS own client policies and release prerequisites')
elif mode=='publish':
 locks=[]
 for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  Path(name).parent.mkdir(parents=True,exist_ok=True);f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 pre=json.loads((r/'preflight.json').read_text());pr=json.loads((r/'pr.json').read_text());isolated=json.loads((r/'isolated-proof.json').read_text())
 assert pr['state']=='MERGED' and pr['baseRefName']=='feature/la_panthera' and pr['headRefName']=='fix/fbs-action-status-and-marketplace-schedule'
 assert isolated['fullApiHealth'] and isolated['databaseChecks'] and isolated['image']==stage['images']['api']
 assert stage['allHashesVerified'] and image('wms-local-api')==stage['base'] and sha(compose.read_bytes())==pre['composeHash']
 docker('run','--rm','--network','none','-e','NODE_PATH=/app/apps/api/node_modules','-v',str(r/'runtime.cjs')+':/test.cjs:ro','--entrypoint','node',stage['images']['api'],'/test.cjs')
 old=compose.read_bytes();(r/'compose.before.json').write_bytes(old);(r/'compose.before.json').chmod(0o600)
 def start():docker('compose','-f',str(compose),'up','-d','--no-deps','--no-build','--pull','never','api')
 try:
  node('await p.$transaction(async tx=>{for(const key of '+json.dumps(pre['keys'])+'){const old=await tx.systemSetting.findUnique({where:{key}});const value={...(old?.value??{}),startOnRibbon:true};await tx.systemSetting.upsert({where:{key},create:{key,value},update:{value}});}});console.log(JSON.stringify({configured:true}));')
  config=json.loads(old);svc=config['services']['api'];svc['image']=stage['images']['api'];env=svc.setdefault('environment',{})
  assert isinstance(env,dict),'Expected explicit compose environment mapping'
  for key in flags:env[key]='true'
  compose.write_text(json.dumps(config,indent=2));start();health()
  actual=dict(v.split('=',1)for v in json.loads(docker('inspect','wms-local-api','--format','{{json .Config.Env}}')))
  assert actual=={**pre['environment'],**dict.fromkeys(flags,'true')}
  assert image('wms-local-api')==stage['images']['api']
  assert all(docker('inspect',n,'--format','{{.Id}}')==v for n,v in pre['other'].items())
 except Exception:
  compose.write_bytes(old);start();health()
  node('await p.$transaction(async tx=>{await tx.systemSetting.deleteMany({where:{key:{in:'+json.dumps(pre['keys'])+'}}});for(const s of '+json.dumps(pre['settings'])+'){await tx.systemSetting.create({data:{key:s.key,value:s.value}});}});console.log(JSON.stringify({restored:true}));')
  raise
 (r/'published.json').write_text(json.dumps({'pr':pr['number'],'image':stage['images']['api'],'health':True,'otherContainersUnchanged':True,'enabledFlags':flags}));print('Published and verified',stage['images']['api'])
else:raise ValueError(mode)
