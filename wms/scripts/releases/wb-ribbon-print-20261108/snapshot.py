"""TEST: pin only verified published bytes and sanitized release evidence."""
import hashlib, json, tarfile, shutil, sys, urllib.request, os
from pathlib import Path
r=Path(sys.argv[1]);base=Path(__file__).resolve().parents[3]/'baselines/our-wms/2026-11-08-wb-ribbon-print'
sha=lambda b:hashlib.sha256(b).hexdigest()
pub=json.loads((r/'published.json').read_text());live=json.loads((r/'runtime-hashes.json').read_text())
api={p.relative_to(r/'api-candidate').as_posix():sha(p.read_bytes()) for p in (r/'api-candidate').rglob('*') if p.is_file()}
assert api==live['api'], 'Full published API differs from tested candidate'
web={p.relative_to(r/'web-payload').as_posix():sha(p.read_bytes()) for p in (r/'web-payload').rglob('*') if p.is_file()}
public={}
for n,h in web.items():
 assert live['web'][n]==h
 data=urllib.request.urlopen(os.environ['WMS_PUBLIC_URL'].rstrip('/')+'/'+n,timeout=30).read();public[n]=sha(data);assert public[n]==h
health=json.load(urllib.request.urlopen(os.environ['WMS_PUBLIC_URL'].rstrip('/')+'/api/v1/health',timeout=30));assert health['status']=='ok'
base.mkdir(parents=True,exist_ok=False)
artifacts={}
for name,folder,hashes in [('api-runtime.tar.gz',r/'api-candidate',api),('web-overlay.tar.gz',r/'web-payload',web)]:
 with tarfile.open(base/name,'w:gz') as t:
  for n in sorted(hashes):t.add(folder/n,arcname=n,recursive=False)
 data=(base/name).read_bytes();artifacts[name]={'size':len(data),'sha256':sha(data),'files':hashes}
for name in ['published.json','isolated-proof.json','runtime-api-proof.json','runtime-browser-proof.json','public-browser-proof.json','overlay-proof.json']:
 data=(r/name).read_bytes();(base/name).write_bytes(data);artifacts[name]={'size':len(data),'sha256':sha(data)}
data=json.dumps({'health':True,'hashes':public}).encode();(base/'public-hashes.json').write_bytes(data);artifacts['public-hashes.json']={'size':len(data),'sha256':sha(data)}
manifest={'sourceParityVerified':False,'containers':{'infra-'+k+'-1':{'image':v} for k,v in pub['images'].items()},'release':{'pr':pub['pr'],'apiModules':4,'webFiles':3,'soldUnchanged':True,'tsdVersionCode':258,'sourceParityVerified':False},'artifacts':artifacts}
(base/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
print(json.dumps({'apiFiles':len(api),'publicFiles':len(web),'health':True,'images':pub['images']}))
