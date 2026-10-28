"""FIX: exact own-WMS overlay, additive migration, locked release and image rollback."""
from pathlib import Path
import subprocess,json,hashlib,sys,fcntl,time,urllib.request,os,re,zipfile,datetime,uuid
r=Path('/opt/logoff-wms/wms/work/yandex-fby-20261028');app=Path('/opt/logoff-wms/wms')
base={'api':'sha256:83bf848ef54c5ee4c4891263c65d124dff3cf68d807729dbcc7e76db47dabbb8','web':'sha256:8e3f45c1a4b7a56db1c19d8f4d3dc27a73aacafd26738c19e5772b789a2a2e66'}
roots={'api':'/app/apps/api/dist/','web':'/usr/share/nginx/html/'}
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def check():
 for k,v in base.items():assert d('inspect','infra-'+k+'-1','--format','{{.Image}}')==v,'Server changed: '+k
def hashes(image,kind):return {line.split(maxsplit=1)[1].removeprefix(roots[kind]):line.split()[0] for line in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find '+roots[kind]+' -type f -exec sha256sum {} +').splitlines()}
def get(name):
 for i in range(30):
  try:return urllib.request.urlopen('https://wms.logoff.pro/'+name,timeout=15).read()
  except Exception:
   if i==29:raise
   time.sleep(1)
def stage():
 check();dest=r/'web/payload/downloads';dest.mkdir(parents=True,exist_ok=True);name='logoff-tsd-marketplaces-236.apk';jar='/opt/logoff-wms-releases/eleonora-release-20260912/apksigner.jar'
 subprocess.run(['sh','-c','. /opt/logoff-wms/secrets/tsd-signing.env; exec java -jar '+jar+' sign --ks "$TSD_KEYSTORE_PATH" --ks-key-alias "$TSD_KEY_ALIAS" --ks-pass env:TSD_KEYSTORE_PASSWORD --key-pass env:TSD_KEY_PASSWORD --out '+str(dest/name)+' '+str(r/'unsigned.apk')],check=True)
 cert=subprocess.check_output(['java','-jar',jar,'verify','--verbose','--print-certs',str(dest/name)],text=True);assert re.search(r'Signer #1 certificate SHA-256 digest: (\w+)',cert).group(1)=='52916d7797ade50cc1c50bba8787b9d2307b1e5dfd4ea725bd7c3be0e64f989b'
 with zipfile.ZipFile(r/'unsigned.apk') as a,zipfile.ZipFile(dest/name) as b:
  for n in a.namelist():assert a.read(n)==b.read(n)
 if (dest/(name+'.idsig')).exists():(dest/(name+'.idsig')).unlink()
 data=(dest/name).read_bytes();(dest/'logoff-tsd.apk').write_bytes(data);meta={'versionCode':236,'versionName':'0.1.236-marketplaces-fbo','apkUrl':'https://wms.logoff.pro/downloads/'+name,'sha256':hashlib.sha256(data).hexdigest(),'size':len(data),'releasedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'releaseNotes':'Lamoda and Yandex FBY; shared client connections.'};(dest/'logoff-tsd.json').write_text(json.dumps(meta))
 result={'base':base,'images':{},'hashes':{},'apk':meta}
 for kind in base:
  extra=''
  if kind=='api':extra='\nENV WMS_YANDEX_FBY_ENABLED=true\nCOPY schema.prisma /app/apps/api/prisma/schema.prisma\nCOPY schema-before.prisma /app/apps/api/prisma/schema-before-lamoda.prisma\nRUN cd /app/apps/api && pnpm exec prisma generate --schema prisma/schema.prisma\n'
  ctx=r/kind;(ctx/'Dockerfile').write_text('FROM '+base[kind]+extra+'\nCOPY payload/ '+roots[kind]+'\n');tag='logoff-'+kind+':yandex-fby-20261028'
  subprocess.run(['docker','build','--network','none','-t',tag,str(ctx)],check=True);image=d('image','inspect',tag,'--format','{{.Id}}');before,after=hashes(base[kind],kind),hashes(image,kind)
  expected={p.relative_to(ctx/'payload').as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in (ctx/'payload').rglob('*') if p.is_file()};assert set(before)<=set(after);assert {n for n in after if before.get(n)!=after[n]}==set(expected);assert all(after[n]==v for n,v in expected.items());result['images'][kind]=image;result['hashes'][kind]=expected
 (r/'verification.json').write_text(json.dumps(result));print(json.dumps(result['images']))
def publish():
 locks=[]
 for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 check();v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());assert pr['state']=='MERGED' and pr['headRefName']=='feature/yandex-fby-workspace';assert not (r/'published.json').exists()
 db=json.loads((r/'db-proof.json').read_text());browser=json.loads((r/'browser-proof.json').read_text());assert db['passed']>=10 and db['fullApiHealth'] and browser['passed']>=8 and browser['isolatedApi']
 os.umask(0o077);others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n not in ['infra-api-1','infra-web-1']}
 with open(r/'database-before.dump','wb') as f:subprocess.run(['docker','exec','infra-postgres-1','sh','-c','pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'],stdout=f,check=True)
 assert (r/'database-before.dump').stat().st_size>10000
 sql=b''
 for name in ['20261028130000_yandex_fby']:
  migration=(r/(name+'.sql')).read_bytes();sql+=migration+("\nINSERT INTO \"_prisma_migrations\" (id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES ('"+str(uuid.uuid4())+"','"+hashlib.sha256(migration).hexdigest()+"',now(),'"+name+"',now(),1);\n").encode()
 subprocess.run(['docker','exec','-i','infra-postgres-1','sh','-c','psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 --single-transaction'],input=sql,check=True)
 for k in base:d('tag',base[k],'logoff-'+k+':before-yandex-fby-20261028')
 def switch(images):
  for k,img in images.items():d('tag',img,'infra-'+k+':latest')
  subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','api','web'],check=True)
 try:
  switch(v['images']);assert json.loads(get('api/v1/health'))['status']=='ok'
  for kind in base:assert d('inspect','infra-'+kind+'-1','--format','{{.Image}}')==v['images'][kind]
  for n,h in v['hashes']['web'].items():assert hashlib.sha256(get(n if n!='index.html' else '?lamoda-fbo='+str(pr['number']))).hexdigest()==h
  assert all(d('inspect',n,'--format','{{.Id}}')==x for n,x in others.items())
 except Exception:switch(base);raise
 v.update(published=True,pr=pr['number'],at=time.time(),otherContainersUnchanged=True,dbProof=db,browserProof=browser);(r/'published.json').write_text(json.dumps(v));print('Published; health, public hashes and isolation verified')
if __name__=='__main__':publish() if sys.argv[-1]=='publish' else stage()
