"""Record exact published API/web bytes, preserving concurrent runtime changes."""
from pathlib import Path
import hashlib,json,tarfile,shutil,os,urllib.request,sys,io
r=Path(sys.argv[1]);bases=Path('wms/baselines/our-wms');old=bases/'2026-11-09-fbs-reserve-settings';new=bases/'2026-11-09-pvz-loss-settlement'
sha=lambda b:hashlib.sha256(b).hexdigest()
if os.environ.get('PUBLIC_PROXY'):urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({'https':os.environ['PUBLIC_PROXY']})))
pub=json.loads((r/'published.json').read_text());assert pub['health'] and pub['environmentPreservedExceptApprovedPurposeFlag'] and pub['otherContainersUnchanged'];new.mkdir(exist_ok=False)
web={}
with tarfile.open(old/'web-overlay.tar.gz') as archive:
 for member in archive:
  assert member.isfile() and not member.name.startswith('/') and '..' not in Path(member.name).parts
  web[member.name]=archive.extractfile(member).read()
for p in (r/'web-payload').rglob('*'):
 if p.is_file():web[p.relative_to(r/'web-payload').as_posix()]=p.read_bytes()
for name,data in web.items():assert sha(urllib.request.urlopen(os.environ['PUBLIC_URL'].rstrip('/')+'/'+name,timeout=30).read())==sha(data),name
assert json.load(urllib.request.urlopen(os.environ['PUBLIC_URL'].rstrip('/')+'/api/v1/health',timeout=30))['status']=='ok'
with tarfile.open(new/'web-overlay.tar.gz','w:gz') as archive:
 for name,data in sorted(web.items()):member=tarfile.TarInfo(name);member.size=len(data);archive.addfile(member,io.BytesIO(data))
api={}
with tarfile.open(r/'api-runtime.tar.gz') as archive:
 for member in archive:
  assert member.isfile() and not member.name.startswith('/') and '..' not in Path(member.name).parts
  api[member.name]=sha(archive.extractfile(member).read())
assert api=={**json.loads((r/'base-hashes.json').read_text())['api'],**pub['changes']['api']}
shutil.copy2(r/'api-runtime.tar.gz',new/'api-runtime.tar.gz');(new/'.gitattributes').write_bytes(b'* -text\n')
artifacts={name:{'size':(new/name).stat().st_size,'sha256':sha((new/name).read_bytes()),'files':files}for name,files in [('api-runtime.tar.gz',api),('web-overlay.tar.gz',{n:sha(b)for n,b in web.items()})]}
for name in ['published.json','browser-proof.json','panel-proof.json','postgres-proof.json']:(new/name).write_bytes((r/name).read_bytes())
for p in new.iterdir():
 if p.name not in artifacts:artifacts[p.name]={'size':p.stat().st_size,'sha256':sha(p.read_bytes())}
manifest={'sourceParityVerified':False,'containers':{'infra-api-1':{'image':pub['images']['api']},'infra-web-1':{'image':pub['images']['web']}},'release':{'pr':pub['pr'],'apiFiles':5,'webFiles':2,'soldUnchanged':True},'artifacts':artifacts}
(new/'manifest.json').write_bytes(json.dumps(manifest,indent=2).encode('utf-8'));print('PASS: published API/web baseline',len(api),len(web))
