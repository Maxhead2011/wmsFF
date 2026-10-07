"""FIX: publish the status filter by overlaying only the current web graph; API untouched."""
import fcntl, hashlib, json, pathlib, shutil, subprocess, sys, urllib.request
ROOT=pathlib.Path('/opt/logoff-wms-releases/billing-invoice-status-20261003')
COMPOSE=['docker','compose','--project-name','infra','--env-file','/opt/logoff-wms/wms/.env','-f','/opt/logoff-wms/wms/infra/docker-compose.yml']
def run(*a):return subprocess.check_output(a,text=True).strip()
def sha(b):return hashlib.sha256(b).hexdigest()
def image(n):return run('docker','inspect','--format','{{.Image}}',n)
def hashes(n,folder):return {l.split('  ',1)[1][len(folder)+1:]:l.split('  ',1)[0] for l in run('docker','exec',n,'find',folder,'-type','f','-exec','sha256sum','{}',';').splitlines()}
def verify(before,after,allowed):
    if set(before)-set(after) or {n for n,d in after.items() if before.get(n)!=d}!=set(allowed):raise RuntimeError('Unexpected runtime delta')
    if any(after.get(n)!=d for n,d in allowed.items()):raise RuntimeError('Runtime checksum mismatch')
def main():
    manifest=json.loads((ROOT/'manifest.json').read_text());bases={n:v['image'] for n,v in manifest['containers'].items()}
    wp=json.loads((ROOT/'web/proof.json').read_text());folder='/usr/share/nginx/html'
    with open('/opt/logoff-wms/.release.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        for n,b in bases.items():
            if image(n)!=b:raise RuntimeError('Production advanced; fresh candidate required: '+n)
        before=hashes('infra-web-1',folder)
        if before!=manifest['artifacts']['web-runtime.tar.gz']['files']:raise RuntimeError('Web baseline drift')
        if before['index.html']!=wp['indexBeforeSha']:raise RuntimeError('Index drift')
        for v in wp['files'].values():
            if before.get('assets/'+v['original'])!=v['originalSha256']:raise RuntimeError('Graph drift')
        untouched={n:run('docker','inspect','--format','{{.Id}}',n) for n in bases if n!='infra-web-1'}
        allowed={'index.html':wp['indexAfterSha'],**{'assets/'+n:v['sha256'] for n,v in wp['files'].items()}}
        payload=ROOT/'web-payload';payload.mkdir(exist_ok=True)
        for n,d in allowed.items():
            src=ROOT/'web'/n.removeprefix('assets/')
            if sha(src.read_bytes())!=d:raise RuntimeError('Upload mismatch '+n)
            dst=payload/n;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dst)
        df=ROOT/'Dockerfile.web';df.write_text('FROM '+bases['infra-web-1']+'\nCOPY web-payload/ '+folder+'/\n')
        tag='logoff-web:billing-invoice-status-20261003'
        subprocess.run(['docker','build','--network','none','-f',str(df),'-t',tag,str(ROOT)],check=True)
        cid=run('docker','create','--network','none','--entrypoint','sh',tag,'-c','sleep 300')
        try:run('docker','start',cid);verify(before,hashes(cid,folder),allowed)
        finally:run('docker','rm','-f',cid)
        run('docker','tag',bases['infra-web-1'],'logoff-web:before-billing-invoice-status-20261003')
        if '--prepare-only' in sys.argv:print('PREPARED; production unchanged');return
        try:
            run('docker','tag',tag,'infra-web')
            subprocess.run(COMPOSE+['up','-d','--no-deps','--no-build','--pull','never','--force-recreate','web'],check=True)
            verify(before,hashes('infra-web-1',folder),allowed)
            for url,d in {'/':wp['indexAfterSha'],**{'/assets/'+n:v['sha256'] for n,v in wp['files'].items()}}.items():
                with urllib.request.urlopen('https://wms.logoff.pro'+url,timeout=15) as r:
                    if sha(r.read())!=d:raise RuntimeError('Public asset mismatch '+url)
            with urllib.request.urlopen('https://wms.logoff.pro/api/v1/health',timeout=15) as r:
                if r.status!=200:raise RuntimeError('Health failed')
            for n,i in untouched.items():
                if run('docker','inspect','--format','{{.Id}}',n)!=i:raise RuntimeError('Unrelated service restarted '+n)
        except Exception:
            run('docker','tag',bases['infra-web-1'],'infra-web')
            subprocess.run(COMPOSE+['up','-d','--no-deps','--no-build','--pull','never','--force-recreate','web'],check=True);raise
        result={'web':image('infra-web-1'),'api':image('infra-api-1'),'preservedWebAssets':len(before)-1,'otherServicesUnchanged':True}
        (ROOT/'published.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':main()
