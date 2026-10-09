from pathlib import Path
import json,subprocess,re,hashlib,datetime,zipfile
r=Path('/opt/logoff-wms/wms/work/receipt-barcode-20261009');app=Path('/opt/logoff-wms/wms')
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def hashes(image,root):return {l.split(maxsplit=1)[1].removeprefix(root+'/'):l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find '+root+' -type f -exec sha256sum {} +').splitlines()}
m=json.loads((r/'manifest.json').read_text());base=m['containers']['infra-api-1']['image'];web=m['containers']['infra-web-1']['image']
assert d('inspect','infra-api-1','--format','{{.Image}}')==base and d('inspect','infra-web-1','--format','{{.Image}}')==web
names=json.loads((r/'api-changes.json').read_text())
(r/'api/Dockerfile').write_text('FROM '+base+'\n'+''.join('COPY '+n+' /app/apps/api/dist/'+n+'\n' for n in names))
subprocess.run(['docker','build','--network','none','-t','logoff-api:receipt-barcode-20261009',str(r/'api')],check=True)
image=d('image','inspect','logoff-api:receipt-barcode-20261009','--format','{{.Id}}');actual=hashes(image,'/app/apps/api/dist');expected=m['artifacts']['api-runtime.tar.gz']['files']
assert set(expected)<=set(actual) and {n for n in actual if expected.get(n)!=actual[n]}==set(names)
out=d('run','--rm','--network','none','-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','-e','RUNTIME_ROOT=/app/apps/api/dist','-e','CANDIDATE_ROOT=/app/apps/api/dist','-v',str(r)+':/test:ro','--entrypoint','node',image,'--test','/test/runtime.cjs','/test/compact.cjs','/test/ozon.cjs','/test/menu.cjs');assert '# fail 0' in out;(r/'runtime.log').write_text(out)
jar='/opt/logoff-wms-releases/eleonora-release-20260912/apksigner.jar';name='logoff-tsd-receipt-review-221.apk';dest=r/'web/downloads';dest.mkdir(parents=True,exist_ok=True)
subprocess.run(['sh','-c','. /opt/logoff-wms/secrets/tsd-signing.env; exec java -jar '+jar+' sign --ks "$TSD_KEYSTORE_PATH" --ks-key-alias "$TSD_KEY_ALIAS" --ks-pass env:TSD_KEYSTORE_PASSWORD --key-pass env:TSD_KEY_PASSWORD --out '+str(dest/name)+' '+str(r/'unsigned.apk')],check=True)
cert=subprocess.check_output(['java','-jar',jar,'verify','--verbose','--print-certs',str(dest/name)],text=True)
assert re.search(r'Signer #1 certificate SHA-256 digest: (\w+)',cert).group(1)=='52916d7797ade50cc1c50bba8787b9d2307b1e5dfd4ea725bd7c3be0e64f989b'
with zipfile.ZipFile(r/'unsigned.apk') as a,zipfile.ZipFile(dest/name) as b:
 for n in a.namelist():assert a.read(n)==b.read(n)
data=(dest/name).read_bytes();(dest/'logoff-tsd.apk').write_bytes(data)
meta={'versionCode':221,'versionName':'0.1.221-receipt-barcode-review','apkUrl':'https://wms.logoff.pro/downloads/'+name,'sha256':hashlib.sha256(data).hexdigest(),'size':len(data),'releasedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'releaseNotes':'Приёмка: повторное сканирование подозрительных ШК и разбор администратором. Изменения Ozon сохранены.'}
(dest/'logoff-tsd.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
webNames=json.loads((r/'web-changes.json').read_text())+['downloads/'+n for n in [name,'logoff-tsd.apk','logoff-tsd.json']]
(r/'web/Dockerfile').write_text('FROM '+web+'\n'+''.join('COPY '+n+' /usr/share/nginx/html/'+n+'\n' for n in webNames))
subprocess.run(['docker','build','--network','none','-t','logoff-web:receipt-barcode-20261009',str(r/'web')],check=True)
webImage=d('image','inspect','logoff-web:receipt-barcode-20261009','--format','{{.Id}}');wh=hashes(webImage,'/usr/share/nginx/html');old=hashes(web,'/usr/share/nginx/html')
assert set(old)<=set(wh) and {n for n in wh if old.get(n)!=wh[n]}==set(webNames)
v={'passed':True,'base':base,'candidate':image,'changed':names,'hashes':actual,'runtimeTestsPassed':True,'web':{'base':web,'candidate':webImage,'changed':webNames,'hashes':wh},'apk':meta}
(r/'verification.json').write_text(json.dumps(v));print('STAGE VERIFIED')
