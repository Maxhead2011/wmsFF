"""FIX: Own WMS only. Exact scan overlay; publish only after merged PR proof."""
from pathlib import Path
import json, subprocess, hashlib, fcntl, time, sys
R = Path('/opt/wms-restore/releases/fabric-scans-256')
C = Path('/opt/wms-restore/compose.json')
BASE = 'sha256:451665ebbe686df5fb0ed19596cf68db06d58d7e538a74fe3a20d3f4f2621b04'
def d(*args): return subprocess.check_output(['docker', *args], text=True).strip()
def sha(data): return hashlib.sha256(data).hexdigest()
def image(): return d('inspect', 'wms-local-api', '--format', '{{.Image}}')
def files(img):
    return {n:h for h,n in (line.split(None,1) for line in d('run','--rm','--network','none','--entrypoint','sh',img,'-c','find /app/apps/api/dist -type f -exec sha256sum {} +').splitlines())}
if sys.argv[-1] == 'stage':
    assert image() == BASE
    (R/'compose.before.json').write_bytes(C.read_bytes())
    (R/'Dockerfile').write_text('FROM '+BASE+'\nENV WMS_FBS_FABRIC_CUT_ENABLED=true\nCOPY payload/ /app/apps/api/dist/\n')
    tag = 'wms-local-api:fabric-scans-256'
    d('build','--network','none','-q','-t',tag,str(R))
    candidate = d('image','inspect',tag,'--format','{{.Id}}')
    a,b = files(BASE),files(candidate)
    expected = {'/app/apps/api/dist/'+p.relative_to(R/'payload').as_posix() for p in (R/'payload').rglob('*.js')}
    assert len(expected)==13 and set(a)<=set(b)
    assert {n for n in b if a.get(n)!=b[n]} == expected
    assert all(sha((R/'payload'/n.split('/dist/')[1]).read_bytes())==b[n] for n in expected)
    result = d('run','--rm','--network','none','-v',str(R)+':/release:ro','--entrypoint','node',candidate,'/release/scan-runtime.cjs','/app/apps/api/dist')
    assert 'fabric scan runtime OK' in result
    (R/'stage.json').write_text(json.dumps({'base':BASE,'candidate':candidate,'hashes':{n:b[n] for n in expected},'runtime':result,'composeSha256':sha(C.read_bytes())}))
    print('Staged exact API13; scan runtime passed')
else:
    locks=[]
    for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
        f=open(name,'a'); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB); locks.append(f)
    proof=json.loads((R/'stage.json').read_text()); pr=json.loads((R/'pr.json').read_text())
    assert pr['state']=='MERGED' and pr['headRefName']=='feature/fbs-fabric-cut-integration' and pr['baseRefName']=='feature/la_panthera'
    assert image()==BASE and sha(C.read_bytes())==proof['composeSha256']
    before=json.loads(C.read_text()); oldenv=json.loads(d('inspect','wms-local-api'))[0]['Config']['Env']
    assert not any(v=='WMS_FBS_FABRIC_CUT_ENABLED=true' for v in oldenv)
    others={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines() if n!='wms-local-api'}
    candidate=json.loads(C.read_text()); candidate['services']['api']['image']=proof['candidate']
    explicit=candidate['services']['api'].get('environment',{})
    assert not any(str(x).startswith('WMS_FBS_FABRIC_CUT_ENABLED') for x in explicit), 'Unexpected explicit flag override'
    def switch(config):
        C.write_text(json.dumps(config,indent=2)); d('compose','-f',str(C),'up','-d','--no-deps','--no-build','--pull','never','api')
    try:
        switch(candidate)
        for attempt in range(45):
            try:
                d('exec','wms-local-api','node','-e',"fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{if(!r.ok||(await r.json()).status!=='ok')process.exit(1)}).catch(()=>process.exit(1))")
                break
            except subprocess.CalledProcessError:
                if attempt==44: raise
                time.sleep(1)
        env=json.loads(d('inspect','wms-local-api'))[0]['Config']['Env']
        assert 'WMS_FBS_FABRIC_CUT_ENABLED=true' in env
        assert all(v in env for v in oldenv if not v.startswith('WMS_FBS_FABRIC_CUT_ENABLED='))
        assert all(d('inspect',n,'--format','{{.Id}}')==v for n,v in others.items()) and image()==proof['candidate']
        live={n:h for h,n in (line.split(None,1) for line in d('exec','wms-local-api','sh','-c','find /app/apps/api/dist -type f -exec sha256sum {} +').splitlines())}
        assert all(live[n]==h for n,h in proof['hashes'].items())
    except Exception:
        switch(before); raise
    (R/'published.json').write_text(json.dumps({'pr':pr['number'],'fabricCutEnabled':True,'otherContainersUnchanged':True,'webImage':d('inspect','wms-local-web','--format','{{.Image}}'),**proof}))
    print('Published enabled API13; health, hashes, flags and other containers verified')
