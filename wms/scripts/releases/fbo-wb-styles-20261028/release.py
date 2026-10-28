"""FIX: one-file web release; preserve API, all assets, APK and other containers."""
from pathlib import Path
import subprocess,json,hashlib,sys,fcntl,time,urllib.request
r=Path('/opt/logoff-wms/wms/work/fbo-wb-styles-20261028');app=Path('/opt/logoff-wms/wms')
base={'api':'sha256:48ccf6622d2aad597c8784f8033a0644d5504ac3971d1f614e7449349c0f8140','web':'sha256:14e6a4009f89c83c87d6f3093679a34d7c6940301d3dd4dc62ed40d707e1a429'}
tag='logoff-web:fbo-wb-styles-20261028'
rollback='logoff-web:before-fbo-wb-styles-20261028'
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def check():
 for k,v in base.items():assert d('inspect','infra-'+k+'-1','--format','{{.Image}}')==v,'Release base changed: '+k
def hashes(image):
 return {s.split(maxsplit=1)[1].removeprefix('/usr/share/nginx/html/'):s.split()[0] for s in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find /usr/share/nginx/html -type f -exec sha256sum {} +').splitlines()}
def get(name):
 for attempt in range(10):
  try:return urllib.request.urlopen('https://wms.logoff.pro/'+name,timeout=15).read()
  except Exception:
   if attempt==9:raise
   time.sleep(1)
def stage():
 check();payload=r/'web/payload';assert [p.relative_to(payload).as_posix() for p in payload.rglob('*') if p.is_file()]==['index.html']
 before=d('exec','infra-web-1','cat','/usr/share/nginx/html/index.html')
 assert before.strip()==(r/'public-index.html').read_text().strip()
 assert 'href="/assets/ClientRequestsPanel-DSREBZ1c.css"' in (payload/'index.html').read_text()
 for name in ['after','after-panthera']:
  proof=json.loads((r/name/'proof.json').read_text());assert proof['passed']==9 and proof['syntheticApi'] and not proof['errors'] and not proof['writes']
 for name in ['after-client','after-client-panthera']:
  proof=json.loads((r/name/'proof.json').read_text());assert proof['passed']==7 and proof['role']=='CLIENT' and not proof['errors'] and not proof['writes']
 (r/'web/Dockerfile').write_text('FROM '+base['web']+'\nCOPY payload/ /usr/share/nginx/html/\n')
 subprocess.run(['docker','build','--network','none','-t',tag,str(r/'web')],check=True)
 image=d('image','inspect',tag,'--format','{{.Id}}');old,new=hashes(base['web']),hashes(image)
 # TEST: the index link is the sole change; no JS, CSS, download or old asset is replaced.
 assert set(old)==set(new) and {n for n in new if old[n]!=new[n]}=={'index.html'}
 assert new['index.html']==hashlib.sha256((payload/'index.html').read_bytes()).hexdigest()
 v={'base':base,'web':image,'indexSha256':new['index.html'],'stylesheetSha256':new['assets/ClientRequestsPanel-DSREBZ1c.css'],'unchangedFiles':len(new)-1}
 (r/'verification.json').write_text(json.dumps(v));print(json.dumps(v))
def publish():
 locks=[]
 for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 check();assert not (r/'published.json').exists();v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());assert pr['state']=='MERGED' and pr['headRefName']=='fix/fbo-wb-style-restoration'
 assert d('image','inspect',tag,'--format','{{.Id}}')==v['web']
 others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='infra-web-1'}
 env=(app/'.env').read_bytes();apk=get('downloads/logoff-tsd.json');d('tag',base['web'],rollback)
 def switch(image):
  d('tag',image,'infra-web:latest')
  subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','web'],check=True)
 try:
  switch(v['web']);assert d('inspect','infra-web-1','--format','{{.Image}}')==v['web']
  assert json.loads(get('api/v1/health'))['status']=='ok'
  assert hashlib.sha256(get('?fbo-wb-style='+str(pr['number']))).hexdigest()==v['indexSha256']
  assert hashlib.sha256(get('assets/ClientRequestsPanel-DSREBZ1c.css')).hexdigest()==v['stylesheetSha256']
  assert env==(app/'.env').read_bytes() and apk==get('downloads/logoff-tsd.json')
  assert all(d('inspect',n,'--format','{{.Id}}')==ident for n,ident in others.items())
 except Exception:switch(base['web']);raise
 v.update(published=True,pr=pr['number'],at=time.time(),rollback=rollback,otherContainersUnchanged=True,apkUnchanged=True,businessRecordsChanged=False)
 (r/'published.json').write_text(json.dumps(v));print(json.dumps(v))
if __name__=='__main__':publish() if sys.argv[-1]=='publish' else stage()
