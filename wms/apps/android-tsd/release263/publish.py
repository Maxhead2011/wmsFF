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

FILE='logoff-tsd-packing-modes-263.apk'
BASE_SHA='ef4bfe23e1c650a302b4ce0d1aa68078cbec48a2a905517f115823bfbf9b5db7'
CERT='70715af4c2ea269d393f9cfb15806aeee920445a22aac16248e76d621bede5da'

def sha(data):return hashlib.sha256(data).hexdigest()
def run(*args):return subprocess.check_output(args).decode().strip()
def fetch(path):return subprocess.check_output(['curl','-fsS','--max-time','45','https://wms.logoff.pro'+path])
def updated_config(config):
    # FIX: change only the main APK alias; all other applications keep their channel.
    old='logoff-tsd-box-scan-262.apk'
    assert FILE not in config
    original='location = /downloads/'+old+' { alias /var/www/wms-updates/'+old+'; default_type application/vnd.android.package-archive; }'
    assert config.count(original)==2
    config=config.replace(original,original+'\n '+original.replace(old,FILE))
    pattern=r'(location = /downloads/logoff-tsd\.apk\s*\{\s*alias )/var/www/wms-updates/logoff-tsd-box-scan-262\.apk;'
    result,count=re.subn(pattern,lambda m:m.group(1)+'/var/www/wms-updates/'+FILE+';',config)
    assert count==2,'Unexpected LOGOFF download aliases'
    return result

def main():
    root=Path(sys.argv[1]); publish='--publish' in sys.argv[2:]
    target=Path('/var/www/wms-updates'); cfg=Path('/etc/nginx/sites-available/default')
    locks=[]
    for name in ('/opt/logoff-wms/.release.lock','/opt/wms-restore/.release-pr863.lock','/run/logoff-wms-web-release.lock'):
        lock=open(name,'a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(lock)
    proof=json.loads((root/'proof.json').read_text());payload=(root/FILE).read_bytes()
    assert proof['versionCode']==263 and proof['baselineApkSha256']==BASE_SHA
    assert proof['certificateSha256']==CERT and proof['originalMethodsPreserved'] and proof['allOtherResourcesPreserved']
    assert sha(payload)==proof['apkSha256'] and len(payload)==proof['apkSize']
    metadata=target/'logoff-tsd.json';old=metadata.read_bytes();previous=json.loads(old)
    assert previous['versionCode']==262 and previous['packageId']=='pro.logoff.wms.tsd'
    assert previous['sha256']==BASE_SHA and sha((target/'logoff-tsd-box-scan-262.apk').read_bytes())==BASE_SHA
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
        value=dict(versionCode=263,versionName='0.1.263-packing-modes',packageId='pro.logoff.wms.tsd',
                   apkUrl='https://wms.logoff.pro/downloads/'+FILE,sha256=proof['apkSha256'],size=proof['apkSize'],
                   releaseNotes='ФБО Ozon: выбор упаковки по направлению или по товару.',
                   releasedAt=datetime.now(timezone.utc).isoformat())
        tmp=target/'logoff-tsd.json.tmp';tmp.write_text(json.dumps(value,ensure_ascii=False));tmp.chmod(0o644);tmp.replace(metadata)
        assert json.loads(fetch('/downloads/logoff-tsd.json'))==value
        assert (target/'logoff-tsd-server-choice.json').read_bytes()==servers
        assert run('docker','inspect','--format','{{.Id}} {{.Image}}','wms-local-api','wms-local-web')==containers
        fetch('/');fetch('/api/health')
    except Exception:
        metadata.write_bytes(old);cfg.write_bytes(before);run('nginx','-t');run('systemctl','reload','nginx');raise
    result=dict(versionCode=263,apkSha256=proof['apkSha256'],publicHashesVerified=True,
                containersUnchanged=True,serversFeedUnchanged=True,sourceParityVerified=False)
    (root/'published.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))

if __name__=='__main__':main()

