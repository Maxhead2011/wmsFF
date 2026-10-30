"""FIX: own-WMS index-only overlay; compare every web file and keep API/other containers."""
from pathlib import Path
import subprocess,json,hashlib,fcntl,urllib.request,sys
ROOT=Path('/opt/logoff-wms/wms/work/ozon-single-web-entry-20261030');APP=Path('/opt/logoff-wms/wms')
def d(*args):return subprocess.check_output(['docker',*args],text=True).strip()
def hashes(image):return dict(line.split(maxsplit=1)[::-1] for line in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find /usr/share/nginx/html -type f -exec sha256sum {} +').splitlines())
base=json.loads((ROOT/'base.json').read_text());locks=[]
for n in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
 f=open(n,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
for k,v in base.items():assert d('inspect','infra-'+k+'-1','--format','{{.Image}}')==v,'Live image changed'
old=subprocess.check_output(['docker','exec','infra-web-1','cat','/usr/share/nginx/html/index.html']);new=(ROOT/'index.html').read_bytes()
assert old.count(b'src="/assets/receipt-progress-20261030.js"')==1
assert new==old.replace(b'src="/assets/receipt-progress-20261030.js"',b'src="/assets/ozon-label-history-core-20261030.js"')
(ROOT/'Dockerfile').write_text('FROM '+base['web']+'\nCOPY index.html /usr/share/nginx/html/index.html\n')
subprocess.run(['docker','build','--network','none','-t','logoff-web:ozon-single-entry-20261030',str(ROOT)],check=True)
image=d('image','inspect','logoff-web:ozon-single-entry-20261030','--format','{{.Id}}');before,after=hashes(base['web']),hashes(image)
assert set(before)==set(after) and {n for n in after if before[n]!=after[n]}=={'/usr/share/nginx/html/index.html'}
proof={'base':base,'image':image,'indexSha256':hashlib.sha256(new).hexdigest(),'unchangedFiles':len(before)-1}
(ROOT/'candidate.json').write_text(json.dumps(proof))
if '--publish' not in sys.argv:print(json.dumps(proof));sys.exit(0)
pr=json.loads((ROOT/'pr.json').read_text());assert pr['state']=='MERGED' and pr['baseRefName']=='feature/wb-print-check' and pr['headRefName']=='fix/ozon-single-web-entry'
assert json.loads((ROOT/'candidate-browser.json').read_text())['passed']==6
assert not (ROOT/'published.json').exists()
others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='infra-web-1'}
envhash=hashlib.sha256((APP/'.env').read_bytes()).hexdigest()
def switch(img):
 d('tag',img,'infra-web:latest');subprocess.run(['docker','compose','--env-file',str(APP/'.env'),'-f',str(APP/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','web'],check=True)
d('tag',base['web'],'logoff-web:before-single-entry-20261030')
try:
 switch(image)
 assert urllib.request.urlopen('https://wms.logoff.pro/?single-entry=1',timeout=30).read()==new
 assert json.loads(urllib.request.urlopen('https://wms.logoff.pro/api/v1/health',timeout=20).read())['status']=='ok'
 assert all(d('inspect',n,'--format','{{.Id}}')==v for n,v in others.items())
 assert hashlib.sha256((APP/'.env').read_bytes()).hexdigest()==envhash
except Exception:switch(base['web']);raise
proof.update(published=True,pr=pr['number'],otherContainersUnchanged=True,envUnchanged=True)
(ROOT/'published.json').write_text(json.dumps(proof));print('Published exact index-only fix',image)
