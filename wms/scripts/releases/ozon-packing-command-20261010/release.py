# FIX: single-module runtime overlay, release lock, before/after tests and rollback.
from pathlib import Path
import json,subprocess,sys,fcntl,time,urllib.request
r=Path('/opt/logoff-wms/wms/work/ozon-packing-command-20261010');app=Path('/opt/logoff-wms/wms')
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def image(n):return d('inspect',n,'--format','{{.Image}}')
def hashes(img):
 root='/app/apps/api/dist/'
 return {l.split(maxsplit=1)[1].removeprefix(root):l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',img,'-c','find '+root+' -type f -exec sha256sum {} +').splitlines()}
def smoke(img):
 network=next(iter(json.loads(d('inspect','infra-api-1','--format','{{json .NetworkSettings.Networks}}'))))
 return json.loads(d('run','--rm','--network',network,'--env-file',str(app/'.env'),'-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','-v',str(r)+':/test:ro','--entrypoint','node',img,'/test/smoke.cjs'))
def switch(img):
 d('tag',img,'infra-api:latest');subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','--timeout','30','api'],check=True)
if sys.argv[1]=='stage':
 m=json.loads((r/'manifest.json').read_text());base=m['containers']['infra-api-1']['image'];assert image('infra-api-1')==base
 assert image('infra-web-1')==m['containers']['infra-web-1']['image']
 (r/'Dockerfile').write_text('FROM '+base+'\nCOPY fbo-two-stage.service.js /app/apps/api/dist/modules/tsd/fbo-two-stage.service.js\n')
 subprocess.run(['docker','build','--network','none','-t','logoff-api:ozon-packing-command-20261010',str(r)],check=True)
 candidate=d('image','inspect','logoff-api:ozon-packing-command-20261010','--format','{{.Id}}');old=hashes(base);new=hashes(candidate)
 changed=['modules/tsd/fbo-two-stage.service.js'];assert set(old)==set(new) and {n for n in new if old[n]!=new[n]}==set(changed)
 args=['run','--rm','--network','none','-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','-v',str(r)+':/test:ro','--entrypoint','node']
 before=subprocess.run(['docker',*args,base,'--test','/test/runtime.cjs'],capture_output=True,text=True);assert before.returncode!=0
 out=d(*args,candidate,'--test','/test/runtime.cjs');assert '# fail 0' in out;(r/'runtime.log').write_text(out)
 proof=smoke(candidate);assert proof['passed']
 v={'passed':True,'base':base,'candidate':candidate,'hashes':new,'changed':changed,'proof':proof};(r/'verification.json').write_text(json.dumps(v));print(json.dumps({'passed':True,'proof':proof}))
else:
 locks=[]
 for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());assert v['passed'] and pr['merged'] and not (r/'published.json').exists();assert image('infra-api-1')==v['base']
 others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='infra-api-1'};env=(app/'.env').read_bytes()
 d('tag',v['base'],'logoff-api:before-ozon-packing-command-20261010')
 try:
  switch(v['candidate'])
  for attempt in range(20):
   try:
    assert json.load(urllib.request.urlopen('https://wms.logoff.pro/api/v1/health',timeout=15))['status']=='ok';break
   except Exception:
    if attempt==19:raise
    time.sleep(2)
  proof=smoke(v['candidate']);assert proof['passed']
  for n in v['changed']:assert d('exec','infra-api-1','sha256sum','/app/apps/api/dist/'+n).split()[0]==v['hashes'][n]
  assert all(d('inspect',n,'--format','{{.Id}}')==i for n,i in others.items()) and (app/'.env').read_bytes()==env
 except Exception:
  switch(v['base']);raise
 out={'published':True,'at':time.time(),'pr':pr['number'],'api':v['candidate'],'base':v['base'],'web':image('infra-web-1'),'proof':proof,'otherContainersUnchanged':True,'businessRecordsChanged':False};(r/'published.json').write_text(json.dumps(out,indent=2));print(json.dumps(out))
