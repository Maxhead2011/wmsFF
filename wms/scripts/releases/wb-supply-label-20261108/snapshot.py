"""TEST: record verified API bytes and retain the unchanged web baseline."""
import hashlib,json,tarfile,shutil,sys,urllib.request,os
from pathlib import Path
r=Path(sys.argv[1]);roots=Path(__file__).resolve().parents[3]/'baselines/our-wms'
old=roots/'2026-11-08-sos-active-only';base=roots/'2026-11-08-wb-supply-label'
sha=lambda b:hashlib.sha256(b).hexdigest()
pub=json.loads((r/'published.json').read_text());previous=json.loads((old/'manifest.json').read_text())
api={p.relative_to(r/'api-candidate').as_posix():sha(p.read_bytes()) for p in (r/'api-candidate').rglob('*') if p.is_file()}
assert {'/app/apps/api/dist/'+n:h for n,h in api.items()}==pub['hashes']
assert pub['images']['web']==previous['containers']['infra-web-1']['image'] and pub['otherContainersUnchanged']
base.mkdir(parents=True,exist_ok=False);artifacts={}
with tarfile.open(base/'api-runtime.tar.gz','w:gz') as t:
 for n in sorted(api):t.add(r/'api-candidate'/n,arcname=n,recursive=False)
data=(base/'api-runtime.tar.gz').read_bytes();artifacts['api-runtime.tar.gz']={'size':len(data),'sha256':sha(data),'files':api}
name='web-overlay.tar.gz';shutil.copy2(old/name,base/name);artifacts[name]=previous['artifacts'][name]
assert sha((base/name).read_bytes())==artifacts[name]['sha256']
public={}
for n,h in artifacts[name]['files'].items():
 data=urllib.request.urlopen(os.environ['WMS_PUBLIC_URL'].rstrip('/')+'/'+n,timeout=30).read();assert sha(data)==h;public[n]=h
assert json.load(urllib.request.urlopen(os.environ['WMS_PUBLIC_URL'].rstrip('/')+'/api/v1/health',timeout=30))['status']=='ok'
(r/'public-hashes.json').write_text(json.dumps({'health':True,'webUnchanged':True,'hashes':public}))
for name in ['published.json','isolated-proof.json','runtime-api-proof.json','overlay-proof.json','public-hashes.json']:
 data=(r/name).read_bytes();(base/name).write_bytes(data);artifacts[name]={'size':len(data),'sha256':sha(data)}
manifest={'sourceParityVerified':False,'containers':{'infra-'+k+'-1':{'image':v} for k,v in pub['images'].items()},
 'release':{'pr':pub['pr'],'apiModules':2,'webFiles':0,'soldUnchanged':True,'tsdVersionCode':258,'sosVersionCode':9,'sourceParityVerified':False},'artifacts':artifacts}
(base/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8');print('Verified published API files:',len(api))
