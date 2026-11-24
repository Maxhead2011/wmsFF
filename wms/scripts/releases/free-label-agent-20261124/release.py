"""Own web overlay only. Verify every file, preserve environment and other containers."""
import json,sys,hashlib,subprocess,time,fcntl
from pathlib import Path
r=Path(sys.argv[1]);action=sys.argv[2]
def run(*args):return subprocess.check_output(args,text=True).strip()
def image():return run('docker','inspect','wms-local-web','--format','{{.Image}}')
def env():return dict(x.split('=',1) for x in json.loads(run('docker','inspect','wms-local-web','--format','{{json .Config.Env}}')))
def hashes(img):
    s=run('docker','run','--rm','--entrypoint','sh',img,'-c','find /usr/share/nginx/html -type f -exec sha256sum {} +')
    return {line.split(None,1)[1].removeprefix('/usr/share/nginx/html/'):line.split()[0] for line in s.splitlines()}
base=json.loads((r/'base.json').read_text());assert image()==base['web']
expected=dict(base['files'])
for f in (r/'web').rglob('*'):
    if f.is_file():expected[f.relative_to(r/'web').as_posix()]=hashlib.sha256(f.read_bytes()).hexdigest()
assert set(expected)-set(base['files'])=={'assets/free-label-agent-host-20261124.js'}
assert {n for n in base['files'] if expected[n]!=base['files'][n]}=={'index.html'}
if action=='stage':
    (r/'Dockerfile').write_text('FROM '+base['web']+'\nCOPY web/ /usr/share/nginx/html/\n')
    subprocess.run(['docker','build','-t','logoff-web:free-label-agent-20261124',str(r)],check=True)
    new=run('docker','image','inspect','logoff-web:free-label-agent-20261124','--format','{{.Id}}');assert hashes(new)==expected
    (r/'stage.json').write_text(json.dumps({'web':new,'hashes':expected}));print(new);sys.exit()
assert action=='publish'
locks=[]
for n in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/opt/wms-restore/.release-pr863.lock']:
    f=open(n,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
assert image()==base['web']
pr=json.loads((r/'pr.json').read_text());assert pr['state']=='MERGED' and pr['headRefName']=='feature/free-label-agent' and pr['baseRefName']=='feature/la_panthera'
stage=json.loads((r/'stage.json').read_text());assert hashes(stage['web'])==expected
proof=json.loads((r/'browser-proof.json').read_text());assert proof['passed'] and proof['noPrint'] and proof['entrySha256']==expected['assets/free-label-agent-host-20261124.js']
assert not (r/'published.json').exists()
compose=Path('/opt/wms-restore/compose.json');old=compose.read_bytes();config=json.loads(old);oldenv=env()
other={n:run('docker','inspect',n,'--format','{{.Id}}') for n in run('docker','ps','--format','{{.Names}}').splitlines() if n!='wms-local-web'}
(r/'compose.before.json').write_bytes(old);(r/'compose.before.json').chmod(0o600)
def start():run('docker','compose','-f',str(compose),'up','-d','--no-deps','--no-build','--pull','never','web')
def health():
    for _ in range(30):
        if subprocess.run(['curl','-fsS','--max-time','3','https://wms.logoff.pro/'],capture_output=True).returncode==0:return
        time.sleep(1)
    raise RuntimeError('web health failed')
try:
    config['services']['web']['image']=stage['web'];compose.write_text(json.dumps(config,indent=2));start();health()
    assert image()==stage['web'] and env()==oldenv and hashes(image())==expected
    assert all(run('docker','inspect',n,'--format','{{.Id}}')==v for n,v in other.items())
except Exception:
    compose.write_bytes(old);start();health();raise
result={'pr':pr['number'],'web':image(),'filesVerified':len(expected),'environmentUnchanged':True,'otherContainersUnchanged':True,'noBusinessWrites':True}
(r/'published.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
