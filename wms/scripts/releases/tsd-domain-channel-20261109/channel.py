"""Own-domain TSD channels share the active VM default HTTPS update route."""
from pathlib import Path
import re,sys,json,hashlib,subprocess
PATTERN=r'^/downloads/logoff-tsd(?:-[a-z0-9-]+)?\.(?:json|apk)$'
BLOCK='''    # FIX: one authoritative TSD channel for domain and direct access.
    location ~ ^/downloads/logoff-tsd(?:-[a-z0-9-]+)?\\.(?:json|apk)$ {
        proxy_pass https://127.0.0.1;
        proxy_set_header Host 127.0.0.1;
        proxy_ssl_server_name off;
        proxy_cache off;
        proxy_hide_header Cache-Control;
        add_header Cache-Control "no-store" always;
    }
'''
def patch(source):
    marker='    listen 443 ssl;\n'
    assert source.count(marker)==1
    assert 'server_name wms.logoff.pro;' in source
    assert '/downloads/logoff-tsd' not in source
    return source.replace(marker,marker+BLOCK,1)
def verify(base,reference):
    import urllib.request
    for channel in ['logoff-tsd.json','logoff-tsd-server-choice.json']:
        def fetch(url):
            with urllib.request.urlopen(url,timeout=30) as r:return r.read()
        expected=json.loads(fetch(reference+'/downloads/'+channel))
        actual=json.loads(fetch(base+'/downloads/'+channel+'?verification=260'))
        assert actual==expected and actual['versionCode']==260,(channel,actual)
        name=actual['apkUrl'].rsplit('/',1)[1]
        assert hashlib.sha256(fetch(base+'/downloads/'+name)).hexdigest()==actual['sha256']
    print('Both domain channels and APK hashes match version260')
if __name__=='__main__':
    if sys.argv[1]=='verify':verify(sys.argv[2],sys.argv[3]);sys.exit()
    import fcntl
    target=Path(sys.argv[1]);backup=Path(sys.argv[2]);base=sys.argv[3];reference=sys.argv[4]
    lock=open('/run/logoff-wms-web-release.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    def run(*a):return subprocess.check_output(a,text=True).strip()
    containers=run('docker','ps','--no-trunc','--format','{{.ID}} {{.Image}}')
    before=target.read_bytes();candidate=patch(before.decode());backup.write_bytes(before)
    try:
        target.write_text(candidate);run('nginx','-t');run('systemctl','reload','nginx')
        verify(base,reference)
        assert run('docker','ps','--no-trunc','--format','{{.ID}} {{.Image}}')==containers
    except Exception:
        target.write_bytes(before);run('nginx','-t');run('systemctl','reload','nginx');raise
    print('Domain route published; containers unchanged')
