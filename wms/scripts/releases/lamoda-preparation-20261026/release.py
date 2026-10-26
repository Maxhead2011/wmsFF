"""Exact Lamoda preparation release. Stage is isolated; publish requires merged PR and all proofs."""
from pathlib import Path
import subprocess,json,hashlib,sys,fcntl,time,urllib.request,os,base64
r=Path('/opt/logoff-wms/wms/work/lamoda-preparation-20261026');app=Path('/opt/logoff-wms/wms')
base={'api':'sha256:3a6b672cd7644e6ad0ea000bce8b43ecfe16ee52587a01485d8a77943aea89fa','web':'sha256:15b2a4a23627b701cafcb2dfeda6ab5ed7c093830bc9822eb30b11b5ddf91887'}
roots={'api':'/app/apps/api/dist/','web':'/usr/share/nginx/html/'}
tags={k:'logoff-'+k+':lamoda-preparation-20261026' for k in base}
def d(*args):return subprocess.check_output(['docker',*args],text=True).strip()
def check():
 for k,v in base.items():assert d('inspect','infra-'+k+'-1','--format','{{.Image}}')==v,'Server changed: '+k
def hashes(image,kind):return {line.split(maxsplit=1)[1].removeprefix(roots[kind]):line.split()[0] for line in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find '+roots[kind]+' -type f -exec sha256sum {} +').splitlines()}
def get(name):
 for attempt in range(25):
  try:return urllib.request.urlopen('https://wms.logoff.pro/'+name,timeout=15).read()
  except Exception:
   if attempt==24:raise
   time.sleep(1)
def stage():
 check();result={'base':base,'images':{},'hashes':{}}
 for kind in base:
  extra=''
  if kind=='api':extra='\nENV WMS_LAMODA_ENABLED=true\nCOPY schema.prisma /app/apps/api/prisma/schema.prisma\nCOPY schema-before.prisma /app/apps/api/prisma/schema-before-lamoda.prisma\nRUN cd /app/apps/api && pnpm exec prisma generate --schema prisma/schema.prisma\n'
  root=r/kind;(root/'Dockerfile').write_text('FROM '+base[kind]+extra+'\nCOPY payload/ '+roots[kind]+'\n')
  subprocess.run(['docker','build','--network','none','-t',tags[kind],str(root)],check=True)
  image=d('image','inspect',tags[kind],'--format','{{.Id}}');before,after=hashes(base[kind],kind),hashes(image,kind);expected=json.loads((r/(kind+'-hashes.json')).read_text())
  assert set(before)<=set(after);assert {n for n in after if before.get(n)!=after[n]}==set(expected);assert all(after[n]==v for n,v in expected.items())
  result['images'][kind]=image;result['hashes'][kind]=expected
 (r/'verification.json').write_text(json.dumps(result));print(json.dumps(result['images']))
def publish():
 locks=[]
 for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  h=open(name,'a');fcntl.flock(h,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(h)
 check();result=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());assert pr['state']=='MERGED' and pr['headRefName']=='feature/lamoda-contour'
 assert not (r/'published.json').exists();dbproof=json.loads((r/'db-proof.json').read_text());assert dbproof['passed']==10 and dbproof['isolated'] and dbproof['fullApiHealth'];browser=json.loads((r/'browser-proof.json').read_text());assert browser['passed']>=10 and browser['isolatedApi']
 envfile=app/'.env';compose=app/'infra/docker-compose.yml';env=envfile.read_bytes();config=compose.read_bytes();apk=get('downloads/logoff-tsd.json')
 others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n not in ['infra-api-1','infra-web-1']}
 # Backup remains root-only on the server; credentials are never printed or put into an image.
 os.umask(0o077);(r/'env-before').write_bytes(env);(r/'compose-before.yml').write_bytes(config)
 dbcontainer='infra-postgres-1';assert dbcontainer in others
 with open(r/'database-before.dump','wb') as backup:subprocess.run(['docker','exec',dbcontainer,'sh','-c','pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'],stdout=backup,check=True)
 assert (r/'database-before.dump').stat().st_size>10000
 assert 'WMS_LAMODA_SECRET_KEY' not in env.decode() and 'WMS_LAMODA_SECRET_KEY' not in config.decode()
 import re
 text=config.decode();start=text.index('\n  api:');match=re.search(r'\n  [A-Za-z][A-Za-z0-9_-]*:',text[start+7:]);end=start+7+match.start() if match else len(text)
 section=text[start:end];assert section.count('    environment:')==1
 section=section.replace('    environment:','    environment:\n      WMS_LAMODA_SECRET_KEY: ${WMS_LAMODA_SECRET_KEY}',1);nextconfig=(text[:start]+section+text[end:]).encode()
 secret=base64.b64encode(os.urandom(32)).decode();nextenv=env+b'\nWMS_LAMODA_SECRET_KEY='+secret.encode()+b'\n'
 # Five additive tables in one transaction. An existing table is a hard stop, never overwritten.
 migration=(r/'migration.sql').read_bytes()
 import uuid
 ledger=('\nINSERT INTO "_prisma_migrations" (id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES (\''+str(uuid.uuid4())+'\',\''+hashlib.sha256(migration).hexdigest()+"',now(),'20261026120000_lamoda_preparation',now(),1);\n").encode()
 subprocess.run(['docker','exec','-i',dbcontainer,'sh','-c','psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 --single-transaction'],input=migration+ledger,check=True)
 for kind in base:assert d('image','inspect',tags[kind],'--format','{{.Id}}')==result['images'][kind];d('tag',base[kind],'logoff-'+kind+':before-lamoda-preparation-20261026')
 def switch(images):
  for kind,img in images.items():d('tag',img,'infra-'+kind+':latest')
  subprocess.run(['docker','compose','--env-file',str(envfile),'-f',str(compose),'up','-d','--no-deps','--no-build','--pull','never','api','web'],check=True)
 try:
  envfile.write_bytes(nextenv);compose.write_bytes(nextconfig)
  switch(result['images']);assert json.loads(get('api/v1/health'))['status']=='ok'
  live=subprocess.check_output(['docker','exec','-i','-w','/app/apps/api','infra-api-1','node'],input=(r/'read-only-live.cjs').read_bytes()).decode();result['readOnlyCheck']=json.loads(live);assert result['readOnlyCheck']['noBusinessWrites']
  for kind in base:assert d('inspect','infra-'+kind+'-1','--format','{{.Image}}')==result['images'][kind]
  for name,h in result['hashes']['web'].items():assert hashlib.sha256(get(name if name!='index.html' else '?lamoda-release='+str(pr['number']))).hexdigest()==h
  assert apk==get('downloads/logoff-tsd.json');assert all(d('inspect',n,'--format','{{.Id}}')==v for n,v in others.items())
 except Exception:
  # Additive empty tables and their backup remain for investigation; never destructive automatic DDL.
  envfile.write_bytes(env);compose.write_bytes(config);switch(base);raise
 result.update(published=True,pr=pr['number'],at=time.time(),dbProof=dbproof,browser=browser,otherContainersUnchanged=True,apkUnchanged=True,businessRecordsChanged=False)
 (r/'published.json').write_text(json.dumps(result));print('Published Lamoda preparation; health, hashes and isolation verified')
if __name__=='__main__':
 if sys.argv[-1]=='publish':publish()
 else:stage()
