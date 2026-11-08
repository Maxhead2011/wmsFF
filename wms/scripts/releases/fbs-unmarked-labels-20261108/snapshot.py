"""TEST: capture verified runtime bytes; preserve the unchanged web baseline."""
import hashlib,json,tarfile,sys,urllib.request,os,shutil
from pathlib import Path
r=Path(sys.argv[1]);parent=Path(__file__).resolve().parents[3]/'baselines/our-wms'
base=parent/'2026-11-08-fbs-unmarked-labels';previous=parent/'2026-11-08-fbs-paired-labels'
sha=lambda b:hashlib.sha256(b).hexdigest()
pub=json.loads((r/'published.json').read_text());isolated=json.loads((r/'isolated-proof.json').read_text())
assert pub['health'] and pub['otherEnvironmentUnchanged'] and pub['otherContainersUnchanged']
assert pub['enabledFlag']=='WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED'
assert isolated['fullApiHealth'] and isolated['image']==pub['images']['api']
api={p.relative_to(r/'api-candidate').as_posix():sha(p.read_bytes()) for p in (r/'api-candidate').rglob('*') if p.is_file()}
assert {'/app/apps/api/dist/'+n:h for n,h in api.items()}==pub['allApiHashes']
old=json.loads((previous/'manifest.json').read_text())
assert old['containers']['infra-web-1']['image']==pub['images']['web']
health=json.load(urllib.request.urlopen(os.environ['WMS_PUBLIC_URL'].rstrip('/')+'/api/v1/health',timeout=30))
assert health['status']=='ok'
base.mkdir(parents=True,exist_ok=False)
with tarfile.open(base/'api-runtime.tar.gz','w:gz') as t:
 for n in sorted(api):t.add(r/'api-candidate'/n,arcname=n,recursive=False)
artifacts={}
def register(name,files=None):
 data=(base/name).read_bytes();artifacts[name]={'size':len(data),'sha256':sha(data)}
 if files is not None:artifacts[name]['files']=files
register('api-runtime.tar.gz',api)
for name in ['web-overlay.tar.gz']:
 data=(previous/name).read_bytes();assert sha(data)==old['artifacts'][name]['sha256']
 shutil.copy2(previous/name,base/name);artifacts[name]=old['artifacts'][name]
for name in ['published.json','isolated-proof.json','api-candidate-proof.json','overlay-proof.json']:
 shutil.copy2(r/name,base/name);register(name)
(base/'public-health.json').write_text(json.dumps({'health':True}));register('public-health.json')
manifest={'sourceParityVerified':False,'containers':{'infra-'+k+'-1':{'image':v} for k,v in pub['images'].items()},
 'release':{'pr':pub['pr'],'apiModules':1,'webFiles':0,'soldUnchanged':True,'tsdVersionCode':258,'sourceParityVerified':False},'artifacts':artifacts}
(base/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
print(json.dumps({'apiFiles':len(api),'health':True,'images':pub['images']}))
