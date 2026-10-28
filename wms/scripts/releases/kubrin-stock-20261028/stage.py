"""FIX: build a four-file candidate only; this script cannot publish it."""
from pathlib import Path
import subprocess,json,hashlib
r=Path('/opt/logoff-wms/wms/work/kubrin-stock-fix-20261028')
base={'api':'sha256:e3b5c94c6de4ee31da174963d8986f40ca59134ef4b6f19d6dbeb453d7c738f3','web':'sha256:0cd665fa3d559ad5a83df7f692cadd91b39781ce0c3cf3db416ffe2d63a2b31e'}
allowed={'modules/marketplace-connections/'+name+'.js' for name in ['fbs-monitor-product-identity','wb-terminal-auto-reservations','fbs-stock-monitoring.service','marketplace-connections.service']}
def d(*args):return subprocess.check_output(['docker',*args],text=True).strip()
for k,v in base.items():assert d('inspect','infra-'+k+'-1','--format','{{.Image}}')==v,'Live baseline changed'
ctx=r/'api';root='/app/apps/api/dist/'
expected={p.relative_to(ctx/'payload').as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in (ctx/'payload').rglob('*') if p.is_file()}
assert set(expected)==allowed
(ctx/'Dockerfile').write_text('FROM '+base['api']+'\nCOPY payload/ '+root+'\n'
 'ENV WMS_WB_TERMINAL_AUTO_RESERVATIONS_ENABLED=true\n'
 'ENV WMS_WB_TERMINAL_AUTO_RESERVATION_CLIENTS=c401202c-be57-4310-9939-2ea36767da37\n')
tag='logoff-api:kubrin-stock-20261028'
subprocess.run(['docker','build','--network','none','-t',tag,str(ctx)],check=True)
image=d('image','inspect',tag,'--format','{{.Id}}')
def hashes(img):return {line.split(maxsplit=1)[1].removeprefix(root):line.split()[0] for line in d('run','--rm','--network','none','--entrypoint','sh',img,'-c','find '+root+' -type f -exec sha256sum {} +').splitlines()}
before,after=hashes(base['api']),hashes(image)
assert set(before)<=set(after) and {n for n in after if before.get(n)!=after[n]}==allowed
assert all(after[n]==v for n,v in expected.items())
result={'base':base,'images':{'api':image},'hashes':expected,'published':False}
(r/'verification.json').write_text(json.dumps(result));print(json.dumps(result))
