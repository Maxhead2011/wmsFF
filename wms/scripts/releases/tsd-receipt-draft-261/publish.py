"""Publish only the main LOGOFF TSD channel; preserve containers and servers feed.

Usage on our server: python3 publish.py RELEASE_DIR [--publish]
Default is validation only. Inputs: APK and build_runtime.py proof.json.
"""
from pathlib import Path
import fcntl
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

FILE='logoff-tsd-receipt-draft-261.apk'
BASE_SHA='bb86b6a078e8760a412d54ef5e0c023e7ef85e26d4f45ba58223a3dc68446c87'
CERT='70715af4c2ea269d393f9cfb15806aeee920445a22aac16248e76d621bede5da'

def sha(data):return hashlib.sha256(data).hexdigest()
def run(*args):return subprocess.check_output(args).decode().strip()
def fetch(path):return subprocess.check_output(['curl','-fsS','--max-time','45','https://wms.logoff.pro'+path])
def updated_config(config):
    # FIX: change only the main APK alias; all other applications keep their channel.
    marker=' listen 443 ssl default_server;'
    assert config.count(marker)==1 and '/downloads/'+FILE not in config
    pattern=r'(location = /downloads/logoff-tsd\.apk\s*\{[^}]*?alias )/var/www/wms-updates/logoff-tsd-receipt-voice-260\.apk;'
    result,n=re.subn(pattern,lambda m:m.group(1)+'/var/www/wms-updates/'+FILE+';',config)
    assert n==1,'Unexpected main APK alias'
    return result.replace(marker,marker+'\n location = /downloads/'+FILE+' {\n  alias /var/www/wms-updates/'+FILE+';\n  default_type application/vnd.android.package-archive;\n }\n',1)

def main():
    root=Path(sys.argv[1]); publish='--publish' in sys.argv[2:]
    target=Path('/var/www/wms-updates'); cfg=Path('/etc/nginx/sites-available/default')
    locks=[]
    for name in ('/opt/logoff-wms/.release.lock','/opt/wms-restore/.release-pr863.lock','/run/logoff-wms-web-release.lock'):
        lock=open(name,'a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(lock)
    proof=json.loads((root/'proof.json').read_text());payload=(root/FILE).read_bytes()
    assert proof['versionCode']==261 and proof['baselineApkSha256']==BASE_SHA
    assert proof['certificateSha256']==CERT and proof['originalMethodsPreserved'] and proof['allOtherResourcesPreserved']
    assert sha(payload)==proof['apkSha256'] and len(payload)==proof['apkSize']
    metadata=target/'logoff-tsd.json';old=metadata.read_bytes();previous=json.loads(old)
    assert previous['versionCode']==260 and previous['packageId']=='pro.logoff.wms.tsd'
    assert previous['sha256']==BASE_SHA and sha((target/'logoff-tsd-receipt-voice-260.apk').read_bytes())==BASE_SHA
    assert json.loads(fetch('/downloads/logoff-tsd.json'))==previous
    servers=(target/'logoff-tsd-server-choice.json').read_bytes()
    before=cfg.read_bytes();after=updated_config(before.decode())
    containers=run('docker','inspect','--format','{{.Id}} {{.Image}}','wms-local-api','wms-local-web')
    snapshot=dict(apiWebContainers=containers,nginxSha256=sha(before),metadataSha256=sha(old),serversFeedSha256=sha(servers))
    (root/'preflight.json').write_text(json.dumps(snapshot,indent=2))
    if not publish:print('Preflight OK; no publication performed');return
    assert not (root/'published.json').exists(),'Already published'
    (root/'nginx.before').write_bytes(before);(root/'metadata.before').write_bytes(old)
    try:
        dest=target/FILE
        assert not dest.exists() or sha(dest.read_bytes())==proof['apkSha256']
        tmp=target/(FILE+'.tmp');tmp.write_bytes(payload);tmp.chmod(0o644);tmp.replace(dest)
        cfg.write_text(after);run('nginx','-t');run('systemctl','reload','nginx')
        assert sha(fetch('/downloads/'+FILE))==proof['apkSha256']
        assert sha(fetch('/downloads/logoff-tsd.apk'))==proof['apkSha256']
        value=dict(versionCode=261,versionName='0.1.261-receipt-draft',packageId='pro.logoff.wms.tsd',
                   apkUrl='https://wms.logoff.pro/downloads/'+FILE,sha256=proof['apkSha256'],size=proof['apkSize'],
                   releaseNotes='Сканы приёмки сохраняются при повторном открытии короба и перезапуске приложения.',
                   releasedAt=datetime.now(timezone.utc).isoformat())
        tmp=target/'logoff-tsd.json.tmp';tmp.write_text(json.dumps(value,ensure_ascii=False));tmp.chmod(0o644);tmp.replace(metadata)
        assert json.loads(fetch('/downloads/logoff-tsd.json'))==value
        assert (target/'logoff-tsd-server-choice.json').read_bytes()==servers
        assert run('docker','inspect','--format','{{.Id}} {{.Image}}','wms-local-api','wms-local-web')==containers
        fetch('/');fetch('/api/health')
    except Exception:
        metadata.write_bytes(old);cfg.write_bytes(before);run('nginx','-t');run('systemctl','reload','nginx');raise
    result=dict(versionCode=261,apkSha256=proof['apkSha256'],publicHashesVerified=True,
                containersUnchanged=True,serversFeedUnchanged=True,sourceParityVerified=False)
    (root/'published.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))

if __name__=='__main__':main()
