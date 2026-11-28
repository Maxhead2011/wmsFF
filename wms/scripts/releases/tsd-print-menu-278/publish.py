"""Publish server-choice278 only."""
from pathlib import Path
from datetime import datetime,timezone
import subprocess,json,sys,hashlib,re,fcntl,time
r=Path(sys.argv[1]);apply='--publish' in sys.argv[2:]
def sha(b):return hashlib.sha256(b).hexdigest()
def run(*a):return subprocess.check_output(a)
def fetch(p):return run('curl','-fsS','--max-time','45','https://wms.logoff.pro'+p)
locks=[]
for n in ['/opt/logoff-wms/.release.lock','/opt/wms-restore/.release-pr863.lock','/run/logoff-wms-web-release.lock']:
 f=open(n,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
pr=json.loads((r/'pr.json').read_text());assert pr['merged'] and pr['base']=='feature/la_panthera'
assert (r/'api-verified.json').is_file()
root=Path('/var/www/wms-updates');cfg=Path('/etc/nginx/sites-available/default');oldcfg=cfg.read_bytes();config=oldcfg.decode();oldmetas={};values={}
channels=[('logoff-tsd-server-choice','logoff-tsd-servers-print-menu-278',277)]
for channel,file,version in channels:
 proof=json.loads((r/(file+'.json')).read_text());payload=(r/(file+'.apk')).read_bytes();oldmetas[channel]=(root/(channel+'.json')).read_bytes();old=json.loads(oldmetas[channel])
 assert old['versionCode']==version and old['sha256']==proof['baselineSha256'] and old['packageId']==proof['packageId']
 assert proof['versionCode']==278 and proof['resourcesPreserved'] and proof['certificateSha256']=='70715af4c2ea269d393f9cfb15806aeee920445a22aac16248e76d621bede5da'
 assert sha(payload)==proof['sha256'] and len(payload)==proof['size']
 assert json.loads(fetch('/downloads/'+channel+'.json'))==old
 pattern=r'(location = /downloads/'+re.escape(channel)+r'\.apk\s*\{\s*alias )[^;]+;'
 config,count=re.subn(pattern,lambda m:m.group(1)+'/var/www/wms-updates/'+file+'.apk;',config);assert count==2,(channel,count)
 anchor='location = /downloads/'+channel+'.apk'
 route='location = /downloads/'+file+'.apk { alias /var/www/wms-updates/'+file+'.apk; default_type application/vnd.android.package-archive; }\n '
 assert config.count(anchor)==2;config=config.replace(anchor,route+anchor)
 values[channel]={k:proof[k] for k in ['packageId','versionCode','versionName','sha256','size']}
 values[channel].update(apkUrl='https://wms.logoff.pro/downloads/'+file+'.apk',releasedAt=datetime.now(timezone.utc).isoformat(),releaseNotes='Print replaces Phone in the main menu; no duplicate Print button')
assert json.loads(fetch('/api/v1/health'))['status']=='ok'
if not apply:print('Server-choice278 preflight passed');sys.exit()
assert not (r/'apk-published.json').exists();(r/'nginx.before').write_bytes(oldcfg)
for channel,b in oldmetas.items():(r/(channel+'.before.json')).write_bytes(b)
try:
 for channel,file,_ in channels:
  p=root/(file+'.apk');tmp=p.with_suffix('.tmp');tmp.write_bytes((r/(file+'.apk')).read_bytes());tmp.chmod(0o644);tmp.replace(p)
 cfg.write_text(config);run('nginx','-t');run('systemctl','reload','nginx')
 for channel,file,_ in channels:
  for attempt in range(10):
   if sha(fetch('/downloads/'+channel+'.apk'))==values[channel]['sha256']:break
   time.sleep(1)
  else:raise RuntimeError('Public APK did not converge')
  assert sha(fetch('/downloads/'+file+'.apk'))==values[channel]['sha256']
 for channel,value in values.items():
  p=root/(channel+'.json');tmp=p.with_suffix('.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False));tmp.chmod(0o644);tmp.replace(p)
 for channel,value in values.items():assert json.loads(fetch('/downloads/'+channel+'.json'))==value
except Exception:
 for channel,b in oldmetas.items():(root/(channel+'.json')).write_bytes(b)
 cfg.write_bytes(oldcfg);run('nginx','-t');run('systemctl','reload','nginx');raise
(r/'apk-published.json').write_text(json.dumps(values,indent=2));print(json.dumps(values))
