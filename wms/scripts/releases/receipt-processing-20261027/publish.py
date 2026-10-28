"""Stage and publish an exact Ozon selected-label overlay on our WMS only."""
from pathlib import Path
import subprocess,json,fcntl,hashlib,urllib.request,time,sys
r=Path('/opt/logoff-wms/wms/work/receipt-processing-20261027');app=Path('/opt/logoff-wms/wms')
base=json.loads((r/'base.json').read_text())
roots={'api':'/app/apps/api/dist/','web':'/usr/share/nginx/html/'}
tags={k:'logoff-'+k+':receipt-processing-20261027' for k in base}
def d(*args):return subprocess.check_output(['docker',*args],text=True).strip()
def check():
 for k,v in base.items():assert d('inspect','infra-'+k+'-1','--format','{{.Image}}')==v,'New deployment: '+k
def hashes(image,kind):
 return {line.split(maxsplit=1)[1].removeprefix(roots[kind]):line.split()[0] for line in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find '+roots[kind]+' -type f -exec sha256sum {} +').splitlines()}
def get(name):
 for attempt in range(20):
  try:return urllib.request.urlopen('https://wms.logoff.pro/'+name,timeout=15).read()
  except Exception:
   if attempt==19:raise
   time.sleep(1)
def publish():
 locks=[]
 for p in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
  h=open(p,'a');fcntl.flock(h,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(h)
 check();result=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());assert pr['state']=='MERGED' and pr['headRefName']=='feature/receipt-processing-type' and pr['baseRefName']=='feature/wb-print-check'
 dbproof=json.loads((r/'db-proof.json').read_text());isolated=json.loads((r/'isolated-api-proof.json').read_text());assert dbproof['passed']==8 and dbproof['rolledBack'] and dbproof['apiImage']==result['images']['api'];assert isolated['fullApiHealth'] and isolated['apiImage']==result['images']['api'];assert json.loads((r/'browser-proof.json').read_text())['passed']==12;assert json.loads((r/'graph-proof.json').read_text())['passed']==2
 assert not (r/'published.json').exists();env=(app/'.env').read_bytes();apk=get('downloads/logoff-tsd.json')
 others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n not in ['infra-api-1','infra-web-1']}
 for kind in base:
  assert d('image','inspect',tags[kind],'--format','{{.Id}}')==result['images'][kind]
  d('tag',base[kind],'logoff-'+kind+':before-receipt-processing-20261027')
 def switch(images):
  for k,img in images.items():d('tag',img,'infra-'+k+':latest')
  subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','api','web'],check=True)
 try:
  switch(result['images']);assert json.loads(get('api/v1/health'))['status']=='ok'
  for k in base:
   assert d('inspect','infra-'+k+'-1','--format','{{.Image}}')==result['images'][k]
   actual=hashes(result['images'][k],k);assert all(actual[n]==v for n,v in result['hashes'][k].items())
  for n,h in result['hashes']['web'].items():assert hashlib.sha256(get(n if n!='index.html' else '?receipt-processing=20261027')).hexdigest()==h
  assert env==(app/'.env').read_bytes() and apk==get('downloads/logoff-tsd.json')
  assert all(d('inspect',n,'--format','{{.Id}}')==v for n,v in others.items())
 except Exception:
  switch(base);raise
 (r/'published.json').write_text(json.dumps(dict(result,published=True,pr=pr['number'],at=time.time(),otherContainersUnchanged=True,apkUnchanged=True,businessRecordsChanged=False)));print('Published receipt processing; health and exact hashes passed')
if __name__=='__main__':publish()
