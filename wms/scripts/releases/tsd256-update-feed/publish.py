"""FIX: additive new-WMS downloads with verified APK and rollback on nginx failure."""
import hashlib, json, subprocess, fcntl
from pathlib import Path
from config import patch

ROOT=Path('/opt/wms-restore/releases/tsd256-update-feed')
CONF=Path('/etc/nginx/sites-available/default')
APK=Path('/opt/wms-restore/releases/fabric-scans-256/logoff-tsd-fabric-256.apk')
SHA='3c5ebf1b9268f620991401e2afd8ca1e17fdae2e9e0e2ada302839b671f77e93'

def run(*args): return subprocess.check_output(args,text=True).strip()
def main():
    lock=open('/run/logoff-wms-web-release.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    pr=json.loads((ROOT/'pr.json').read_text())
    assert pr['state']=='MERGED' and pr['headRefName']=='fix/tsd256-new-wms-update-feed' and pr['baseRefName']=='feature/la_panthera'
    assert hashlib.sha256(APK.read_bytes()).hexdigest()==SHA
    before=CONF.read_bytes();after=patch(before.decode()).encode()
    images=run('docker','ps','--no-trunc','--format','{{.ID}} {{.Image}}')
    (ROOT/'nginx.before').write_bytes(before)
    downloads=Path('/var/www/wms-updates')
    apk=downloads/'logoff-tsd-fabric-256.apk';meta=downloads/'logoff-tsd.json'
    assert not apk.exists() and not meta.exists()
    apk.write_bytes(APK.read_bytes());apk.chmod(0o644)
    meta.write_text(json.dumps({'versionCode':256,'versionName':'0.1.256-fabric-scans','packageId':'pro.logoff.wms.tsd','apkUrl':'https://77.37.144.211/downloads/logoff-tsd-fabric-256.apk','sha256':SHA}));meta.chmod(0o644)
    try:
        CONF.write_bytes(after)
        run('nginx','-t');run('systemctl','reload','nginx')
        assert run('docker','ps','--no-trunc','--format','{{.ID}} {{.Image}}')==images
    except Exception:
        CONF.write_bytes(before);run('nginx','-t');run('systemctl','reload','nginx');raise
    (ROOT/'published.json').write_text(json.dumps({'pr':pr['number'],'version':256,'apkSha256':SHA,'containersUnchanged':True,'nginxBeforeSha256':hashlib.sha256(before).hexdigest(),'nginxAfterSha256':hashlib.sha256(after).hexdigest()}))
    print('New WMS update feed256 published; nginx valid; containers unchanged')

if __name__=='__main__':main()
