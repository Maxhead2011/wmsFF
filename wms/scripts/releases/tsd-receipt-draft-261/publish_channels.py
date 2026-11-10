"""Complete APK261 channels for installed main and .servers packages.

Default: preflight only. Pass release directory and --publish for publication.
No app/container restart, inventory writes or sold deployment operations.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
from datetime import datetime,timezone
from publish import wait_hash,fetch,run,sha

MAIN='logoff-tsd-receipt-draft-261.apk'
SERVERS='logoff-tsd-servers-receipt-draft-261.apk'
MAIN_SHA='8c45ee36187dc3b6f5e29e5a0e713cb4f3baa6ed28db9d6e00463e07f2b0b17a'
SERVERS_BASE_SHA='0115239cb0abb26c33b37a06fadfd1d6409213fa32ee9aad8a1c99b684f8ac98'
CERT='70715af4c2ea269d393f9cfb15806aeee920445a22aac16248e76d621bede5da'

def location(name,file):
    mime='application/json' if name.endswith('.json') else 'application/vnd.android.package-archive'
    return ('\n location = /downloads/'+name+' {\n  alias /var/www/wms-updates/'+file+
            ';\n  default_type '+mime+';\n  add_header Cache-Control "no-store" always;\n }\n')

def update_config(config):
    # FIX: LAN HTTP must read the same authoritative feed as HTTPS, not stale container249.
    http=' listen 80 default_server;';https=' listen 443 ssl default_server;'
    assert config.count(http)==config.count(https)==1
    assert '/downloads/'+SERVERS not in config
    assert 'location = /downloads/logoff-tsd-server-choice.apk ' not in config
    aliases={'logoff-tsd.json':'logoff-tsd.json','logoff-tsd.apk':MAIN,MAIN:MAIN,
             'logoff-tsd-server-choice.json':'logoff-tsd-server-choice.json',
             'logoff-tsd-server-choice.apk':SERVERS,SERVERS:SERVERS}
    http_section=config.split(https)[0]
    for name in aliases:assert 'location = /downloads/'+name+' ' not in http_section
    result=config.replace(http,http+''.join(location(k,v) for k,v in aliases.items()),1)
    return result.replace(https,https+location(SERVERS,SERVERS)+location('logoff-tsd-server-choice.apk',SERVERS),1)

def main():
    import fcntl
    root=Path(sys.argv[1]);target=Path('/var/www/wms-updates');cfg=Path('/etc/nginx/sites-available/default')
    locks=[]
    for name in ('/opt/logoff-wms/.release.lock','/opt/wms-restore/.release-pr863.lock','/run/logoff-wms-web-release.lock'):
        f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
    proof=json.loads((root/'proof.json').read_text());payload=(root/SERVERS).read_bytes()
    assert proof['versionCode']==261 and proof['packageId']=='pro.logoff.wms.tsd.servers'
    assert proof['baselineApkSha256']==SERVERS_BASE_SHA and proof['certificateSha256']==CERT
    assert proof['originalMethodsPreserved'] and proof['allOtherResourcesPreserved']
    assert sha(payload)==proof['apkSha256'] and len(payload)==proof['apkSize']
    assert sha((target/MAIN).read_bytes())==MAIN_SHA
    main_meta=(target/'logoff-tsd.json').read_bytes();assert json.loads(main_meta)['sha256']==MAIN_SHA
    metadata=target/'logoff-tsd-server-choice.json';old_meta=metadata.read_bytes();old=json.loads(old_meta)
    assert old['versionCode']==260 and old['packageId']=='pro.logoff.wms.tsd.servers' and old['sha256']==SERVERS_BASE_SHA
    assert json.loads(fetch('/downloads/logoff-tsd-server-choice.json'))==old
    assert json.loads(fetch('/api/v1/health'))['status']=='ok'
    before=cfg.read_bytes();after=update_config(before.decode())
    containers=run('docker','inspect','--format','{{.Id}} {{.Image}}','wms-local-api','wms-local-web')
    (root/'preflight.json').write_text(json.dumps(dict(nginxSha256=sha(before),containers=containers,mainSha256=MAIN_SHA),indent=2))
    if '--publish' not in sys.argv[2:]:print('Channel preflight OK; no changes');return
    assert not (root/'published.json').exists()
    (root/'nginx.before').write_bytes(before);(root/'servers-metadata.before').write_bytes(old_meta)
    def local(path):return subprocess.check_output(['curl','-fsS','--max-time','20','http://127.0.0.1'+path,'-H','Host: 192.168.0.45'])
    try:
        dest=target/SERVERS;assert not dest.exists() or sha(dest.read_bytes())==proof['apkSha256']
        tmp=target/(SERVERS+'.tmp');tmp.write_bytes(payload);tmp.chmod(0o644);tmp.replace(dest)
        cfg.write_text(after);run('nginx','-t');run('systemctl','reload','nginx')
        wait_hash('/downloads/'+SERVERS,proof['apkSha256'])
        wait_hash('/downloads/logoff-tsd-server-choice.apk',proof['apkSha256'])
        value=dict(versionCode=261,versionName='0.1.261-receipt-draft',packageId='pro.logoff.wms.tsd.servers',
                   apkUrl='https://wms.logoff.pro/downloads/'+SERVERS,sha256=proof['apkSha256'],size=proof['apkSize'],
                   releaseNotes='Сохранение сканов короба при повторном открытии и перезапуске.',releasedAt=datetime.now(timezone.utc).isoformat())
        tmp=target/'logoff-tsd-server-choice.json.tmp';tmp.write_text(json.dumps(value,ensure_ascii=False));tmp.chmod(0o644);tmp.replace(metadata)
        assert json.loads(fetch('/downloads/logoff-tsd-server-choice.json'))==value
        assert json.loads(local('/downloads/logoff-tsd-server-choice.json'))==value
        assert local('/downloads/logoff-tsd.json')==main_meta
        assert sha(local('/downloads/logoff-tsd.apk'))==MAIN_SHA
        assert sha(local('/downloads/logoff-tsd-server-choice.apk'))==proof['apkSha256']
        assert (target/'logoff-tsd.json').read_bytes()==main_meta
        assert sha(fetch('/downloads/logoff-tsd.apk'))==MAIN_SHA
        assert run('docker','inspect','--format','{{.Id}} {{.Image}}','wms-local-api','wms-local-web')==containers
        assert json.loads(fetch('/api/v1/health'))['status']=='ok'
    except Exception:
        metadata.write_bytes(old_meta);cfg.write_bytes(before);run('nginx','-t');run('systemctl','reload','nginx');raise
    result=dict(versionCode=261,serversApkSha256=proof['apkSha256'],mainApkUnchanged=True,
                httpAndHttpsVerified=True,containersUnchanged=True,sourceParityVerified=False)
    (root/'published.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))

if __name__=='__main__':main()
