"""Record a web-only release; unchanged API archive retains its verified hash."""
from pathlib import Path
import json,hashlib,shutil,tarfile,os,urllib.request,sys
r=Path(sys.argv[1]);baselines=Path(__file__).resolve().parents[3]/'baselines/our-wms'
old=baselines/'2026-11-07-fby-export';out=baselines/'2026-11-08-compact-controls'
v=json.loads((r/'published.json').read_text());prior=json.loads((old/'manifest.json').read_text())
assert v['api']==prior['containers']['infra-api-1']['image']
sha=lambda b:hashlib.sha256(b).hexdigest()
assert sha((old/'api-runtime.tar.gz').read_bytes())==prior['artifacts']['api-runtime.tar.gz']['sha256']
public={}
for p in (r/'web-payload').rglob('*'):
 if p.is_file():
  name=p.relative_to(r/'web-payload').as_posix();data=urllib.request.urlopen(os.environ['WMS_PUBLIC_URL'].rstrip('/')+'/'+name,timeout=30).read()
  assert sha(data)==sha(p.read_bytes())==v['hashes']['/usr/share/nginx/html/'+name];public[name]=sha(data)
assert json.load(urllib.request.urlopen(os.environ['WMS_PUBLIC_URL'].rstrip('/')+'/api/v1/health'))['status']=='ok'
assert json.loads((r/'public-browser.json').read_text())['passed']==12
out.mkdir(parents=True,exist_ok=False);shutil.copyfile(old/'api-runtime.tar.gz',out/'api-runtime.tar.gz')
artifacts={'api-runtime.tar.gz':prior['artifacts']['api-runtime.tar.gz']}
with tarfile.open(out/'web-overlay.tar.gz','w:gz') as tar:
 for n in public:tar.add(r/'web-payload'/n,arcname=n)
artifacts['web-overlay.tar.gz']={'size':(out/'web-overlay.tar.gz').stat().st_size,'sha256':sha((out/'web-overlay.tar.gz').read_bytes()),'files':public}
for n in ['published.json','candidate-browser.json','public-browser.json']:
 data=(r/n).read_bytes();(out/n).write_bytes(data);artifacts[n]={'size':len(data),'sha256':sha(data)}
manifest={'sourceParityVerified':False,'containers':{'infra-api-1':{'image':v['api']},'infra-web-1':{'image':v['image']}},'release':{'pr':v['pr'],'webFiles':2,'apiUnchanged':True,'soldUnchanged':True,'tsdVersionCode':258},'artifacts':artifacts}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8');print('Verified public web2 and API health; baseline recorded')
