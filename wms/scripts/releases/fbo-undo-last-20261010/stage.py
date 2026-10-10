"""LOGOFF APK-only overlay. Run stage, merge reviewed PR, then publish."""
from pathlib import Path
import subprocess,json,hashlib,zipfile,re,datetime,sys,fcntl,urllib.request,time
r=Path('/opt/logoff-wms/wms/work/fbo-undo-last-20261010')
app=Path('/opt/logoff-wms/wms')
def d(*args):return subprocess.check_output(['docker',*args],text=True).strip()
def image(n):return d('inspect',n,'--format','{{.Image}}')
def hashes(img):
 root='/usr/share/nginx/html/'
 return {l.split(maxsplit=1)[1].removeprefix(root):l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',img,'-c','find '+root+' -type f -exec sha256sum {} +').splitlines()}
def get(path):return urllib.request.urlopen('https://wms.logoff.pro/'+path,timeout=30).read()
def switch(img):
 d('tag',img,'infra-web:latest')
 subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','--timeout','30','web'],check=True)
if True:
 m=json.loads((r/'manifest.json').read_text());base=m['containers']['infra-web-1']['image'];api=m['containers']['infra-api-1']['image']
 assert image('infra-web-1')==base and image('infra-api-1')==api
 jar='/opt/logoff-wms-releases/eleonora-release-20260912/apksigner.jar'
 name='logoff-tsd-packing-undo-227.apk';dest=r/'context/overlay/downloads';dest.mkdir(parents=True,exist_ok=True)
 subprocess.run(['sh','-c','. /opt/logoff-wms/secrets/tsd-signing.env; exec java -jar '+jar+' sign --ks "$TSD_KEYSTORE_PATH" --ks-key-alias "$TSD_KEY_ALIAS" --ks-pass env:TSD_KEYSTORE_PASSWORD --key-pass env:TSD_KEY_PASSWORD --out '+str(dest/name)+' '+str(r/'unsigned.apk')],check=True)
 cert=subprocess.check_output(['java','-jar',jar,'verify','--verbose','--print-certs',str(dest/name)],text=True)
 assert re.search(r'Signer #1 certificate SHA-256 digest: (\w+)',cert).group(1)=='52916d7797ade50cc1c50bba8787b9d2307b1e5dfd4ea725bd7c3be0e64f989b'
 with zipfile.ZipFile(r/'unsigned.apk') as a,zipfile.ZipFile(dest/name) as b:
  for n in a.namelist():assert a.read(n)==b.read(n)
 # FIX: the signer may emit an incremental-install sidecar; it is not a public download.
 sidecar=dest/(name+'.idsig')
 if sidecar.exists():sidecar.unlink()
 data=(dest/name).read_bytes();(dest/'logoff-tsd.apk').write_bytes(data)
 meta={'versionCode':227,'versionName':'0.1.227-packing-undo','apkUrl':'https://wms.logoff.pro/downloads/'+name,'sha256':hashlib.sha256(data).hexdigest(),'size':len(data),'releasedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'releaseNotes':'Отмена последней упакованной единицы. Проверка потребности направления сразу на скане ШК.'}
 (dest/'logoff-tsd.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
 (r/'context/Dockerfile').write_text('FROM '+base+'\nCOPY overlay/ /usr/share/nginx/html/\n')
 subprocess.run(['docker','build','--network','none','-t','logoff-web:packing-undo-227',str(r/'context')],check=True)
 candidate=d('image','inspect','logoff-web:packing-undo-227','--format','{{.Id}}');before=hashes(base);after=hashes(candidate)
 changed=['downloads/'+n for n in [name,'logoff-tsd.apk','logoff-tsd.json']]
 assert set(before)<=set(after) and {n for n in after if before.get(n)!=after[n]}==set(changed)
 out={'passed':True,'base':base,'api':api,'candidate':candidate,'changed':changed,'hashes':after,'apk':meta}
 (r/'verification.json').write_text(json.dumps(out));print(json.dumps({'staged':True,'candidate':candidate,'apk':227}))

# FIX: apply only the three checked API modules to the pinned live image.
names=['modules/tsd/fbo-two-stage.service.js','modules/tsd/dto/fbo-action.dto.js','modules/tsd/fbo-packing-undo.js']
(r/'api-image/Dockerfile').write_text('FROM '+api+'\nCOPY overlay/ /app/apps/api/dist/\n')
subprocess.run(['docker','build','--network','none','-t','logoff-api:fbo-undo-last-20261010',str(r/'api-image')],check=True)
a=d('image','inspect','logoff-api:fbo-undo-last-20261010','--format','{{.Id}}')
def apiHashes(img):
 root='/app/apps/api/dist/'
 return {l.split(maxsplit=1)[1].removeprefix(root):l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',img,'-c','find '+root+' -type f -exec sha256sum {} +').splitlines()}
ah=apiHashes(a);old=apiHashes(api)
assert set(old)<=set(ah) and {n for n in ah if old.get(n)!=ah[n]}==set(names)
# TEST: local full suites and real PostgreSQL concurrency must pass before staging.
local=json.loads((r/'local-verification.json').read_text());assert local['passed'] and local['postgresConcurrencyTest']
network=next(iter(json.loads(d('inspect','infra-api-1','--format','{{json .NetworkSettings.Networks}}'))))
proof=json.loads(d('run','--rm','--network',network,'--env-file',str(app/'.env'),'-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','-e','WMS_FBO_PACK_UNDO_ENABLED=true','-v',str(r)+':/test:ro','--entrypoint','node',a,'/test/smoke.cjs'));assert proof['passed']
web=json.loads((r/'verification.json').read_text())
v={'passed':True,'base':api,'candidate':a,'changed':names,'hashes':ah,'web':{'base':base,'candidate':web['candidate'],'changed':web['changed'],'hashes':web['hashes']},'proof':proof,'apk':web['apk']}
(r/'verification.json').write_text(json.dumps(v,indent=2));print('API AND APK VERIFIED')
