"""Exact own-WMS API1/web2 release. Capture, stage, merged-PR gate and rollback."""
from pathlib import Path
import sys,json,subprocess,hashlib,fcntl,time,tarfile

R=Path(sys.argv[1]);mode=sys.argv[2];C=Path('/opt/wms-restore/compose.json')
API={'modules/tsd/fbo-box-statistics.js'}
WEB={'index.html','assets/fbo-whole-remaining-20261121.js'}
FLAGS={}

def docker(*args):return subprocess.check_output(['docker',*args],text=True).strip()
def inspect(name,field):return docker('inspect',name,'--format','{{'+field+'}}')
def sha(b):return hashlib.sha256(b).hexdigest()
def hashes(image,prefix):
    raw=docker('run','--rm','--network','none','--entrypoint','sh',image,'-c','find '+prefix+' -type f -exec sha256sum {} +')
    return {line.split(None,1)[1][len(prefix):]:line.split(None,1)[0] for line in raw.splitlines()}
def health():
    for _ in range(45):
        if subprocess.run(['docker','exec','wms-local-api','node','-e',"fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{if(!r.ok||(await r.json()).status!=='ok')throw Error()}).catch(()=>process.exit(1))"],capture_output=True).returncode==0:return
        time.sleep(1)
    raise RuntimeError('API health failed')
prefixes={'api':'/app/apps/api/dist/','web':'/usr/share/nginx/html/'}
if mode=='capture':
    R.mkdir(parents=True,exist_ok=True)
    base={'composeHash':sha(C.read_bytes())}
    for kind in prefixes:
        img=inspect('wms-local-'+kind,'.Image');base[kind]={'image':img,'files':hashes(img,prefixes[kind])}
    docker('cp','wms-local-api:/app/apps/api/dist',str(R/'api-live'))
    with tarfile.open(R/'api-runtime.tar.gz','w:gz') as archive:
        for p in sorted((R/'api-live').rglob('*')):
            if p.is_file():archive.add(p,arcname=p.relative_to(R/'api-live').as_posix(),recursive=False)
    (R/'base.json').write_text(json.dumps(base));print('Captured API/web images and all file hashes')
elif mode=='stage':
    base=json.loads((R/'base.json').read_text());result={}
    for kind,expected in [('api',API),('web',WEB)]:
        assert inspect('wms-local-'+kind,'.Image')==base[kind]['image']
        f=R/('Dockerfile.'+kind);f.write_text('FROM '+base[kind]['image']+'\nCOPY '+kind+'-payload/ '+prefixes[kind]+'\n')
        tag='wms-local-'+kind+':fbo-whole-remaining-20261121'
        docker('build','--network','none','-q','-f',str(f),'-t',tag,str(R))
        img=docker('image','inspect',tag,'--format','{{.Id}}');actual=hashes(img,prefixes[kind]);old=base[kind]['files']
        changes={p:actual[p] for p in actual if old.get(p)!=actual[p]}
        assert set(old)<=set(actual) and set(changes)==expected,(kind,set(changes))
        result[kind]={'image':img,'changes':changes}
    docker('run','--rm','--network','none','-w','/app/apps/api','--entrypoint','node',result['api']['image'],'-e',"require('./dist/modules/tsd/fbo-two-stage.service');require('./dist/modules/client-requests/ozon-assembly-supply.service')")
    (R/'stage.json').write_text(json.dumps(result));print('Staged exact API1/web2; modules loaded')
elif mode=='publish':
    locks=[]
    for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
        Path(name).parent.mkdir(parents=True,exist_ok=True);f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
    base=json.loads((R/'base.json').read_text());stage=json.loads((R/'stage.json').read_text());pr=json.loads((R/'pr.json').read_text())
    assert pr['state']=='MERGED' and pr['headRefName']=='fix/fbo-whole-boxes-remaining' and pr['baseRefName']=='feature/la_panthera'
    assert pr['headRefOid']==json.loads((R/'source.json').read_text())['head']
    assert json.loads((R/'browser-proof.json').read_text())['passed']
    assert json.loads((R/'controls-check.json').read_text())['passed']==24
    assert json.loads((R/'live-proof.json').read_text())['noWrites']
    assert sha(C.read_bytes())==base['composeHash']
    for kind in prefixes:assert inspect('wms-local-'+kind,'.Image')==base[kind]['image']
    old=C.read_bytes();(R/'compose.before.json').write_bytes(old);config=json.loads(old)
    envs={kind:inspect('wms-local-'+kind,'json .Config.Env') for kind in prefixes}
    others={n:inspect(n,'.Id') for n in docker('ps','--format','{{.Names}}').splitlines() if n not in ['wms-local-api','wms-local-web']}
    def start():docker('compose','-f',str(C),'up','-d','--no-deps','--no-build','--pull','never','api','web')
    try:
        for kind in prefixes:config['services'][kind]['image']=stage[kind]['image']
        env=config['services']['api']['environment'];assert isinstance(env,dict);env.update(FLAGS)
        C.write_text(json.dumps(config,indent=2));start();health()
        for kind in prefixes:
            assert inspect('wms-local-'+kind,'.Image')==stage[kind]['image']
            before=dict(v.split('=',1) for v in json.loads(envs[kind]));after=dict(v.split('=',1) for v in json.loads(inspect('wms-local-'+kind,'json .Config.Env')));assert after=={**before,**(FLAGS if kind=='api' else {})}
            assert hashes(stage[kind]['image'],prefixes[kind])=={**base[kind]['files'],**stage[kind]['changes']}
        assert all(inspect(n,'.Id')==v for n,v in others.items())
    except Exception:
        C.write_bytes(old);start();health();raise
    (R/'published.json').write_text(json.dumps({'pr':pr['number'],**stage,'health':True,'approvedFlags':FLAGS,'otherContainersUnchanged':True}))
    print('Published exact API1/web2; all hashes, health, environment and other containers verified')
else:raise ValueError(mode)
