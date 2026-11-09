"""APK-only release. No container, business-data, environment or sold-WMS changes."""
from pathlib import Path
import subprocess,json,hashlib,fcntl,re,time,sys
R=Path(sys.argv[1]);base=sys.argv[2].rstrip('/')
D=Path('/var/www/wms-updates');C=Path('/etc/nginx/sites-available/default')
def run(*a): return subprocess.check_output(a,text=True).strip()
def sha(b): return hashlib.sha256(b).hexdigest()
def fetch(url): return subprocess.check_output(['curl','--max-time','20','-fsS',url])
proof=json.loads((R/'signed-proof.json').read_text());assert len(proof)==2
channels=['logoff-tsd.json','logoff-tsd-server-choice.json']
lock=open('/run/logoff-wms-web-release.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
before=C.read_bytes();config=before.decode();old={}
containers=run('docker','ps','--no-trunc','--format','{{.ID}} {{.Image}}')
marker=' listen 443 ssl default_server;';assert config.count(marker)==1
for meta,item in zip(channels,proof):
 old[meta]=(D/meta).read_bytes();previous=json.loads(old[meta]);assert previous['versionCode']==259 and previous['packageId']==item['packageId']
 assert item['versionCode']==260 and sha((R/item['file']).read_bytes())==item['sha256']
 assert re.fullmatch(r'logoff-tsd-(servers-)?receipt-voice-260\.apk',item['file'])
 assert not (D/item['file']).exists() or sha((D/item['file']).read_bytes())==item['sha256']
 assert '/downloads/'+item['file'] not in config
 config=config.replace(marker,marker+'\n location = /downloads/'+item['file']+' {\n  alias /var/www/wms-updates/'+item['file']+';\n  default_type application/vnd.android.package-archive;\n }\n',1)
pattern=r'(location = /downloads/logoff-tsd\.apk\s*\{[^}]*?alias )/var/www/wms-updates/logoff-tsd-ozon-product-259\.apk;'
config,n=re.subn(pattern,lambda m:m.group(1)+'/var/www/wms-updates/'+proof[0]['file']+';',config);assert n==1
(R/'nginx.before').write_bytes(before)
for name,value in old.items():(R/(name+'.before')).write_bytes(value)
try:
 for item in proof:
  (D/item['file']).write_bytes((R/item['file']).read_bytes());(D/item['file']).chmod(0o644)
 C.write_text(config);run('nginx','-t');run('systemctl','reload','nginx')
 for item in proof:
  for attempt in range(20):
   try: assert sha(fetch(base+'/downloads/'+item['file']))==item['sha256'];break
   except Exception:
    if attempt==19: raise
    time.sleep(.5)
 for meta,item in zip(channels,proof):
  value=dict(versionCode=260,versionName='0.1.260-receipt-voice',packageId=item['packageId'],apkUrl=base+'/downloads/'+item['file'],sha256=item['sha256'],size=item['size'])
  tmp=D/(meta+'.tmp');tmp.write_text(json.dumps(value));tmp.chmod(0o644);tmp.replace(D/meta)
  assert json.loads(fetch(base+'/downloads/'+meta))==value
 assert sha(fetch(base+'/downloads/logoff-tsd.apk'))==proof[0]['sha256']
 assert run('docker','ps','--no-trunc','--format','{{.ID}} {{.Image}}')==containers
except Exception:
 for name,value in old.items():(D/name).write_bytes(value)
 C.write_bytes(before);run('nginx','-t');run('systemctl','reload','nginx');raise
result=dict(versionCode=260,channels=proof,publicHashesVerified=True,containersUnchanged=True,sourceParityVerified=False)
(R/'published.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
