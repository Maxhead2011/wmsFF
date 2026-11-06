"""FIX: publish the separate .servers package; never cross Android package channels."""
import hashlib, json, subprocess
from pathlib import Path

def validate(old, new):
    for value in (old,new):
        if value.get('packageId')!='pro.logoff.wms.tsd.servers':
            raise ValueError('Wrong Android package channel')
    if old['versionCode']!=254 or new['versionCode']!=256:
        raise ValueError('Unexpected version; review live channel first')

def patch(text):
    marker=' listen 443 ssl default_server;'
    route='/downloads/logoff-tsd-servers-256.apk'
    if text.count(marker)!=1 or route in text: raise ValueError('Nginx configuration drift')
    return text.replace(marker,marker+'''\n location = /downloads/logoff-tsd-servers-256.apk {
  alias /var/www/wms-updates/logoff-tsd-servers-256.apk;
  default_type application/vnd.android.package-archive;
 }
''',1)

def main():
    import fcntl
    root=Path('/opt/wms-restore/releases/tsd256-servers-feed')
    lock=open('/run/logoff-wms-web-release.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    pr=json.loads((root/'pr.json').read_text())
    assert pr['state']=='MERGED' and pr['headRefName']=='fix/tsd256-servers-update-feed' and pr['baseRefName']=='feature/la_panthera'
    downloads=Path('/var/www/wms-updates');meta=downloads/'logoff-tsd-server-choice.json'
    old=meta.read_bytes();new=json.loads((root/'metadata.json').read_text());validate(json.loads(old),new)
    apk=(root/'logoff-tsd-servers-256.apk').read_bytes()
    assert hashlib.sha256(apk).hexdigest()==new['sha256']
    conf=Path('/etc/nginx/sites-available/default');before=conf.read_bytes();after=patch(before.decode()).encode()
    run=lambda *a:subprocess.check_output(a,text=True).strip()
    containers=run('docker','ps','--no-trunc','--format','{{.ID}} {{.Image}}')
    (root/'metadata.before.json').write_bytes(old);(root/'nginx.before').write_bytes(before)
    target=downloads/'logoff-tsd-servers-256.apk';assert not target.exists();target.write_bytes(apk);target.chmod(0o644)
    try:
        conf.write_bytes(after);run('nginx','-t');run('systemctl','reload','nginx')
        temp=downloads/'logoff-tsd-server-choice.json.tmp';temp.write_text(json.dumps(new));temp.chmod(0o644);temp.replace(meta)
        assert run('docker','ps','--no-trunc','--format','{{.ID}} {{.Image}}')==containers
    except Exception:
        meta.write_bytes(old);conf.write_bytes(before);run('nginx','-t');run('systemctl','reload','nginx');raise
    print('Servers256 feed published; containers unchanged')

if __name__=='__main__':main()
