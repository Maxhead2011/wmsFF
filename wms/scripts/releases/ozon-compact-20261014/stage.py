# FIX: web-only overlay with an exact file allow-list against the live image.
from pathlib import Path
import subprocess,json,hashlib
r=Path('/opt/logoff-wms/wms/work/ozon-compact-20261014')
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def hashes(image):return {l.split(maxsplit=1)[1].removeprefix('/usr/share/nginx/html/'):l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find /usr/share/nginx/html -type f -exec sha256sum {} +').splitlines()}
images=json.loads((r/'images.json').read_text());web=images['infra-web-1'];api=images['infra-api-1']
assert d('inspect','infra-web-1','--format','{{.Image}}')==web and d('inspect','infra-api-1','--format','{{.Image}}')==api
assert json.loads((r/'tests.json').read_text())['passed']
names=json.loads((r/'web-changes.json').read_text());assert set(names)=={'index.html','assets/ozon-workspace-compact-20261014.css'}
assert all(n=='index.html' or n=='assets/ozon-workspace-compact-20261014.css' for n in names)
(r/'Dockerfile').write_text('FROM '+web+'\nCOPY web/ /usr/share/nginx/html/\n')
subprocess.run(['docker','build','--network','none','-t','logoff-web:ozon-compact-20261014',str(r)],check=True)
candidate=d('image','inspect','logoff-web:ozon-compact-20261014','--format','{{.Id}}')
old=hashes(web);new=hashes(candidate)
assert set(old)<=set(new) and {n for n in new if old.get(n)!=new[n]}==set(names)
assert all(new[n]==hashlib.sha256((r/'web'/n).read_bytes()).hexdigest() for n in names)
oldcfg=json.loads(d('image','inspect',web))[0]['Config'];cfg=json.loads(d('image','inspect',candidate))[0]['Config'];assert oldcfg==cfg
v={'passed':True,'api':api,'base':web,'candidate':candidate,'changed':names,'hashes':new,'configUnchanged':True,'tests':json.loads((r/'tests.json').read_text())}
(r/'verification.json').write_text(json.dumps(v));print(json.dumps({'verified':True,'candidate':candidate,'files':len(names)}))
