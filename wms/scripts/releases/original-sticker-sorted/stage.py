from pathlib import Path
import subprocess,json,tarfile
r=Path('/opt/logoff-wms/wms/work/original-sticker-sorted-20261022');r.mkdir(exist_ok=True)
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
b={'infra-api-1':'sha256:119999bed8e0baf53dd978b35987fe3bce79be95aa3e15c030b19b1ed10a9c92','infra-web-1':'sha256:e8da9906ee5d3d5eeda56d91f47af8dfeeb8d530f8b5172bb291933f923b69e4'}
assert all(d('inspect',n,'--format','{{.Image}}')==i for n,i in b.items())
with tarfile.open('/tmp/sorted-payload.tgz') as t:
 for m in t.getmembers():assert not Path(m.name).is_absolute() and '..' not in Path(m.name).parts and not m.issym() and not m.islnk()
 t.extractall(r)
names=['modules/marketplace-connections/fbs-repeat-assembly.js','modules/marketplace-connections/fbs-repeat-assembly.service.js']
(r/'api/Dockerfile').write_text('FROM '+b['infra-api-1']+'\n'+''.join('COPY '+n+' /app/apps/api/dist/'+n+'\n' for n in names))
d('build','--network','none','-t','logoff-api:original-sticker-sorted-20261022',str(r/'api'))
image=d('image','inspect','logoff-api:original-sticker-sorted-20261022','--format','{{.Id}}')
def hashes(img):return {l.split(maxsplit=1)[1]:l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',img,'-c','find /app/apps/api/dist -type f -exec sha256sum {} +').splitlines()}
a,z=hashes(b['infra-api-1']),hashes(image);assert set(a)==set(z);assert {n for n in z if z[n]!=a[n]}=={'/app/apps/api/dist/'+n for n in names}
def test(img):return subprocess.run(['docker','run','--rm','--network','none','-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','-v',str(r/'smoke.cjs')+':/test.cjs:ro','--entrypoint','node',img,'/test.cjs'],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
red=test(b['infra-api-1']);assert red.returncode!=0;green=test(image);print(green.stdout);assert green.returncode==0
v={'api':image,'base':b,'apiHashes':{n:z['/app/apps/api/dist/'+n] for n in names},'runtime':json.loads(green.stdout.strip().splitlines()[-1])};(r/'verification.json').write_text(json.dumps(v));print(json.dumps(v))
