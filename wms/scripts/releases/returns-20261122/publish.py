"""Own WMS only: pinned images, additive migration, rollback and exact env checks."""
from pathlib import Path
import subprocess,json,sys,hashlib,time,fcntl
r=Path(sys.argv[1]);apply='--publish' in sys.argv[2:];compose=Path('/opt/wms-restore/compose.json')
def run(*a):return subprocess.check_output(a,text=True).strip()
def docker(*a):return run('docker',*a)
def image(n):return docker('inspect',n,'--format','{{.Image}}')
def env(n):return dict(x.split('=',1) for x in json.loads(docker('inspect',n,'--format','{{json .Config.Env}}')))
def node(code):
 return subprocess.check_output(['docker','exec','-i','wms-local-api','node'],input="const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{"+code+"})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());",text=True).strip()
def health():
 for _ in range(45):
  if subprocess.run(['curl','-fsS','--max-time','3','https://wms.logoff.pro/api/v1/health'],capture_output=True).returncode==0:return
  time.sleep(1)
 raise RuntimeError('API health failed')
locks=[]
for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/opt/wms-restore/.release-pr863.lock','/run/logoff-wms-web-release.lock']:
 f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
base=json.loads((r/'base.json').read_text());stage=json.loads((r/'stage.json').read_text());proof=json.loads((r/'isolated-proof.json').read_text())
assert image('wms-local-api')==base['baseApi'] and image('wms-local-web')==base['baseWeb']
assert proof['fullApiHealth'] and proof['image']==stage['images']['api']
assert stage['allHashesVerified']
old=compose.read_bytes();config=json.loads(old);oldenv={n:env(n) for n in ['wms-local-api','wms-local-web']}
other={n:docker('inspect',n,'--format','{{.Id}}') for n in docker('ps','--format','{{.Names}}').splitlines() if n not in oldenv}
health()
assert node("console.log(JSON.stringify(await p.$queryRawUnsafe(\"SELECT to_regclass('public.\\\"ReturnBatch\\\"')::text AS name\")))")=='[{"name":null}]'
if not apply:print('Release preflight passed');sys.exit()
pr=json.loads((r/'pr.json').read_text());assert pr['state']=='MERGED' and pr['headRefName']=='feature/returns-processing' and pr['baseRefName']=='feature/la_panthera'
assert not (r/'published.json').exists()
(r/'compose.before.json').write_bytes(old);(r/'compose.before.json').chmod(0o600)
sql=(r/'migration.sql').read_text();checksum=hashlib.sha256(sql.encode()).hexdigest()
def start():docker('compose','-f',str(compose),'up','-d','--no-deps','--no-build','--pull','never','api','web')
# FIX: schema changes and migration record commit atomically; there are no stock inserts here.
node('await p.$transaction(async tx=>{for(const sql of '+json.dumps([s.strip() for s in sql.split(';') if s.strip()])+'){await tx.$executeRawUnsafe(sql);}await tx.$executeRawUnsafe(`INSERT INTO "_prisma_migrations" (id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES ($1,$2,NOW(),$3,NOW(),1)`,require("crypto").randomUUID(),'+json.dumps(checksum)+',"20261122_returns_processing");});console.log("Migration committed");')
try:
 config['services']['api']['image']=stage['images']['api'];config['services']['web']['image']=stage['images']['web']
 config['services']['api']['environment']['WMS_RETURNS_PROCESSING_ENABLED']='true'
 compose.write_text(json.dumps(config,indent=2));start();health()
 assert image('wms-local-api')==stage['images']['api'] and image('wms-local-web')==stage['images']['web']
 assert env('wms-local-api')=={**oldenv['wms-local-api'],'WMS_RETURNS_PROCESSING_ENABLED':'true'}
 assert env('wms-local-web')==oldenv['wms-local-web']
 assert all(docker('inspect',n,'--format','{{.Id}}')==v for n,v in other.items())
 assert node('console.log(await p.returnBatch.count())')=='0'
 assert node('console.log(await p.returnUnit.count())')=='0'
 for path in ['index.html','assets/returns-20261122.js','assets/returns-20261122.css']:
  local=(r/'web'/path).read_bytes();public=subprocess.check_output(['curl','-fsS','--max-time','20','https://wms.logoff.pro/'+('' if path=='index.html' else path)])
  assert hashlib.sha256(local).digest()==hashlib.sha256(public).digest(),path
except Exception:
 compose.write_bytes(old);start();health();raise
result=dict(pr=pr['number'],images=stage['images'],health=True,otherContainersUnchanged=True,onlyNewFlag=True,noProductionReturnsCreated=True,migration='20261122_returns_processing')
(r/'published.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
