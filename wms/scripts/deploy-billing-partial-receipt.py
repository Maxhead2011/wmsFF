"""FIX: deploy only settlement reads and receipt UI; compose/financial data untouched."""
import fcntl, hashlib, json, pathlib, re, shutil, subprocess, sys, time, urllib.request
ROOT=pathlib.Path('/opt/logoff-wms-releases/billing-settlements-timeout-20261003')
CF=pathlib.Path('/opt/logoff-wms/wms/infra/docker-compose.yml')
COMPOSE=['docker','compose','--project-name','infra','--env-file','/opt/logoff-wms/wms/.env','-f',str(CF)]
def run(*a):return subprocess.check_output(a,text=True).strip()
def sha(b):return hashlib.sha256(b).hexdigest()
def image(n):return run('docker','inspect','--format','{{.Image}}',n)
def hashes(n,folder):return {l.split('  ',1)[1][len(folder)+1:]:l.split('  ',1)[0] for l in run('docker','exec',n,'find',folder,'-type','f','-exec','sha256sum','{}',';').splitlines()}
def verify(before,after,allowed):
    if set(before)-set(after) or {n for n,d in after.items() if before.get(n)!=d}!=set(allowed):raise RuntimeError('Unexpected runtime delta')
    if any(after.get(n)!=d for n,d in allowed.items()):raise RuntimeError('Runtime checksum mismatch')
def health():
    for _ in range(45):
        try:
            with urllib.request.urlopen('https://wms.logoff.pro/api/v1/health',timeout=5) as r:
                if r.status==200:return
        except Exception:pass
        time.sleep(1)
    raise RuntimeError('API health failed')
def main():
    manifest=json.loads((ROOT/'manifest.json').read_text());bases={n:v['image'] for n,v in manifest['containers'].items()}
    ap=json.loads((ROOT/'api/proof.json').read_text());wp=json.loads((ROOT/'web/proof.json').read_text())
    with open('/opt/logoff-wms/.release.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        for n,b in bases.items():
            if image(n)!=b:raise RuntimeError('Production advanced; fresh candidate required: '+n)
        before_api=hashes('infra-api-1','/app/apps/api/dist');before_web=hashes('infra-web-1','/usr/share/nginx/html')
        if before_api!=manifest['artifacts']['api-runtime.tar.gz']['files']:raise RuntimeError('API baseline drift')
        if before_web!=manifest['artifacts']['web-runtime.tar.gz']['files']:raise RuntimeError('Web baseline drift')
        if before_web['index.html']!=wp['indexBeforeSha']:raise RuntimeError('Web index drift')
        for v in wp['files'].values():
            if v.get('original') and before_web.get('assets/'+v['original'])!=v['originalSha256']:raise RuntimeError('Web graph drift')
        untouched={n:run('docker','inspect','--format','{{.Id}}',n) for n in ['infra-postgres-1','infra-analytics-postgres-1','infra-redis-1','infra-ollama-1']}
        wa={'index.html':wp['indexAfterSha'],**{'assets/'+n:v['sha256'] for n,v in wp['files'].items()}}
        for name,allowed,before,folder in [('api',ap,before_api,'/app/apps/api/dist'),('web',wa,before_web,'/usr/share/nginx/html')]:
            payload=ROOT/(name+'-payload');payload.mkdir(exist_ok=True)
            for n,d in allowed.items():
                src=ROOT/name/(n.removeprefix('assets/') if name=='web' else n)
                if sha(src.read_bytes())!=d:raise RuntimeError('Upload mismatch '+n)
                dst=payload/n;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dst)
            df=ROOT/('Dockerfile.'+name);df.write_text('FROM '+bases['infra-'+name+'-1']+'\nCOPY '+name+'-payload/ '+folder+'/\n')
            subprocess.run(['docker','build','--network','none','-f',str(df),'-t','logoff-'+name+':billing-settlements-timeout-20261003',str(ROOT)],check=True)
            cid=run('docker','create','--network','none','--entrypoint','sh','logoff-'+name+':billing-settlements-timeout-20261003','-c','sleep 300')
            try:run('docker','start',cid);verify(before,hashes(cid,folder),allowed)
            finally:run('docker','rm','-f',cid)
            run('docker','tag',bases['infra-'+name+'-1'],'logoff-'+name+':before-billing-settlements-timeout-20261003')
        print(run('docker','run','--rm','--network','none','--workdir','/app/apps/api','--entrypoint','node','logoff-api:billing-settlements-timeout-20261003','-e',"require('reflect-metadata');require('/app/apps/api/dist/modules/billing/billing-settlements.service');require('/app/apps/api/dist/modules/billing/billing-settlements.policy');console.log('Offline candidate modules loaded')"))
        if '--prepare-only' in sys.argv:print('PREPARED; production unchanged');return
        old=CF.read_text();backup=ROOT/'compose-before.yml';backup.write_text(old);backup.chmod(0o600)
        try:
            for n in ['api','web']:run('docker','tag','logoff-'+n+':billing-settlements-timeout-20261003','infra-'+n)
            subprocess.run(COMPOSE+['up','-d','--no-deps','--no-build','--pull','never','--force-recreate','api','web'],check=True)
            health();verify(before_api,hashes('infra-api-1','/app/apps/api/dist'),ap);verify(before_web,hashes('infra-web-1','/usr/share/nginx/html'),wa)
            for url,d in {'/':wp['indexAfterSha'],**{'/assets/'+n:v['sha256'] for n,v in wp['files'].items()}}.items():
                with urllib.request.urlopen('https://wms.logoff.pro'+url,timeout=15) as r:
                    if sha(r.read())!=d:raise RuntimeError('Public asset mismatch '+url)
            for n,i in untouched.items():
                if run('docker','inspect','--format','{{.Id}}',n)!=i:raise RuntimeError('Unrelated service restarted '+n)
            flag=run('docker','exec','infra-api-1','node','-e','console.log(process.env.WMS_BILLING_DONE_REQUESTS_ENABLED)')
            if flag!='true':raise RuntimeError('Billing flag not enabled')
        except Exception:
            for n in ['api','web']:run('docker','tag',bases['infra-'+n+'-1'],'infra-'+n)
            subprocess.run(COMPOSE+['up','-d','--no-deps','--no-build','--pull','never','--force-recreate','api','web'],check=True)
            health();raise
        result={'api':image('infra-api-1'),'web':image('infra-web-1'),'apiDelta':list(ap),'preservedWebAssets':len(before_web)-1,'billingEnabled':True,'otherServicesUnchanged':True}
        (ROOT/'published.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':main()
