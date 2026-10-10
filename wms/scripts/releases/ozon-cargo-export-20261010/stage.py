from pathlib import Path
import subprocess,json,shutil
r=Path('/opt/logoff-wms/wms/work/ozon-cargo-20261010')
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def hashes(image,root):return {l.split(maxsplit=1)[1].removeprefix(root+'/'):l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find '+root+' -type f -exec sha256sum {} +').splitlines()}
m=json.loads((r/'manifest.json').read_text());images=json.loads((r/'images.json').read_text());api=images['infra-api-1'];web=images['infra-web-1'];assert d('inspect','infra-api-1','--format','{{.Image}}')==api and d('inspect','infra-web-1','--format','{{.Image}}')==web
names=json.loads((r/'api-changes.json').read_text());webNames=json.loads((r/'web-changes.json').read_text())
(r/'api/Dockerfile').write_text('FROM '+api+'\n'+''.join('COPY '+n+' /app/apps/api/dist/'+n+'\n' for n in names))
subprocess.run(['docker','build','--network','none','-t','logoff-api:ozon-cargo-20261010',str(r/'api')],check=True)
a=d('image','inspect','logoff-api:ozon-cargo-20261010','--format','{{.Id}}');ah=hashes(a,'/app/apps/api/dist');old=m['artifacts']['api-runtime.tar.gz']['files'];assert set(old)<=set(ah) and {n for n in ah if old.get(n)!=ah[n]}==set(names)
for n in webNames:
 dest=r/'web/html'/n;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(r/'web'/n,dest)
(r/'web/Dockerfile').write_text('FROM '+web+'\nCOPY html/ /usr/share/nginx/html/\n')
subprocess.run(['docker','build','--network','none','-t','logoff-web:ozon-cargo-20261010',str(r/'web')],check=True)
b=d('image','inspect','logoff-web:ozon-cargo-20261010','--format','{{.Id}}');bh=hashes(b,'/usr/share/nginx/html');oldWeb=hashes(web,'/usr/share/nginx/html');assert set(oldWeb)<=set(bh) and {n for n in bh if oldWeb.get(n)!=bh[n]}==set(webNames)
network=next(iter(json.loads(d('inspect','infra-api-1','--format','{{json .NetworkSettings.Networks}}'))))
smoke=d('run','--rm','--network',network,'--env-file','/opt/logoff-wms/wms/.env','-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','-v',str(r)+':/test:ro','--entrypoint','node',a,'/test/smoke.cjs');proof=json.loads(smoke);assert proof['passed']
v={'passed':True,'base':api,'candidate':a,'changed':names,'hashes':ah,'web':{'base':web,'candidate':b,'changed':webNames,'hashes':bh},'proof':proof}
(r/'verification.json').write_text(json.dumps(v));print('STAGE VERIFIED')
