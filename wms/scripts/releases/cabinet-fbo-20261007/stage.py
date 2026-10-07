import pathlib,subprocess,json,hashlib,re,zipfile,datetime,shutil
r=pathlib.Path('/opt/logoff-wms/wms/work/cabinet-fbo-20261007');before=json.loads((r/'before.json').read_text());baseline=json.loads((r/'manifest.json').read_text())
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def sha(b):return hashlib.sha256(b).hexdigest()
for kind in ['api','web']:assert d('inspect','infra-'+kind+'-1','--format','{{.Image}}')==before['containers']['infra-'+kind+'-1']['image'],'Concurrent release'
# FIX: sign on the existing host without reading or printing signing secrets.
jar='/opt/logoff-wms-releases/eleonora-release-20260912/apksigner.jar'
name='logoff-tsd-await-placement-218.apk';out=r/'web/downloads';out.mkdir(parents=True,exist_ok=True)
subprocess.run(['sh','-c','. /opt/logoff-wms/secrets/tsd-signing.env; exec java -jar '+jar+' sign --ks "$TSD_KEYSTORE_PATH" --ks-key-alias "$TSD_KEY_ALIAS" --ks-pass env:TSD_KEYSTORE_PASSWORD --key-pass env:TSD_KEY_PASSWORD --out '+str(out/name)+' '+str(r/'unsigned.apk')],check=True)
cert=subprocess.check_output(['java','-jar',jar,'verify','--verbose','--print-certs',str(out/name)],text=True)
assert re.search(r'Signer #1 certificate SHA-256 digest: (\w+)',cert).group(1)=='52916d7797ade50cc1c50bba8787b9d2307b1e5dfd4ea725bd7c3be0e64f989b'
with zipfile.ZipFile(r/'unsigned.apk') as a,zipfile.ZipFile(out/name) as b:
 for n in a.namelist():assert sha(a.read(n))==sha(b.read(n)),n
data=(out/name).read_bytes();(out/'logoff-tsd.apk').write_bytes(data)
meta={'versionCode':218,'versionName':'0.1.218-fbo-await-placement','apkUrl':'https://wms.logoff.pro/downloads/'+name,'sha256':sha(data),'size':len(data),'releasedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'releaseNotes':'ФБО: принятое поступление без палет-сорта показано как ожидание размещения. После размещения обновите маршрут. Установите поверх приложения.'}
(out/'logoff-tsd.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
changes=json.loads((r/'web-changes.json').read_text());changes+=['downloads/'+n for n in [name,'logoff-tsd.apk','logoff-tsd.json']];(r/'web-changes.json').write_text(json.dumps(changes))
result={'apk':meta}
for kind,root in [('api','/app/apps/api/dist'),('web','/usr/share/nginx/html')]:
 base=before['containers']['infra-'+kind+'-1']['image'];source=r/kind;changes=json.loads((r/(kind+'-changes.json')).read_text())
 (source/'Dockerfile').write_text('\n'.join(['FROM '+base]+['COPY '+n+' '+root+'/'+n for n in changes])+'\n')
 tag='logoff-'+kind+':cabinet-fbo-20261007'
 subprocess.run(['docker','build','--network','none','-t',tag,str(source)],check=True)
 lines=d('run','--rm','--network','none','--entrypoint','sh',tag,'-c','find '+root+' -type f -exec sha256sum {} +').splitlines()
 actual={l.split(maxsplit=1)[1].removeprefix(root+'/'):l.split()[0] for l in lines};old=baseline['artifacts'][kind+'-runtime.tar.gz']['files']
 assert set(old)<=set(actual),'Removed file'
 assert {n for n in old.keys()|actual.keys() if old.get(n)!=actual.get(n)}==set(changes),'Unexpected runtime delta'
 result[kind]={'base':base,'candidate':d('image','inspect',tag,'--format','{{.Id}}'),'hashes':actual}
print(d('run','--rm','--network','none','-v',str(r)+':/release:ro','-w','/app/apps/api','-e','NODE_PATH=/app/apps/api/node_modules:/app/node_modules','--entrypoint','node',result['api']['candidate'],'--test','/release/runtime.test.cjs'))
result['passed']=True;(r/'verification.json').write_text(json.dumps(result));print('STAGE PASSED')
