from pathlib import Path
import subprocess,json,fcntl,hashlib,sys,time
R=Path(sys.argv[1]);C=Path('/opt/wms-restore/compose.json');base='sha256:285752ab966bb220e4b98232677616cec6ae790064d6246854cd18155fb8dee0';api='sha256:5ad42574bb9dc1c15dd806badd982fdf5a0f4e1fd928cfc71588a9514eebed62'
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def sha(b):return hashlib.sha256(b).hexdigest()
def files(img):return {n:h for h,n in (l.split(None,1) for l in d('run','--rm','--network','none','--entrypoint','sh',img,'-c','find /usr/share/nginx/html -type f -exec sha256sum {} +').splitlines())}
if sys.argv[-1]=='stage':
 assert d('inspect','wms-local-web','--format','{{.Image}}')==base
 assert d('inspect','wms-local-api','--format','{{.Image}}')==api
 assert json.loads((R/'browser-proof.json').read_text())['passed']==8
 (R/'Dockerfile').write_text('FROM '+base+'\nCOPY web-payload/ /usr/share/nginx/html/\n')
 d('build','--network','none','-q','-t','wms-local-web:ozon-inbound-893',str(R));candidate=d('image','inspect','wms-local-web:ozon-inbound-893','--format','{{.Id}}')
 a,b=files(base),files(candidate);expected={'/usr/share/nginx/html/'+n for n in json.loads((R/'web-changes.json').read_text())}
 assert set(a)<=set(b);assert {n for n in b if a.get(n)!=b[n]}==expected
 (R/'stage.json').write_text(json.dumps({'base':base,'candidate':candidate,'hashes':{n:b[n] for n in expected},'composeHash':sha(C.read_bytes())}));print('Stage verified: exact web3; all old assets preserved')
else:
 locks=[]
 for f in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  Path(f).parent.mkdir(parents=True,exist_ok=True);x=open(f,'a');fcntl.flock(x,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(x)
 v=json.loads((R/'stage.json').read_text());pr=json.loads((R/'pr.json').read_text());assert pr['state']=='MERGED' and pr['baseRefName']=='feature/la_panthera' and pr['number']==893
 assert d('inspect','wms-local-web','--format','{{.Image}}')==base and d('inspect','wms-local-api','--format','{{.Image}}')==api
 assert sha(C.read_bytes())==v['composeHash'];old=C.read_bytes();(R/'compose.before.json').write_bytes(old)
 others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='wms-local-web'}
 config=json.loads(old);config['services']['web']['image']=v['candidate']
 def start():d('compose','-f',str(C),'up','-d','--no-deps','--no-build','--pull','never','web')
 try:
  C.write_text(json.dumps(config,indent=2));start()
  for i in range(15):
   try:
    d('exec','wms-local-web','wget','-qO-','http://127.0.0.1/');break
   except subprocess.CalledProcessError:
    if i==14:raise
    time.sleep(1)
  assert d('inspect','wms-local-web','--format','{{.Image}}')==v['candidate']
  for n,h in v['hashes'].items():assert d('exec','wms-local-web','sha256sum',n).split()[0]==h
  assert all(d('inspect',n,'--format','{{.Id}}')==i for n,i in others.items())
 except Exception:
  C.write_bytes(old);start();raise
 (R/'published.json').write_text(json.dumps({'pr':893,'otherContainersUnchanged':True,**v}));print('Published: web hashes and unchanged other containers verified')
