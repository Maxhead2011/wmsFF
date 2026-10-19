from pathlib import Path
import subprocess,json,hashlib
r=Path('/opt/logoff-wms/wms/work/sorting-cancel-20261019')
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
v=json.loads((r/'api-verification.json').read_text());assert all(d('inspect',n,'--format','{{.Image}}')==i for n,i in v['base'].items());assert json.loads((r/'browser-proof.json').read_text())['passed']==5
(r/'web/Dockerfile').write_text('FROM '+v['base']['infra-web-1']+'\nCOPY payload/ /usr/share/nginx/html/\n');subprocess.run(['docker','build','--network','none','-t','logoff-web:sorting-cancel-20261019',str(r/'web')],check=True);v['web']=d('image','inspect','logoff-web:sorting-cancel-20261019','--format','{{.Id}}')
def hashes(image):return {l.split(maxsplit=1)[1].removeprefix('/usr/share/nginx/html/'):l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find /usr/share/nginx/html -type f -exec sha256sum {} +').splitlines()}
a,b=hashes(v['base']['infra-web-1']),hashes(v['web']);names=json.loads((r/'web-changes.json').read_text());assert set(a)<=set(b);assert {n for n in b if a.get(n)!=b[n]}==set(names);assert all(a[n]==b[n] for n in a if n!='index.html');v['webHashes']={n:b[n] for n in names};v['oldWebFilesPreserved']=len(a)-1;(r/'verification.json').write_text(json.dumps(v));print(json.dumps({k:x for k,x in v.items() if k!='webHashes'}))
