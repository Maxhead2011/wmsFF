from pathlib import Path
import subprocess,json,shutil
r=Path('/opt/logoff-wms/wms/work/kiz-physical-20261013')
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def hashes(image,root):return {l.split(maxsplit=1)[1].removeprefix(root+'/'):l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find '+root+' -type f -exec sha256sum {} +').splitlines()}
# FIX: offline flatten of the base image; no running container is changed.
def flat_web(image):
 cache=r/'flat-web.json'
 if cache.exists():
  cached=json.loads(cache.read_text());assert cached['base']==image;return cached['image']
 cfg=json.loads(d('image','inspect',image))[0]['Config'];assert not cfg.get('Volumes') and not cfg.get('OnBuild') and not cfg.get('Healthcheck')
 container=d('create',image)
 try:
  with open(r/'web-base-rootfs.tar','wb') as f:subprocess.run(['docker','export',container],stdout=f,check=True)
 finally:d('rm',container)
 changes=[]
 for key in ['Cmd','Entrypoint','Shell']:
  if cfg.get(key):changes+=['--change',key.upper()+' '+json.dumps(cfg[key])]
 for key in ['WorkingDir','User','StopSignal']:
  if cfg.get(key):changes+=['--change',{'WorkingDir':'WORKDIR','User':'USER','StopSignal':'STOPSIGNAL'}[key]+' '+cfg[key]]
 for env in cfg.get('Env',[]):
  key,value=env.split('=',1);changes+=['--change','ENV '+key+'='+json.dumps(value)]
 for key,value in (cfg.get('Labels') or {}).items():changes+=['--change','LABEL '+json.dumps(key)+'='+json.dumps(value)]
 for port in cfg.get('ExposedPorts',{}):changes+=['--change','EXPOSE '+port]
 flat=d('import',*changes,str(r/'web-base-rootfs.tar'),'logoff-web:flat-base-kiz-physical-20261013')
 new=json.loads(d('image','inspect',flat))[0]['Config']
 for key in ['Cmd','Entrypoint','Shell','WorkingDir','User','StopSignal','Env','Labels','ExposedPorts','Volumes','OnBuild','Healthcheck']:
  assert (new.get(key) or None)==(cfg.get(key) or None),key
 assert hashes(flat,'/usr/share/nginx/html')==hashes(image,'/usr/share/nginx/html')
 cache.write_text(json.dumps({'base':image,'image':flat,'configVerified':True,'htmlVerified':True}));return flat
m=json.loads((r/'manifest.json').read_text());images=json.loads((r/'images.json').read_text());api=images['infra-api-1'];web=images['infra-web-1'];assert d('inspect','infra-api-1','--format','{{.Image}}')==api and d('inspect','infra-web-1','--format','{{.Image}}')==web
names=json.loads((r/'api-changes.json').read_text());webNames=json.loads((r/'web-changes.json').read_text())
(r/'api/Dockerfile').write_text('FROM '+api+'\nENV WMS_KIZ_SOLD_PHYSICAL_REUSE_ENABLED=true\n'+''.join('COPY '+n+' /app/apps/api/dist/'+n+'\n' for n in names))
subprocess.run(['docker','build','--network','none','-t','logoff-api:kiz-physical-20261013',str(r/'api')],check=True)
a=d('image','inspect','logoff-api:kiz-physical-20261013','--format','{{.Id}}');ah=hashes(a,'/app/apps/api/dist');old=m['artifacts']['api-runtime.tar.gz']['files'];assert set(old)<=set(ah) and {n for n in ah if old.get(n)!=ah[n]}==set(names)
for n in webNames:
 dest=r/'web/html'/n;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(r/'web'/n,dest)
(r/'web/Dockerfile').write_text('FROM '+web+'\nCOPY html/ /usr/share/nginx/html/\n')
subprocess.run(['docker','build','--network','none','-t','logoff-web:kiz-physical-20261013',str(r/'web')],check=True)
b=d('image','inspect','logoff-web:kiz-physical-20261013','--format','{{.Id}}');bh=hashes(b,'/usr/share/nginx/html');oldWeb=hashes(web,'/usr/share/nginx/html');assert set(oldWeb)<=set(bh) and {n for n in bh if oldWeb.get(n)!=bh[n]}==set(webNames)
network=next(iter(json.loads(d('inspect','infra-api-1','--format','{{json .NetworkSettings.Networks}}'))))
smoke=d('run','--rm','--network',network,'--env-file','/opt/logoff-wms/wms/.env','-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','-v',str(r)+':/test:ro','--entrypoint','node',a,'/test/smoke.cjs');proof=json.loads(smoke.splitlines()[-1]);assert proof['passed']
v={'passed':True,'base':api,'candidate':a,'changed':names,'hashes':ah,'web':{'base':web,'candidate':b,'changed':webNames,'hashes':bh},'proof':proof}
(r/'verification.json').write_text(json.dumps(v));print('STAGE VERIFIED')
