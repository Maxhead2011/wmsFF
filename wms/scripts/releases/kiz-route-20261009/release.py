"""LOGOFF APK-only overlay. Run stage, merge reviewed PR, then publish."""
from pathlib import Path
import subprocess,json,hashlib,zipfile,re,datetime,sys,fcntl,urllib.request,time
r=Path('/opt/logoff-wms/wms/work/kiz-route-20261009')
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
if sys.argv[1]=='stage':
 m=json.loads((r/'manifest.json').read_text());base=m['containers']['infra-web-1']['image'];api=m['containers']['infra-api-1']['image']
 assert image('infra-web-1')==base and image('infra-api-1')==api
 jar='/opt/logoff-wms-releases/eleonora-release-20260912/apksigner.jar'
 name='logoff-tsd-kiz-route-223.apk';dest=r/'context/overlay/downloads';dest.mkdir(parents=True,exist_ok=True)
 subprocess.run(['sh','-c','. /opt/logoff-wms/secrets/tsd-signing.env; exec java -jar '+jar+' sign --ks "$TSD_KEYSTORE_PATH" --ks-key-alias "$TSD_KEY_ALIAS" --ks-pass env:TSD_KEYSTORE_PASSWORD --key-pass env:TSD_KEY_PASSWORD --out '+str(dest/name)+' '+str(r/'unsigned.apk')],check=True)
 cert=subprocess.check_output(['java','-jar',jar,'verify','--verbose','--print-certs',str(dest/name)],text=True)
 assert re.search(r'Signer #1 certificate SHA-256 digest: (\w+)',cert).group(1)=='52916d7797ade50cc1c50bba8787b9d2307b1e5dfd4ea725bd7c3be0e64f989b'
 with zipfile.ZipFile(r/'unsigned.apk') as a,zipfile.ZipFile(dest/name) as b:
  for n in a.namelist():assert a.read(n)==b.read(n)
 data=(dest/name).read_bytes();(dest/'logoff-tsd.apk').write_bytes(data)
 meta={'versionCode':223,'versionName':'0.1.223-kiz-found-route','apkUrl':'https://wms.logoff.pro/downloads/'+name,'sha256':hashlib.sha256(data).hexdigest(),'size':len(data),'releasedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'releaseNotes':'Исправлена отправка найденного КИЗа на разбор из ТСД.'}
 (dest/'logoff-tsd.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
 (r/'context/Dockerfile').write_text('FROM '+base+'\nCOPY overlay/ /usr/share/nginx/html/\n')
 subprocess.run(['docker','build','--network','none','-t','logoff-web:kiz-route-223',str(r/'context')],check=True)
 candidate=d('image','inspect','logoff-web:kiz-route-223','--format','{{.Id}}');before=hashes(base);after=hashes(candidate)
 changed=['downloads/'+n for n in [name,'logoff-tsd.apk','logoff-tsd.json']]
 assert set(before)<=set(after) and {n for n in after if before.get(n)!=after[n]}==set(changed)
 out={'passed':True,'base':base,'api':api,'candidate':candidate,'changed':changed,'hashes':after,'apk':meta}
 (r/'verification.json').write_text(json.dumps(out));print(json.dumps({'staged':True,'candidate':candidate,'apk':223}))
else:
 locks=[]
 for p in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  f=open(p,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text())
 assert v['passed'] and pr['merged'] and not (r/'published.json').exists()
 assert image('infra-web-1')==v['base'] and image('infra-api-1')==v['api']
 others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='infra-web-1'}
 env=(app/'.env').read_bytes();d('tag',v['base'],'logoff-web:before-kiz-route-223')
 try:
  switch(v['candidate'])
  for attempt in range(20):
   try:
    assert json.loads(get('api/v1/health'))['status']=='ok';break
   except Exception:
    if attempt==19:raise
    time.sleep(2)
  for n in v['changed']:assert hashlib.sha256(get(n)).hexdigest()==v['hashes'][n]
  assert json.loads(get('downloads/logoff-tsd.json'))==v['apk']
  assert all(d('inspect',n,'--format','{{.Id}}')==i for n,i in others.items())
  assert (app/'.env').read_bytes()==env
 except Exception:
  switch(v['base']);raise
 out={'published':True,'at':time.time(),'pr':pr['number'],'api':v['api'],'web':v['candidate'],'webBase':v['base'],'apk':v['apk'],'changed':v['changed'],'otherContainersUnchanged':True,'businessRecordsChanged':False}
 (r/'published.json').write_text(json.dumps(out,indent=2));print(json.dumps(out))
