from pathlib import Path
import sys,json,subprocess,fcntl,time
r=Path(__file__).resolve().parent
name='wms-local-api';base='sha256:69916ee5a68a31c6c93033123e1cce25881a7d3225ce97e65d97eec40820fbbe'
def run(*args):return subprocess.check_output(args,text=True).strip()
def image():return run('docker','inspect',name,'--format','{{.Image}}')
def health():
 for i in range(45):
  res=subprocess.run(['curl','-sSf','--max-time','4','https://wms.logoff.pro/api/v1/health'],capture_output=True)
  if res.returncode==0 and json.loads(res.stdout)['status']=='ok':return
  time.sleep(1)
 raise RuntimeError('API health')
locks=[]
for file in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/opt/wms-restore/.release-pr863.lock']:
 f=open(file,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
assert image()==base
tag='logoff-api:placement-clients-276'
if sys.argv[1]=='stage':
 (r/'Dockerfile').write_text('FROM '+base+'\nCOPY modules/ /app/apps/api/dist/modules/\n')
 run('docker','build','--network','none','-t',tag,str(r))
 print(run('docker','run','--rm','--network','none','--entrypoint','node',tag,'-e',"require('/app/apps/api/dist/modules/tsd/tsd-device.controller');console.log('controller loads')"))
 sys.exit()
pr=json.loads((r/'pr.json').read_text());assert pr['merged'] and pr['base']=='feature/la_panthera'
compose=Path('/opt/wms-restore/compose.json')
old=compose.read_bytes();config=json.loads(old);c=run('docker','inspect',tag,'--format','{{.Id}}')
config['services']['api']['image']=c
def start():run('docker','compose','-f',str(compose),'up','-d','--no-deps','--no-build','--pull','never','api')
try:
 compose.write_text(json.dumps(config,indent=2));start();health();assert image()==c
 assert run('curl','-s','-o','/dev/null','-w','%{http_code}','https://wms.logoff.pro/api/v1/tsd/placement/clients') in ('401','403')
except BaseException:
 compose.write_bytes(old);start();health();raise
print(json.dumps({'api':c,'health':True,'pr':pr['number']}))
