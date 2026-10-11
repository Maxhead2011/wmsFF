from pathlib import Path
import subprocess,json,fcntl,time,hashlib,urllib.request,urllib.error
r=Path('/opt/logoff-wms/wms/work/fbs-manual-20261011');app=Path('/opt/logoff-wms/wms');locks=[]
for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-api-release.lock','/run/logoff-wms-web-release.lock']:
    f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def get(name):
    for attempt in range(25):
        try:return urllib.request.urlopen('https://wms.logoff.pro/'+name,timeout=15).read()
        except urllib.error.HTTPError as e:
            if e.code not in [502,503,504] or attempt==24:raise
            time.sleep(2)
def health():assert json.loads(get('api/v1/health'))['status']=='ok'
def switch(service,image):
    d('tag',image,'infra-'+service+':latest')
    subprocess.run(['docker','compose','--env-file',str(app/'.env'),'-f',str(app/'infra/docker-compose.yml'),'up','-d','--no-deps','--no-build','--pull','never','--timeout','30',service],check=True)
    assert d('inspect','infra-'+service+'-1','--format','{{.Image}}')==image
def flags():return json.loads(d('exec','infra-api-1','node','-e',"console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k,v])=>k.startsWith('WMS_')&&['true','false'].includes(v)))))"))
def hashes(container,root):return {line.split(maxsplit=1)[1].removeprefix(root+'/'):line.split()[0] for line in d('exec',container,'sh','-c','find '+root+' -type f -exec sha256sum {} +').splitlines()}
v=json.loads((r/'verification.json').read_text());pr=json.loads((r/'pr.json').read_text())
assert v['passed'] and v['proof']['passed'] and pr['state']=='MERGED' and pr['headRefName']=='fix/fbs-manual-release-cursor' and pr['mergeCommit']['oid']
assert not (r/'published.json').exists()
assert d('inspect','infra-api-1','--format','{{.Image}}')==v['base'],'Concurrent API release'
assert d('inspect','infra-web-1','--format','{{.Image}}')==v['web']['base'],'Concurrent web release'
others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n not in ['infra-api-1','infra-web-1']}
oldflags=flags();env=(app/'.env').read_bytes();compose=(app/'infra/docker-compose.yml').read_bytes();apk=get('downloads/logoff-tsd.json')
d('tag',v['base'],'logoff-api:before-fbs-manual-20261011');d('tag',v['web']['base'],'logoff-web:before-fbs-manual-20261011')
try:
    switch('api',v['candidate']);health()
    assert flags()=={**oldflags,'WMS_FBS_MANUAL_ASSEMBLY_ENABLED':'true'}
    assert hashes('infra-api-1','/app/apps/api/dist')==v['hashes']
    try:
        urllib.request.urlopen('https://wms.logoff.pro/api/v1/service/fbs-manual-assembly/capabilities',timeout=20)
        raise AssertionError('Unauthenticated service route accepted')
    except urllib.error.HTTPError as error:assert error.code==401,error.code
    proof=json.loads(d('exec','-w','/app/apps/api','-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','infra-api-1','node','-e',(r/'smoke.cjs').read_text()));assert proof['passed']
    switch('web',v['web']['candidate']);health()
    assert hashes('infra-web-1','/usr/share/nginx/html')==v['web']['hashes']
    for name in v['web']['changed']:assert hashlib.sha256(get(name)).hexdigest()==v['web']['hashes'][name],name
    assert get('downloads/logoff-tsd.json')==apk
    assert (app/'.env').read_bytes()==env and (app/'infra/docker-compose.yml').read_bytes()==compose
    assert all(d('inspect',name,'--format','{{.Id}}')==identity for name,identity in others.items())
except Exception:
    switch('api',v['base']);switch('web',v['web']['base']);health();assert flags()==oldflags
    raise
out={'published':True,'at':time.time(),'pr':pr['number'],'featurePr':561,'mergeCommitSha':pr['mergeCommit']['oid'],'api':v['candidate'],'web':v['web']['candidate'],'base':v['base'],'webBase':v['web']['base'],'apk':json.loads(apk),'flags':flags(),'previousFlagsUnchanged':True,'proof':proof,'otherContainersUnchanged':True,'businessRecordsChanged':False,'health':True,'sourceParityVerified':False}
(r/'published.json').write_text(json.dumps(out,indent=2));print(json.dumps({'published':True,'api':out['api'],'web':out['web'],'manualFbsEnabled':True,'health':True,'apkUnchanged':True}))
