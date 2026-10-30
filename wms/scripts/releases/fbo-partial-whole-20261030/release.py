"""Publish only LOGOFF APK247 over the verified web image, with rollback."""
from pathlib import Path
import subprocess,json,hashlib,sys,fcntl,time,urllib.request,os,re,zipfile,datetime
r=Path('/opt/logoff-wms/wms/work/fbo-partial-whole-20261030')
app=Path('/opt/logoff-wms/wms')
base=json.loads((r/'live-before.json').read_text())['base']
root='/usr/share/nginx/html/'
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def sha(b):return hashlib.sha256(b).hexdigest()
def check():
 for k,v in base.items():assert d('inspect','infra-'+k+'-1','--format','{{.Image}}')==v,'Server changed: '+k
def hashes(image):return {line.split(maxsplit=1)[1].removeprefix(root):line.split()[0] for line in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find '+root+' -type f -exec sha256sum {} +').splitlines()}
def get(name):
 for i in range(20):
  try:return urllib.request.urlopen('https://wms.logoff.pro/'+name,timeout=15).read()
  except Exception:
   if i==19:raise
   time.sleep(1)
def stage():
 check();assert json.loads(get('downloads/logoff-tsd.json'))['versionCode']==246
 dest=r/'web/payload/downloads';dest.mkdir(parents=True,exist_ok=True)
 name='logoff-tsd-fbo-partial-whole-247.apk';jar='/opt/logoff-wms-releases/eleonora-release-20260912/apksigner.jar'
 subprocess.run(['sh','-c','. /opt/logoff-wms/secrets/tsd-signing.env; exec java -jar '+jar+' sign --ks "$TSD_KEYSTORE_PATH" --ks-key-alias "$TSD_KEY_ALIAS" --ks-pass env:TSD_KEYSTORE_PASSWORD --key-pass env:TSD_KEY_PASSWORD --out '+str(dest/name)+' '+str(r/'unsigned.apk')],check=True)
 cert=subprocess.check_output(['java','-jar',jar,'verify','--verbose','--print-certs',str(dest/name)],text=True)
 assert re.search(r'Signer #1 certificate SHA-256 digest: (\w+)',cert).group(1)=='52916d7797ade50cc1c50bba8787b9d2307b1e5dfd4ea725bd7c3be0e64f989b'
 with zipfile.ZipFile(r/'unsigned.apk') as a,zipfile.ZipFile(dest/name) as b:
  for n in a.namelist():assert a.read(n)==b.read(n),'Signing changed '+n
 if (dest/(name+'.idsig')).exists():(dest/(name+'.idsig')).unlink()
 data=(dest/name).read_bytes();(dest/'logoff-tsd.apk').write_bytes(data)
 meta={'versionCode':247,'versionName':'0.1.247-fbo-partial-whole','apkUrl':'https://wms.logoff.pro/downloads/'+name,'sha256':sha(data),'size':len(data),'releasedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'releaseNotes':'FBO: take the remaining box contents whole during partial picking; previously picked units remain separate.'}
 (dest/'logoff-tsd.json').write_text(json.dumps(meta))
 ctx=r/'web';(ctx/'Dockerfile').write_text('FROM '+base['web']+'\nCOPY payload/ '+root+'\n')
 tag='logoff-web:fbo-partial-whole-20261030';subprocess.run(['docker','build','--network','none','-t',tag,str(ctx)],check=True)
 image=d('image','inspect',tag,'--format','{{.Id}}');before,after=hashes(base['web']),hashes(image)
 expected={p.relative_to(ctx/'payload').as_posix():sha(p.read_bytes()) for p in (ctx/'payload').rglob('*') if p.is_file()}
 assert len(expected)==3 and set(before)<=set(after)
 assert {n for n in after if before.get(n)!=after[n]}==set(expected)
 assert all(after[n]==v for n,v in expected.items())
 v={'base':base,'images':{'api':base['api'],'web':image},'hashes':expected,'apk':meta,'unchangedWebFiles':len(before)-2,'signedPayloadVerified':True}
 (r/'verification.json').write_text(json.dumps(v));print(json.dumps(v))
def publish():
 locks=[]
 for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 check();v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text())
 assert pr['state']=='MERGED' and pr['headRefName']=='fix/fbo-partial-whole-remainder'
 assert not (r/'published.json').exists()
 proof=json.loads((r/'test-proof.json').read_text());assert proof['passed']>=915 and proof['failures']==0 and proof['versionCode']==247
 others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='infra-web-1'}
 rollback='logoff-web:before-fbo-partial-whole-20261030';d('tag',base['web'],rollback)
 def switch(image):
  d('tag',image,'infra-web:latest')
  subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','web'],check=True)
 try:
  switch(v['images']['web']);assert json.loads(get('api/v1/health'))['status']=='ok'
  assert d('inspect','infra-web-1','--format','{{.Image}}')==v['images']['web']
  for n,h in v['hashes'].items():assert sha(get(n+'?release=247'))==h,n
  assert all(d('inspect',n,'--format','{{.Id}}')==x for n,x in others.items())
 except Exception:switch(base['web']);raise
 v.update(published=True,pr=pr['number'],at=time.time(),otherContainersUnchanged=True,rollback=rollback,testProof=proof)
 (r/'published.json').write_text(json.dumps(v));print('Published APK247; health, public hashes and unchanged containers verified')
if __name__=='__main__':publish() if sys.argv[-1]=='publish' else stage()
