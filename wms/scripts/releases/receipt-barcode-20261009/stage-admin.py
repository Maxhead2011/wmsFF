from pathlib import Path
import subprocess,json,hashlib
r=Path('/opt/logoff-wms/wms/work/receipt-admin-20261009')
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def hashes(image):
 return {l.split(maxsplit=1)[1].removeprefix('/app/apps/api/dist/'):l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find /app/apps/api/dist -type f -exec sha256sum {} +').splitlines()}
m=json.loads((r/'manifest.json').read_text());base=m['containers']['infra-api-1']['image'];web=m['containers']['infra-web-1']['image'];assert d('inspect','infra-api-1','--format','{{.Image}}')==base and d('inspect','infra-web-1','--format','{{.Image}}')==web
(r/'Dockerfile').write_text('FROM '+base+'\nCOPY api/ /app/apps/api/dist/\n');subprocess.run(['docker','build','--network','none','-t','logoff-api:receipt-admin-20261009',str(r)],check=True)
image=d('image','inspect','logoff-api:receipt-admin-20261009','--format','{{.Id}}');actual=hashes(image);old=m['artifacts']['api-runtime.tar.gz']['files'];names=['modules/administration/fbo-problems-policy.js','modules/administration/fbo-problems-warehouse.js'];assert set(old)<=set(actual) and {n for n in actual if old.get(n)!=actual[n]}==set(names)
print(d('run','--rm','--network','none','-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','-e','RUNTIME_ROOT=/app/apps/api/dist','-v',str(r)+':/test:ro','--entrypoint','node',image,'--test','/test/runtime.cjs'))
network=next(iter(json.loads(d('inspect','infra-api-1','--format','{{json .NetworkSettings.Networks}}'))))
proof=json.loads(d('run','--rm','--network',network,'--env-file','/opt/logoff-wms/wms/.env','-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','-v',str(r)+':/test:ro','--entrypoint','node',image,'/test/smoke.cjs'));assert proof['passed'] and proof['readOnly'];print(json.dumps(proof,ensure_ascii=False));(r/'verification.json').write_text(json.dumps({'passed':True,'base':base,'candidate':image,'web':web,'hashes':actual,'changed':names,'proof':proof}));print('STAGE VERIFIED')
