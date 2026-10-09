from pathlib import Path
import subprocess,json,fcntl,time,re,hashlib,urllib.request,urllib.error
r=Path('/opt/logoff-wms/wms/work/kiz-found-20261009');app=Path('/opt/logoff-wms/wms');locks=[]
for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
 f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def get(name):
 for attempt in range(20):
  try:return urllib.request.urlopen('https://wms.logoff.pro/'+name,timeout=15).read()
  except urllib.error.HTTPError as e:
   if e.code not in [502,503,504] or attempt==19:raise
   time.sleep(2)
def switch(service,image):
 d('tag',image,'infra-'+service+':latest');subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','--timeout','30',service],check=True)
def flags():return json.loads(d('exec','infra-api-1','node','-e',"console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k,v])=>k.startsWith('WMS_')&&['true','false'].includes(v)))))"))
v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());assert v['passed'] and pr['merged'];assert not (r/'published.json').exists()
assert d('inspect','infra-api-1','--format','{{.Image}}')==v['base'] and d('inspect','infra-web-1','--format','{{.Image}}')==v['web']['base']
others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n not in ['infra-api-1','infra-web-1']}
env=(app/'.env').read_bytes();oldflags=flags();newenv=re.sub(rb'(?m)^WMS_KIZ_FOUND_REVIEW_ENABLED=[^\r\n]*(?:\r?\n|$)',b'',env)
if newenv and not newenv.endswith(b'\n'):newenv+=b'\n'
newenv+=b'WMS_KIZ_FOUND_REVIEW_ENABLED=true\n'
network=next(iter(json.loads(d('inspect','infra-api-1','--format','{{json .NetworkSettings.Networks}}'))))
run=['run','--rm','--network',network,'--env-file',str(app/'.env'),'-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','-e','WMS_KIZ_FOUND_REVIEW_ENABLED=true','-v',str(r)+':/test:ro','--entrypoint','node',v['candidate']]

# No schema migration or warehouse write during publication.
proof={'candidateRuntimeTestsPassed':v['runtimeTestsPassed'],'businessRecordsChanged':False}
d('tag',v['base'],'logoff-api:before-kiz-found-20261009');d('tag',v['web']['base'],'logoff-web:before-kiz-found-20261009')
try:
 (app/'.env').write_bytes(newenv);switch('api',v['candidate']);assert json.loads(get('api/v1/health'))['status']=='ok'
 switch('web',v['web']['candidate']);assert json.loads(get('api/v1/health'))['status']=='ok'
 assert flags()=={**oldflags,'WMS_KIZ_FOUND_REVIEW_ENABLED':'true'}
 for n in v['changed']:assert d('exec','infra-api-1','sha256sum','/app/apps/api/dist/'+n).split()[0]==v['hashes'][n]
 for n in v['web']['changed']:assert hashlib.sha256(get(n)).hexdigest()==v['web']['hashes'][n]
 assert json.loads(get('downloads/logoff-tsd.json'))==v['apk']
 assert all(d('inspect',n,'--format','{{.Id}}')==i for n,i in others.items()) and (app/'.env').read_bytes()==newenv
except Exception:
 (app/'.env').write_bytes(env);switch('api',v['base']);switch('web',v['web']['base']);raise
out={'published':True,'at':time.time(),'pr':pr['number'],'api':v['candidate'],'web':v['web']['candidate'],'base':v['base'],'webBase':v['web']['base'],'apk':v['apk'],'flags':{**oldflags,'WMS_KIZ_FOUND_REVIEW_ENABLED':'true'},'proof':proof,'otherContainersUnchanged':True,'businessRecordsChanged':False}
(r/'published.json').write_text(json.dumps(out,indent=2));print(json.dumps({'published':True,'api':out['api'],'web':out['web'],'apk':222}))
