"""Record the verified startup fix without rebuilding the unchanged API."""
from pathlib import Path
import hashlib,json,tarfile,shutil,os,urllib.request,sys,io
r=Path(sys.argv[1]);bases=Path('wms/baselines/our-wms');old=bases/'2026-11-09-fabric-host';new=bases/'2026-11-09-fbs-startup'
sha=lambda b:hashlib.sha256(b).hexdigest()
pub=json.loads((r/'published.json').read_text());previous=json.loads((old/'manifest.json').read_text())
assert pub['apiContainerUnchanged'] and pub['otherContainersUnchanged'] and pub['health'];new.mkdir(exist_ok=False)
files={}
with tarfile.open(old/'web-overlay.tar.gz') as archive:
 for member in archive:
  assert member.isfile() and not member.name.startswith('/') and '..' not in Path(member.name).parts
  files[member.name]=archive.extractfile(member).read()
for p in (r/'web-payload').rglob('*'):
 if p.is_file():files[p.relative_to(r/'web-payload').as_posix()]=p.read_bytes()
for name,data in files.items():
 actual=urllib.request.urlopen(os.environ['PUBLIC_URL'].rstrip('/')+'/'+name,timeout=30).read();assert sha(actual)==sha(data),name
assert json.load(urllib.request.urlopen(os.environ['PUBLIC_URL'].rstrip('/')+'/api/v1/health',timeout=30))['status']=='ok'
with tarfile.open(new/'web-overlay.tar.gz','w:gz') as archive:
 for name,data in sorted(files.items()):member=tarfile.TarInfo(name);member.size=len(data);archive.addfile(member,io.BytesIO(data))
shutil.copy2(old/'api-runtime.tar.gz',new/'api-runtime.tar.gz')
artifacts={'api-runtime.tar.gz':previous['artifacts']['api-runtime.tar.gz'],'web-overlay.tar.gz':{'size':(new/'web-overlay.tar.gz').stat().st_size,'sha256':sha((new/'web-overlay.tar.gz').read_bytes()),'files':{n:sha(b) for n,b in files.items()}}}
assert sha((new/'api-runtime.tar.gz').read_bytes())==artifacts['api-runtime.tar.gz']['sha256']
(new/'.gitattributes').write_bytes(b'* -text\n')
for name in ['published.json','browser-proof.json','public-browser-proof.json']:
 (new/name).write_bytes((r/name).read_bytes())
for p in new.iterdir():
 if p.name not in artifacts:artifacts[p.name]={'size':p.stat().st_size,'sha256':sha(p.read_bytes())}
manifest={'sourceParityVerified':False,'containers':{'infra-api-1':previous['containers']['infra-api-1'],'infra-web-1':{'image':pub['image']}},'release':{'pr':pub['pr'],'apiFiles':0,'webFiles':3,'soldUnchanged':True},'artifacts':artifacts}
(new/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print('PASS: published baseline files verified',len(files))
