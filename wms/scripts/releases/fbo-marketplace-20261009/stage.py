from pathlib import Path
import json,subprocess,shutil
r=Path('/opt/logoff-wms/wms/work/fbo-marketplace-20261009')
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def hashes(image,root):return {l.split(maxsplit=1)[1].removeprefix(root+'/'):l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find '+root+' -type f -exec sha256sum {} +').splitlines()}
m=json.loads((r/'manifest.json').read_text());base=m['containers']['infra-api-1']['image'];web=m['containers']['infra-web-1']['image']
assert d('inspect','infra-api-1','--format','{{.Image}}')==base and d('inspect','infra-web-1','--format','{{.Image}}')==web
names=json.loads((r/'api-changes.json').read_text());webNames=json.loads((r/'web-changes.json').read_text())
# FIX: only one API module and the existing web module graph; no schema, flags or downloads changes.
(r/'api-image/Dockerfile').write_text('FROM '+base+'\nCOPY overlay/ /app/apps/api/dist/\n')
subprocess.run(['docker','build','--network','none','-t','logoff-api:fbo-marketplace-20261009',str(r/'api-image')],check=True)
a=d('image','inspect','logoff-api:fbo-marketplace-20261009','--format','{{.Id}}');ah=hashes(a,'/app/apps/api/dist');old=m['artifacts']['api-runtime.tar.gz']['files']
assert set(old)<=set(ah) and {n for n in ah if old.get(n)!=ah[n]}==set(names)
for n in webNames:
 dest=r/'web-image/overlay'/n;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(r/'web'/n,dest)
(r/'web-image/Dockerfile').write_text('FROM '+web+'\nCOPY overlay/ /usr/share/nginx/html/\n')
subprocess.run(['docker','build','--network','none','-t','logoff-web:fbo-marketplace-20261009',str(r/'web-image')],check=True)
b=d('image','inspect','logoff-web:fbo-marketplace-20261009','--format','{{.Id}}');bh=hashes(b,'/usr/share/nginx/html');oldWeb=hashes(web,'/usr/share/nginx/html')
assert set(oldWeb)<=set(bh) and {n for n in bh if oldWeb.get(n)!=bh[n]}==set(webNames)
out=d('run','--rm','--network','none','-e','RELEASE_ROOT=/test','-v',str(r)+':/test:ro','--entrypoint','node',a,'--test','/test/runtime.cjs');assert '# fail 0' in out;(r/'runtime.log').write_text(out)
network=next(iter(json.loads(d('inspect','infra-api-1','--format','{{json .NetworkSettings.Networks}}'))))
proof=json.loads(d('run','--rm','--network',network,'--env-file','/opt/logoff-wms/wms/.env','-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','-v',str(r)+':/test:ro','--entrypoint','node',a,'/test/smoke.cjs'));assert proof['passed']
v={'passed':True,'base':base,'candidate':a,'changed':names,'hashes':ah,'runtimeTestsPassed':True,'web':{'base':web,'candidate':b,'changed':webNames,'hashes':bh},'proof':proof}
(r/'verification.json').write_text(json.dumps(v));print('STAGE VERIFIED')
