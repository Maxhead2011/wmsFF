import fcntl,pathlib,json,subprocess,urllib.request,urllib.error,time,hashlib
r=pathlib.Path('/opt/logoff-wms/wms/work/receipt-approval-20261007');app=pathlib.Path('/opt/logoff-wms/wms')
locks=[]
for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-api-release.lock','/run/logoff-wms-web-release.lock']:
 f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def get(name):
 with urllib.request.urlopen('https://wms.logoff.pro/'+name,timeout=30) as response:return response.read()
def health():
 for i in range(25):
  try:assert json.loads(get('api/v1/health'))['status']=='ok';return
  except Exception:
   if i==24:raise
   time.sleep(2)
def flags():return json.loads(d('exec','infra-api-1','node','-e',"console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k,v])=>k.startsWith('WMS_')&&['true','false'].includes(v)))))"))
def switch(kind,image):
 d('tag',image,'infra-'+kind+':latest')
 subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','--timeout','30',kind],check=True)
 assert d('inspect','infra-'+kind+'-1','--format','{{.Image}}')==image
v=json.loads((r/'verification.json').read_text());old=json.loads((r/'before.json').read_text());pr=json.loads((r/'pr.json').read_text())
assert v['passed'] and pr['merged'] and pr['mergeCommitSha'] and pr['number']>490
assert json.loads((r/'smoke.json').read_text())['passed']
assert not (r/'published.json').exists()
for kind in ['api','web']:assert d('inspect','infra-'+kind+'-1','--format','{{.Image}}')==v[kind]['base'],'Concurrent release'
assert flags()==old['flags']
others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n not in ['infra-api-1','infra-web-1']}
env=(app/'.env').read_bytes();compose=(app/'infra/docker-compose.yml').read_bytes()
for kind in ['api','web']:d('tag',v[kind]['base'],'logoff-'+kind+':before-receipt-approval-20261007')
try:
 switch('api',v['api']['candidate']);health();assert flags()=={**old['flags'],'WMS_RECEIPT_APPROVAL_ENABLED':'true'}
 print(d('exec','-w','/app/apps/api','infra-api-1','node','-e',(r/'initialize.cjs').read_text()))
 for kind,root in [('api','/app/apps/api/dist')]:
  actual={l.split(maxsplit=1)[1].removeprefix(root+'/'):l.split()[0] for l in d('exec','infra-'+kind+'-1','sh','-c','find '+root+' -type f -exec sha256sum {} +').splitlines()};assert actual==v[kind]['hashes']
 req=urllib.request.Request('https://wms.logoff.pro/api/v1/warehouse/receipt-channels/approval',data=b'{}',headers={'Content-Type':'application/json'},method='POST')
 try:urllib.request.urlopen(req,timeout=20);raise AssertionError('Unauthenticated audit route accepted')
 except urllib.error.HTTPError as e:assert e.code==401,e.code
 print(d('exec','-w','/app/apps/api','infra-api-1','node','-e',(r/'published-smoke.cjs').read_text()))
 switch('web',v['web']['candidate']);health()
 actual={l.split(maxsplit=1)[1].removeprefix('/usr/share/nginx/html/'):l.split()[0] for l in d('exec','infra-web-1','sh','-c','find /usr/share/nginx/html -type f -exec sha256sum {} +').splitlines()};assert actual==v['web']['hashes']
 for name in json.loads((r/'web-changes.json').read_text()):assert hashlib.sha256(get(name)).hexdigest()==v['web']['hashes'][name],name
 assert json.loads(get('downloads/logoff-tsd.json'))==v['apk']
 assert env==(app/'.env').read_bytes() and compose==(app/'infra/docker-compose.yml').read_bytes()
 assert all(d('inspect',name,'--format','{{.Id}}')==identity for name,identity in others.items())
except Exception:
 switch('api',v['api']['base']);switch('web',v['web']['base']);health();raise
result={'published':True,'at':time.time(),'pr':pr['number'],'mergeCommitSha':pr['mergeCommitSha'],'apiImage':v['api']['candidate'],'webImage':v['web']['candidate'],'apk':v['apk'],'otherContainersUnchanged':True,'previousFlagsUnchanged':True,'approvalEnabled':True,'health':True,'databaseMigration':False,'businessRecordsChangedByRelease':False,'scopeInitialized':True,'sourceParityVerified':False}
(r/'published.json').write_text(json.dumps(result));print(json.dumps(result))
