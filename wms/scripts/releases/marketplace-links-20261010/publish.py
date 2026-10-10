from pathlib import Path
import subprocess,json,fcntl,time,re,hashlib,urllib.request
r=Path('/opt/logoff-wms/wms/work/marketplace-links-20261010');app=Path('/opt/logoff-wms/wms');locks=[]
for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-api-release.lock','/run/logoff-wms-web-release.lock']:
 f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def get(n):return urllib.request.urlopen('https://wms.logoff.pro/'+n,timeout=20).read()
def health():
 for i in range(30):
  try:assert json.loads(get('api/v1/health'))['status']=='ok';return
  except Exception:
   if i==29:raise
   time.sleep(2)
def switch(service,image):
 d('tag',image,'infra-'+service+':latest');subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','--timeout','30',service],check=True)
def flags():return json.loads(d('exec','infra-api-1','node','-e',"console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k,v])=>k.startsWith('WMS_')))))"))
v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text());assert v['passed'] and pr['state']=='MERGED';assert not (r/'published.json').exists()
assert d('inspect','infra-api-1','--format','{{.Image}}')==v['base'] and d('inspect','infra-web-1','--format','{{.Image}}')==v['web']['base']
others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n not in ['infra-api-1','infra-web-1']}
env=(app/'.env').read_bytes();oldflags=flags();apk=get('downloads/logoff-tsd.json')
assert not oldflags.get('WMS_MARKETPLACE_PRODUCT_LINK_CLIENTS')
newenv=env
newflags={'WMS_MARKETPLACE_PRODUCT_LINKS_ENABLED':'true','WMS_MARKETPLACE_PRODUCT_LINK_CLIENTS':'c401202c-be57-4310-9939-2ea36767da37'}
for k,value in newflags.items():
 newenv=re.sub(rb'(?m)^'+k.encode()+rb'=[^\r\n]*(?:\r?\n|$)',b'',newenv);newenv=newenv.rstrip(b'\r\n')+b'\n'+k.encode()+b'='+value.encode()+b'\n'
network=next(iter(json.loads(d('inspect','infra-api-1','--format','{{json .NetworkSettings.Networks}}'))))
run=['run','--rm','--network',network,'--env-file',str(app/'.env'),'-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','-v',str(r)+':/test:ro','--entrypoint','node',v['candidate']]
# The running legacy readers ignore the new table until the verified image/flags switch.
init=json.loads(d(*run,'/test/initialize.cjs'));(r/'initialization.json').write_text(json.dumps(init))
d('tag',v['base'],'logoff-api:before-marketplace-links-20261010');d('tag',v['web']['base'],'logoff-web:before-marketplace-links-20261010')
try:
 (app/'.env').write_bytes(newenv);switch('api',v['candidate']);health()
 assert flags()=={**oldflags,**newflags}
 smoke=json.loads(d('exec','-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','infra-api-1','node','-e',(r/'smoke.cjs').read_text()));assert smoke['passed']
 switch('web',v['web']['candidate']);health()
 for n in v['changed']:assert d('exec','infra-api-1','sha256sum','/app/apps/api/dist/'+n).split()[0]==v['hashes'][n]
 for n in v['web']['changed']:assert hashlib.sha256(get(n)).hexdigest()==v['web']['hashes'][n]
 assert get('downloads/logoff-tsd.json')==apk and all(d('inspect',n,'--format','{{.Id}}')==i for n,i in others.items())
except Exception:
 (app/'.env').write_bytes(env);switch('api',v['base']);switch('web',v['web']['base']);health();raise
out={'published':True,'at':time.time(),'pr':553,'api':v['candidate'],'web':v['web']['candidate'],'base':v['base'],'webBase':v['web']['base'],'apk':json.loads(apk),'newFlags':newflags,'initialization':init,'smoke':smoke,'otherContainersUnchanged':True,'stockPublicationSettingsUnchanged':True}
(r/'published.json').write_text(json.dumps(out,indent=2));print(json.dumps(out))
