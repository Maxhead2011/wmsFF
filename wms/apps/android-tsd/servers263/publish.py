"""Own-WMS server-choice APK only. Requires merged PR; rollback feed/config on failure."""
from pathlib import Path
import json,hashlib,re,subprocess,sys
from datetime import datetime,timezone
FILE='logoff-tsd-servers-packing-modes-263.apk'
PACKAGE='pro.logoff.wms.tsd.servers'
BASE='a09aa749d6c9540b4df866feb33210ae8e1510a513e5467432cac870964e6858'
MAIN='c2025ece773dffec3b38472b5e8d159c6a0912a8cc533e27f3ce6361cd0e3ffa'
def sha(b):return hashlib.sha256(b).hexdigest()
def validate(old,proof):
    assert old['packageId']==proof['packageId']==PACKAGE
    assert old['versionCode']==261 and proof['versionCode']==263
    assert old['sha256']==proof['baselineSha256']==BASE and proof['mainSha256']==MAIN
    assert proof['storageAndUpdateCodePreserved'] and proof['resourcesPreserved']
    assert proof['certificateSha256']=='70715af4c2ea269d393f9cfb15806aeee920445a22aac16248e76d621bede5da'
def patch(config):
    # FIX: both HTTP/HTTPS aliases must resolve the same compatible package.
    old='logoff-tsd-servers-receipt-draft-261.apk'
    assert FILE not in config
    anchor='location = /downloads/'+old+' {'
    assert config.count(anchor)==2
    route='location = /downloads/'+FILE+' { alias /var/www/wms-updates/'+FILE+'; default_type application/vnd.android.package-archive; }\n '
    result=config.replace(anchor,route+anchor)
    result,count=re.subn(r'(location = /downloads/logoff-tsd-server-choice\.apk\s*\{\s*alias )/var/www/wms-updates/'+re.escape(old)+r';',lambda m:m.group(1)+'/var/www/wms-updates/'+FILE+';',result)
    assert count==2
    return result
def main():
    import fcntl
    root=Path(sys.argv[1]);apply='--publish' in sys.argv[2:]
    run=lambda *a:subprocess.check_output(a).decode().strip()
    fetch=lambda p:subprocess.check_output(['curl','-fsS','--max-time','45','https://wms.logoff.pro'+p])
    locks=[]
    for name in ['/opt/logoff-wms/.release.lock','/opt/wms-restore/.release-pr863.lock','/run/logoff-wms-web-release.lock']:
        lock=open(name,'a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(lock)
    pr=json.loads((root/'pr.json').read_text());assert pr['state']=='MERGED' and pr['headRefName']=='fix/tsd-server-choice-263' and pr['baseRefName']=='feature/la_panthera'
    downloads=Path('/var/www/wms-updates');meta=downloads/'logoff-tsd-server-choice.json';cfg=Path('/etc/nginx/sites-available/default')
    old=meta.read_bytes();proof=json.loads((root/'proof.json').read_text());payload=(root/FILE).read_bytes();validate(json.loads(old),proof)
    assert sha(payload)==proof['apkSha256'] and len(payload)==proof['apkSize']
    assert sha((downloads/'logoff-tsd-servers-receipt-draft-261.apk').read_bytes())==BASE
    mainmeta=(downloads/'logoff-tsd.json').read_bytes();assert json.loads(mainmeta)['sha256']==MAIN
    assert json.loads(fetch('/downloads/logoff-tsd-server-choice.json'))==json.loads(old)
    config=cfg.read_bytes();candidate=patch(config.decode());containers=run('docker','ps','--no-trunc','--format','{{.ID}} {{.Image}}')
    if not apply:print('Preflight OK');return
    assert not (root/'published.json').exists()
    (root/'metadata.before').write_bytes(old);(root/'nginx.before').write_bytes(config)
    try:
        dest=downloads/FILE;assert not dest.exists() or sha(dest.read_bytes())==proof['apkSha256']
        tmp=downloads/(FILE+'.tmp');tmp.write_bytes(payload);tmp.chmod(0o644);tmp.replace(dest)
        cfg.write_text(candidate);run('nginx','-t');run('systemctl','reload','nginx')
        assert sha(fetch('/downloads/'+FILE))==proof['apkSha256']
        assert sha(fetch('/downloads/logoff-tsd-server-choice.apk'))==proof['apkSha256']
        value=dict(packageId=PACKAGE,versionCode=263,versionName='0.1.263-packing-modes',apkUrl='https://wms.logoff.pro/downloads/'+FILE,sha256=proof['apkSha256'],size=proof['apkSize'],releasedAt=datetime.now(timezone.utc).isoformat(),releaseNotes='ТСД с выбором сервера: актуальные режимы упаковки Ozon и проверка короба. Сохранены сессии и очередь сканов.')
        tmp=downloads/'logoff-tsd-server-choice.json.tmp';tmp.write_text(json.dumps(value,ensure_ascii=False));tmp.chmod(0o644);tmp.replace(meta)
        assert json.loads(fetch('/downloads/logoff-tsd-server-choice.json'))==value
        assert (downloads/'logoff-tsd.json').read_bytes()==mainmeta
        assert sha(fetch('/downloads/logoff-tsd.apk'))==MAIN
        assert run('docker','ps','--no-trunc','--format','{{.ID}} {{.Image}}')==containers
        fetch('/api/health')
    except Exception:
        meta.write_bytes(old);cfg.write_bytes(config);run('nginx','-t');run('systemctl','reload','nginx');raise
    result=dict(versionCode=263,packageId=PACKAGE,apkSha256=proof['apkSha256'],containersUnchanged=True,mainChannelUnchanged=True,publicHashesVerified=True)
    (root/'published.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':main()
