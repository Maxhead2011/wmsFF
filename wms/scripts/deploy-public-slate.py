"""FIX: CSS-only public palette overlay; preserve all current application assets."""
import hashlib, json, pathlib, subprocess, urllib.request, time, fcntl

ROOT = pathlib.Path('/opt/logoff-wms-releases/public-slate-20260926')
BASE = 'sha256:f71d461f6762387b3ef16471e0862daf0bda734e4ee76b530a86e9026007bd64'
API = 'sha256:91f592f9ea0420cecefd508b0c3bf64c9ffc1385d35070fe3d601a3832896cd6'
TAG = 'logoff-web:public-slate-20260926'
CSS = 'public-slate-20260926.css'
COMPOSE = ['docker','compose','--project-name','infra','--env-file','/opt/logoff-wms/wms/.env','-f','/opt/logoff-wms/wms/infra/docker-compose.yml']
def run(*args): return subprocess.check_output(args,text=True).strip()
def image(name): return run('docker','inspect','--format','{{.Image}}',name)
def sha(data): return hashlib.sha256(data).hexdigest()
def hashes(container):
    rows=run('docker','exec',container,'find','/usr/share/nginx/html','-type','f','-exec','sha256sum','{}',';')
    return {line.split('  ',1)[1]:line.split('  ',1)[0] for line in rows.splitlines()}
def verify(before,after):
    for path,digest in before.items():
        if not path.endswith('/index.html') and after.get(path)!=digest: raise RuntimeError('Changed asset: '+path)
    if set(after)-set(before)!={'/usr/share/nginx/html/assets/'+CSS}: raise RuntimeError('Unexpected delta')
def main():
    with open('/opt/logoff-wms/.release.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if image('infra-web-1')!=BASE or image('infra-api-1')!=API: raise RuntimeError('Production drift')
        before=hashes('infra-web-1'); api_id=run('docker','inspect','--format','{{.Id}}','infra-api-1')
        old=subprocess.check_output(['docker','exec','infra-web-1','cat','/usr/share/nginx/html/index.html'])
        if old.count(b'</head>')!=1: raise RuntimeError('Unexpected index')
        new=old.replace(b'</head>',('<link rel="stylesheet" href="/assets/'+CSS+'"></head>').encode())
        (ROOT/'index.html').write_bytes(new)
        (ROOT/'before.json').write_text(json.dumps(before))
        (ROOT/'Dockerfile').write_text('FROM '+BASE+'\nCOPY index.html /usr/share/nginx/html/index.html\nCOPY '+CSS+' /usr/share/nginx/html/assets/'+CSS+'\n')
        subprocess.run(['docker','build','--network','none','-t',TAG,str(ROOT)],check=True)
        cid=run('docker','create','--network','none',TAG)
        try:
            run('docker','start',cid); verify(before,hashes(cid))
        finally: run('docker','rm','-f',cid)
        run('docker','tag',BASE,'logoff-web:before-public-slate-20260926')
        try:
            run('docker','tag',TAG,'infra-web')
            subprocess.run(COMPOSE+['up','-d','--no-deps','--no-build','--pull','never','--force-recreate','web'],check=True)
            verify(before,hashes('infra-web-1'))
            if run('docker','inspect','--format','{{.Id}}','infra-api-1')!=api_id: raise RuntimeError('API changed')
            for attempt in range(8):
                try:
                    with urllib.request.urlopen('https://wms.logoff.pro/?palette=20260926',timeout=10) as res:
                        if sha(res.read())!=sha(new): raise RuntimeError('Public index mismatch')
                    with urllib.request.urlopen('https://wms.logoff.pro/assets/'+CSS,timeout=10) as res:
                        if sha(res.read())!=sha((ROOT/CSS).read_bytes()): raise RuntimeError('Public CSS mismatch')
                    break
                except Exception:
                    if attempt==7: raise
                    time.sleep(1)
        except Exception:
            run('docker','tag',BASE,'infra-web')
            subprocess.run(COMPOSE+['up','-d','--no-deps','--no-build','--pull','never','--force-recreate','web'],check=True)
            raise
        result={'web':image('infra-web-1'),'apiUnchanged':api_id,'preservedAssets':len(before)-1,'cssSha256':sha((ROOT/CSS).read_bytes())}
        (ROOT/'published.json').write_text(json.dumps(result)); print(json.dumps(result))
if __name__=='__main__': main()
