"""TEST: record the verified web-only release and retain the unchanged published API archive."""
from pathlib import Path
import hashlib,json,tarfile,shutil,os,urllib.request,sys,io
r=Path(sys.argv[1]);bases=Path(__file__).resolve().parents[3]/'baselines/our-wms';old=bases/'2026-11-09-warehouse-fabric';new=bases/'2026-11-09-inline-product-reserve'
sha=lambda b:hashlib.sha256(b).hexdigest()
pub=json.loads((r/'published.json').read_text());previous=json.loads((old/'manifest.json').read_text());assert pub['apiUnchanged'] and pub['otherContainersUnchanged'];new.mkdir(exist_ok=False)
files={}
with tarfile.open(old/'web-overlay.tar.gz') as t:
 for m in t:
  assert m.isfile() and not m.name.startswith('/') and '..' not in Path(m.name).parts
  files[m.name]=t.extractfile(m).read()
for p in (r/'web-payload').rglob('*'):
 if p.is_file():files[p.relative_to(r/'web-payload').as_posix()]=p.read_bytes()
for name,data in files.items():
 got=urllib.request.urlopen(os.environ['PUBLIC_URL'].rstrip('/')+'/'+name,timeout=30).read();assert sha(got)==sha(data),name
assert json.load(urllib.request.urlopen(os.environ['PUBLIC_URL'].rstrip('/')+'/api/v1/health',timeout=30))['status']=='ok'
with tarfile.open(new/'web-overlay.tar.gz','w:gz') as t:
 for name,data in sorted(files.items()):m=tarfile.TarInfo(name);m.size=len(data);t.addfile(m,io.BytesIO(data))
shutil.copy2(old/'api-runtime.tar.gz',new/'api-runtime.tar.gz');assert sha((new/'api-runtime.tar.gz').read_bytes())==previous['artifacts']['api-runtime.tar.gz']['sha256']
artifacts={'api-runtime.tar.gz':previous['artifacts']['api-runtime.tar.gz'],'web-overlay.tar.gz':{'size':(new/'web-overlay.tar.gz').stat().st_size,'sha256':sha((new/'web-overlay.tar.gz').read_bytes()),'files':{n:sha(b) for n,b in files.items()}}}
for name in ['published.json','overlay-proof.json','runtime-browser-proof.json','public-browser-proof.json']:
 data=(r/name).read_bytes();(new/name).write_bytes(data);artifacts[name]={'size':len(data),'sha256':sha(data)}
manifest={'sourceParityVerified':False,'containers':{'infra-api-1':previous['containers']['infra-api-1'],'infra-web-1':{'image':pub['image']}},'release':{'pr':pub['pr'],'webFiles':4,'apiFiles':0,'soldUnchanged':True,'sourceParityVerified':False},'artifacts':artifacts}
(new/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8');print('Published web hashes verified:',len(files))
