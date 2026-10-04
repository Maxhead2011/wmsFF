"""FIX: pinned download-only LOGOFF release; no API, database or TSD changes."""
import hashlib, json, pathlib, subprocess, urllib.request

ROOT = pathlib.Path('/opt/logoff-wms-releases/mobile-soul-064-20261005')
BASE = 'sha256:8ce347e4185d53dda789006f56386b8cb7974cc9d464b0b6ba8ad7c38ab3b419'
API = 'sha256:eae88e3014252c672e4d0564ae08580dd1e86ebe314dee6a4a004cae64cc7f45'
APK = '0f641586c4245463cf3d878ca8fad7ac90c4859d2eda046c4668459a82ddfac5'
OLD = '2edea8d0893e909ec5af28821604bf27c296f7e3d3f5d08fb52344a7cadd8e34'
TAG = 'logoff-web:mobile-soul-064-20261005'
ROLLBACK = 'logoff-web:before-mobile-soul-064-20261005'
HTML = '/usr/share/nginx/html/'
COMPOSE = ['docker','compose','--project-name','infra','--env-file','/opt/logoff-wms/wms/.env','-f','/opt/logoff-wms/wms/infra/docker-compose.yml']

def run(*args): return subprocess.check_output(args, text=True).strip()
def sha(data): return hashlib.sha256(data).hexdigest()
def hashes(container):
    return dict((line.split('  ',1)[1],line.split('  ',1)[0]) for line in run('docker','exec',container,'find',HTML,'-type','f','-exec','sha256sum','{}',';').splitlines())
def verify(before, after, expected):
    if set(before) != set(after): raise RuntimeError('Unexpected file addition/removal')
    for name, digest in before.items():
        if after[name] != expected.get(name,digest): raise RuntimeError('Unexpected file content: '+name)
def main():
    import fcntl
    with open('/opt/logoff-wms/.release.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if run('docker','inspect','--format','{{.Image}}','infra-web-1') != BASE: raise RuntimeError('Web drift')
        if run('docker','inspect','--format','{{.Image}}','infra-api-1') != API: raise RuntimeError('API drift')
        before = hashes('infra-web-1')
        apk_path = HTML+'downloads/logoff-wms-mobile.apk'
        json_path = HTML+'downloads/logoff-wms-mobile.json'
        if before[apk_path] != OLD: raise RuntimeError('Published APK drift')
        if sha((ROOT/'logoff-wms-mobile.apk').read_bytes()) != APK: raise RuntimeError('Candidate mismatch')
        metadata = json.loads(run('docker','exec','infra-web-1','cat',json_path))
        if metadata['versionCode'] != 26: raise RuntimeError('Published version drift')
        metadata.update(versionCode=27,versionName='0.6.4-soul',mandatory=False,
            releaseNotes='Исправлено отображение онлайн-сборки FBO: этап, отбор, упаковка, короба, КИЗ и сотрудники. Вход через заявку — Онлайн-сборка и исправления. Действия двухэтапной сборки пока не перенесены.')
        (ROOT/'logoff-wms-mobile.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')
        expected = {apk_path: APK,json_path: sha((ROOT/'logoff-wms-mobile.json').read_bytes())}
        before_ids = {name: run('docker','inspect','--format','{{.Id}}',name) for name in run('docker','ps','--format','{{.Names}}').splitlines() if name != 'infra-web-1'}
        run('docker','cp','infra-web-1:'+HTML+'downloads',str(ROOT/'downloads-before'))
        (ROOT/'before.json').write_text(json.dumps(before))
        (ROOT/'Dockerfile').write_text('FROM '+BASE+'\nCOPY logoff-wms-mobile.apk logoff-wms-mobile.json '+HTML+'downloads/\n')
        subprocess.run(['docker','build','--network','none','-t',TAG,str(ROOT)],check=True)
        candidate=run('docker','create','--network','none',TAG)
        try:
            run('docker','start',candidate)
            verify(before,hashes(candidate),expected)
        finally: run('docker','rm','-f',candidate)
        run('docker','tag',BASE,ROLLBACK)
        try:
            run('docker','tag',TAG,'infra-web')
            subprocess.run(COMPOSE+['up','-d','--no-deps','--no-build','--pull','never','--force-recreate','web'],check=True)
            verify(before,hashes('infra-web-1'),expected)
            for name, cid in before_ids.items():
                if run('docker','inspect','--format','{{.Id}}',name)!=cid: raise RuntimeError('Other container changed: '+name)
            for name,digest in expected.items():
                with urllib.request.urlopen('https://wms.logoff.pro/'+name.removeprefix(HTML)+'?release=064',timeout=30) as response:
                    if sha(response.read())!=digest: raise RuntimeError('Public digest mismatch')
        except Exception:
            run('docker','tag',BASE,'infra-web')
            subprocess.run(COMPOSE+['up','-d','--no-deps','--no-build','--pull','never','--force-recreate','web'],check=True)
            raise
        result={'version':'0.6.4-soul','web':run('docker','inspect','--format','{{.Image}}','infra-web-1'),'api':API,'apkSha256':APK,'rollback':ROLLBACK,'unchangedFiles':len(before)-2,'otherContainersUnchanged':len(before_ids),'physicalDeviceVerified':False}
        (ROOT/'published.json').write_text(json.dumps(result,indent=2))
        print(json.dumps(result))
if __name__=='__main__': main()
