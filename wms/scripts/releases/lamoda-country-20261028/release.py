from pathlib import Path
import subprocess,json,hashlib,fcntl,urllib.request,sys,time
r=Path('/opt/logoff-wms/wms/work/lamoda-country-20261028');app=Path('/opt/logoff-wms/wms');base='sha256:d5cb501edd0bfbdfd450af6525ef9068e71cb3468e9079e660bd2ca0c9c0dcea';web='sha256:fa79b7e9d3b0393885e07e2df59d655642363cac0eabe720491e377216275d39';target='/app/apps/api/dist/modules/lamoda/lamoda-client.js'
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def check():
 assert d('inspect','infra-api-1','--format','{{.Image}}')==base
 assert d('inspect','infra-web-1','--format','{{.Image}}')==web
def hashes(img):return {line.split(maxsplit=1)[1]:line.split()[0] for line in d('run','--rm','--network','none','--entrypoint','sh',img,'-c','find /app/apps/api/dist -type f -exec sha256sum {} +').splitlines()}
def stage():
 check();(r/'Dockerfile').write_text('FROM '+base+'\nCOPY lamoda-client.js '+target+'\n')
 subprocess.run(['docker','build','--network','none','-t','logoff-api:lamoda-country-20261028',str(r)],check=True)
 image=d('image','inspect','logoff-api:lamoda-country-20261028','--format','{{.Id}}');before,after=hashes(base),hashes(image)
 assert before.keys()==after.keys();assert [n for n in after if before[n]!=after[n]]==[target]
 info=json.loads(d('inspect','infra-api-1'))[0];envfile=r/'test.env';envfile.write_text('\n'.join(info['Config']['Env'])+'\n');envfile.chmod(0o600)
 try:
  proof=json.loads(d('run','--rm','--network',next(iter(info['NetworkSettings']['Networks'])),'--env-file',str(envfile),'-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','-v',str(r)+':/test:ro','--entrypoint','node',image,'/test/probe.cjs').splitlines()[-1]);assert proof['passed']==3 and proof['readOnly']
 finally:envfile.unlink()
 out={'base':base,'web':web,'image':image,'hash':after[target],'proof':proof};(r/'verification.json').write_text(json.dumps(out));print(json.dumps(out))
def publish():
 locks=[]
 for path in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  f=open(path,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 check();pr=json.loads((r/'pr.json').read_text());assert pr['state']=='MERGED' and pr['headRefName']=='fix/lamoda-catalog-country';v=json.loads((r/'verification.json').read_text());assert not (r/'published.json').exists();assert v['proof']['passed']==3
 others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='infra-api-1'};env=(app/'.env').read_bytes();d('tag',base,'logoff-api:before-lamoda-country-20261028')
 def switch(img):
  d('tag',img,'infra-api:latest');subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','api'],check=True)
 try:
  switch(v['image'])
  for attempt in range(30):
   try:
    assert json.load(urllib.request.urlopen('https://wms.logoff.pro/api/v1/health',timeout=10))['status']=='ok';break
   except Exception:
    if attempt==29:raise
    time.sleep(1)
  assert d('exec','infra-api-1','sha256sum',target).split()[0]==v['hash'];assert env==(app/'.env').read_bytes() and all(d('inspect',n,'--format','{{.Id}}')==i for n,i in others.items())
 except Exception:switch(base);raise
 v.update(published=True,pr=pr['number'],webUnchanged=True,businessDataUnchanged=True,at=time.time());(r/'published.json').write_text(json.dumps(v));print(json.dumps(v))
if sys.argv[-1]=='publish':publish()
else:stage()

