"""Stage and publish a web-only change on the verified own-WMS image."""
import contextlib
import fcntl
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

APP = Path('/opt/logoff-wms/wms')
ROOT = APP / 'work/request-client-controls-20261101'
WEB = '/usr/share/nginx/html/'
FILES = {'index.html', 'assets/request-client-controls-20261101.js', 'assets/fbo-client-controls-20261101.js'}
BASE = json.loads((ROOT / 'base.json').read_text())

def docker(*args):
    return subprocess.check_output(['docker', *map(str,args)],text=True).strip()

def image(service):
    return docker('inspect','infra-'+service+'-1','--format','{{.Image}}')

def hashes(img):
    output = docker('run','--rm','--network','none','--entrypoint','sh',img,'-c','find '+WEB+' -type f -exec sha256sum {} +')
    return {line.split(maxsplit=1)[1].removeprefix(WEB):line.split()[0] for line in output.splitlines()}

def stage():
    assert all(image(k)==v for k,v in BASE.items())
    ctx = ROOT/'web'
    local = {p.relative_to(ctx/'payload').as_posix():hashlib.sha256(p.read_bytes()).hexdigest()
             for p in (ctx/'payload').rglob('*') if p.is_file()}
    assert set(local)==FILES
    (ctx/'Dockerfile').write_text('FROM '+BASE['web']+'\nCOPY payload/ '+WEB+'\n')
    tag='logoff-web:request-client-controls-20261101'
    docker('build','--network','none','-t',tag,ctx)
    new=docker('image','inspect',tag,'--format','{{.Id}}')
    old_files, new_files=hashes(BASE['web']),hashes(new)
    assert old_files.keys()<=new_files.keys()
    assert {n:h for n,h in new_files.items() if old_files.get(n)!=h}==local
    (ROOT/'verified.json').write_text(json.dumps({'image':new,'hashes':local}))
    print(new,flush=True)

def switch(img):
    docker('tag',img,'infra-web:latest')
    docker('compose','--env-file',APP/'.env','-f',APP/'infra/docker-compose.yml','up','-d','--no-deps','--no-build','--pull','never','web')

def publish():
    with contextlib.ExitStack() as stack:
        for name in ['/run/logoff-wms-release.lock','/opt/logoff-wms/.release.lock','/run/logoff-wms-web-release.lock']:
            lock=stack.enter_context(open(name,'a'))
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        assert all(image(k)==v for k,v in BASE.items())
        pr=json.loads((ROOT/'pr.json').read_text())
        assert pr['merged'] and pr['base']=='feature/la_panthera' and pr['head']=='feature/panthera-request-client-controls'
        proof=json.loads((ROOT/'browser-proof.json').read_text())
        assert all(proof[k] for k in ['bothWbWindows','ozonExcluded','sortBothDirections','buttonColor'])
        candidate=json.loads((ROOT/'verified.json').read_text())
        assert not (ROOT/'published.json').exists()
        docker('tag',BASE['web'],'logoff-web:before-request-client-controls-20261101')
        try:
            switch(candidate['image'])
            assert image('web')==candidate['image'] and image('api')==BASE['api']
            for attempt in range(15):
                try:
                    for name,digest in candidate['hashes'].items():
                        url='https://wms.logoff.pro/'+name+'?check='+str(pr['number'])
                        assert hashlib.sha256(urllib.request.urlopen(url,timeout=10).read()).hexdigest()==digest
                    assert json.load(urllib.request.urlopen('https://wms.logoff.pro/api/v1/health',timeout=10))['status']=='ok'
                    break
                except Exception:
                    if attempt==14:raise
                    time.sleep(1)
        except Exception:
            switch(BASE['web'])
            raise
        record=dict(candidate,published=True,previous=BASE,time=time.time(),pr=pr['number'])
        (ROOT/'published.json').write_text(json.dumps(record))
        print(json.dumps(record),flush=True)

if __name__=='__main__':
    {'stage':stage,'publish':publish}[sys.argv[1]]()
