"""LOGOFF API and APK candidate. Stage only: no running containers are switched."""
from pathlib import Path
import subprocess,json,hashlib,zipfile,re,datetime,sys,fcntl,urllib.request,time
r=Path('/opt/logoff-wms/wms/work/fbo-alternative-20261022')
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
 name='logoff-tsd-fbo-alternative-234.apk';dest=r/'context/overlay/downloads';dest.mkdir(parents=True,exist_ok=True)
 subprocess.run(['sh','-c','. /opt/logoff-wms/secrets/tsd-signing.env; exec java -jar '+jar+' sign --ks "$TSD_KEYSTORE_PATH" --ks-key-alias "$TSD_KEY_ALIAS" --ks-pass env:TSD_KEYSTORE_PASSWORD --key-pass env:TSD_KEY_PASSWORD --out '+str(dest/name)+' '+str(r/'unsigned.apk')],check=True)
 cert=subprocess.check_output(['java','-jar',jar,'verify','--verbose','--print-certs',str(dest/name)],text=True)
 assert re.search(r'Signer #1 certificate SHA-256 digest: (\w+)',cert).group(1)=='52916d7797ade50cc1c50bba8787b9d2307b1e5dfd4ea725bd7c3be0e64f989b'
 with zipfile.ZipFile(r/'unsigned.apk') as a,zipfile.ZipFile(dest/name) as b:
  for n in a.namelist():assert a.read(n)==b.read(n)
 # FIX: the signer may emit an incremental-install sidecar; it is not a public download.
 sidecar=dest/(name+'.idsig')
 if sidecar.exists():sidecar.unlink()
 data=(dest/name).read_bytes();(dest/'logoff-tsd.apk').write_bytes(data)
 meta={'versionCode':234,'versionName':'0.1.234-fbo-alternative','apkUrl':'https://wms.logoff.pro/downloads/'+name,'sha256':hashlib.sha256(data).hexdigest(),'size':len(data),'releasedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'releaseNotes':'FBO: validate another source box before picking; protect reservations and KIZ ownership.'}
 (dest/'logoff-tsd.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
 (r/'context/Dockerfile').write_text('FROM '+base+'\nCOPY overlay/ /usr/share/nginx/html/\n')
 subprocess.run(['docker','build','--network','none','-t','logoff-web:fbo-alternative-20261022',str(r/'context')],check=True)
 candidate=d('image','inspect','logoff-web:fbo-alternative-20261022','--format','{{.Id}}');before=hashes(base);after=hashes(candidate)
 changed=['downloads/'+n for n in [name,'logoff-tsd.apk','logoff-tsd.json']]
 assert set(before)<=set(after) and {n for n in after if before.get(n)!=after[n]}==set(changed)
 out={'passed':True,'base':base,'api':api,'candidate':candidate,'changed':changed,'hashes':after,'apk':meta}
 (r/'verification.json').write_text(json.dumps(out));print(json.dumps({'staged':True,'candidate':candidate,'apk':234}))


# FIX: API overlay is limited to two reviewed runtime modules.
names=['modules/tsd/fbo-two-stage.service.js','modules/tsd/fbo-alternative-picking.js']
(r/'api/Dockerfile').write_text('FROM '+api+'\nENV WMS_FBO_ALTERNATIVE_PICK_ENABLED=true\n'+''.join('COPY '+n+' /app/apps/api/dist/'+n+'\n' for n in names))
subprocess.run(['docker','build','--network','none','-t','logoff-api:fbo-alternative-20261022',str(r/'api')],check=True)
a=d('image','inspect','logoff-api:fbo-alternative-20261022','--format','{{.Id}}')
def api_hashes(img):
 root='/app/apps/api/dist/'
 return {l.split(maxsplit=1)[1].removeprefix(root):l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',img,'-c','find '+root+' -type f -exec sha256sum {} +').splitlines()}
ah=api_hashes(a);old=m['artifacts']['api-runtime.tar.gz']['files']
assert set(old)<=set(ah) and {n for n in ah if old.get(n)!=ah[n]}==set(names)
proof=json.loads(d('run','--rm','--network','none','-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','-v',str(r)+':/test:ro','--entrypoint','node',a,'/test/smoke.cjs').splitlines()[-1]);assert proof['passed']
out['apiCandidate']=a;out['apiChanged']=names;out['apiHashes']=ah;out['proof']=proof
(r/'verification.json').write_text(json.dumps(out));print(json.dumps({'verified':True,'api':a,'web':candidate,'apk':234}))
