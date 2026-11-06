"""FIX: exact own-WMS API/web overlay with drift checks and rollback."""
from pathlib import Path
import subprocess,json,hashlib,fcntl,sys,time
R=Path('/opt/wms-restore/releases/stock-export-20261106');C=Path('/opt/wms-restore/compose.json')
BASE={'api':'sha256:919ffad45bba3ca5f996d91009f9fb6be9b4f8d30f76a21d03af93bc604a2f27','web':'sha256:72b175810d525d1099fc5ed879b149bf44c542bc4b3e9f7d16531abcefee1e89'}
ROOT={'api':'/app/apps/api/dist','web':'/usr/share/nginx/html'}
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def sha(b):return hashlib.sha256(b).hexdigest()
def img(k):return d('inspect','wms-local-'+k,'--format','{{.Image}}')
def files(image,root):return {n:h for h,n in (l.split(None,1) for l in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find '+root+' -type f -exec sha256sum {} +').splitlines())}
if sys.argv[-1]=='stage':
 assert all(img(k)==v for k,v in BASE.items())
 assert json.loads((R/'turnover-browser-proof.json').read_text())['passed']==3
 proof={'composeHash':sha(C.read_bytes()),'images':{},'hashes':{}}
 for k in BASE:
  folder='payload' if k=='api' else 'web-payload'
  dockerfile=R/('Dockerfile.'+k);dockerfile.write_text('FROM '+BASE[k]+'\nCOPY '+folder+'/ '+ROOT[k]+'/\n')
  tag='wms-local-'+k+':stock-export-20261106';d('build','--network','none','-q','-f',str(dockerfile),'-t',tag,str(R))
  candidate=d('image','inspect',tag,'--format','{{.Id}}');a,b=files(BASE[k],ROOT[k]),files(candidate,ROOT[k])
  expected={ROOT[k]+'/'+p.relative_to(R/folder).as_posix() for p in (R/folder).rglob('*') if p.is_file()}
  assert len(expected)==2 and set(a)<=set(b) and {n for n in b if a.get(n)!=b[n]}==expected
  proof['images'][k]=candidate;proof['hashes'][k]={n:b[n] for n in expected}
 (R/'stage.json').write_text(json.dumps(proof));print('Exact API2/web2 staged')
else:
 locks=[]
 for n in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  f=open(n,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 p=json.loads((R/'stage.json').read_text());pr=json.loads((R/'pr.json').read_text())
 assert pr['state']=='MERGED' and pr['headRefName']=='fix/lukin-full-stock-export' and pr['baseRefName']=='feature/la_panthera'
 assert all(img(k)==v for k,v in BASE.items()) and sha(C.read_bytes())==p['composeHash']
 old=C.read_bytes();(R/'compose.before.json').write_bytes(old);cfg=json.loads(old)
 env={k:json.loads(d('inspect','wms-local-'+k))[0]['Config']['Env'] for k in BASE}
 others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n not in ['wms-local-api','wms-local-web']}
 for k,v in p['images'].items():cfg['services'][k]['image']=v
 def start():d('compose','-f',str(C),'up','-d','--no-deps','--no-build','--pull','never','api','web')
 try:
  C.write_text(json.dumps(cfg,indent=2));start()
  for i in range(45):
   try:
    d('exec','wms-local-api','node','-e',"fetch('http://127.0.0.1:3000/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))");break
   except subprocess.CalledProcessError:
    if i==44:raise
    time.sleep(1)
  d('exec','wms-local-web','wget','-qO-','http://127.0.0.1/')
  for k in BASE:
   assert img(k)==p['images'][k] and sorted(env[k])==sorted(json.loads(d('inspect','wms-local-'+k))[0]['Config']['Env'])
   for n,h in p['hashes'][k].items():assert d('exec','wms-local-'+k,'sha256sum',n).split()[0]==h
  assert all(d('inspect',n,'--format','{{.Id}}')==v for n,v in others.items())
 except Exception:
  C.write_bytes(old);start();raise
 (R/'published.json').write_text(json.dumps({'pr':pr['number'],**p}));print('Published; health, hashes, environment and other containers verified')
