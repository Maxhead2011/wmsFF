"""TEST: build an isolated exact-runtime candidate; never switch production."""
from pathlib import Path
import subprocess,json,sys,hashlib
r=Path(sys.argv[1])
def docker(*args):return subprocess.check_output(['docker',*args],text=True).strip()
base='sha256:8f46b539b6021ee5344c76d03f425a8664eb69b5488eb247411692e9382e8296'
assert docker('inspect','wms-local-api','--format','{{.Image}}')==base
proof=json.loads((r/'overlay-proof.json').read_text())
def hashes(image):
 raw=docker('run','--rm','--network','none','--entrypoint','sh',image,'-c','find /app/apps/api/dist -type f -exec sha256sum {} +')
 return {s.split(None,1)[1].removeprefix('/app/apps/api/dist/'):s.split()[0] for s in raw.splitlines()}
before=hashes(base)
for name,p in proof.items():
 assert hashlib.sha256((r/'payload-v979'/name).read_bytes()).hexdigest()==p['sha256']
 if 'baseSha256' in p:assert before[name]==p['baseSha256']
(r/'Dockerfile').write_text('FROM '+base+'\nCOPY payload-v979/ /app/apps/api/dist/\n')
image=docker('build','--network','none','-q','-f',str(r/'Dockerfile'),str(r))
after=hashes(image)
assert set(before)<=set(after)
assert {n for n in after if before.get(n)!=after[n]}==set(proof)
for n in proof:assert after[n]==proof[n]['sha256']
docker('run','--rm','--network','none','-w','/app/apps/api','--entrypoint','node',image,'-e',"require('reflect-metadata');require('./dist/modules/client-requests/client-requests.module');console.log('Modules OK')")
docker('run','--rm','--network','none','-e','NODE_PATH=/app/apps/api/node_modules','-v',str(r/'runtime.cjs')+':/test.cjs:ro','--entrypoint','node',image,'/test.cjs')
docker('run','--rm','--network','none','-v',str(r)+':/proof','--entrypoint','node',image,'/proof/ozon981.cjs','/app/apps/api/dist','/proof')
(r/'stage.json').write_text(json.dumps({'images':{'api':image},'base':base,'changes':proof,'allHashesVerified':True,'runtimeChecks':17}))
print('PASS exact runtime image, unchanged files and module load',image)
