from pathlib import Path
import json,tarfile,sys
r=Path(sys.argv[1]);base=Path(sys.argv[2])
with tarfile.open(base/'api-runtime.tar.gz','r:gz') as t:
 old={m.name:t.extractfile(m).read().decode('utf8') for m in t.getmembers() if m.isfile()}
for name,v in json.loads((r/'compiled.json').read_text(encoding='utf8')).items():
 if name.endswith('administration-internal-api.service.js'):
  s=old[name];a="prefixes: ['/lamoda'], routeCount: 14";assert s.count(a)==1;new=s.replace(a,"prefixes: ['/lamoda'], routeCount: 20")
 else:
  if name in old:assert old[name].strip()==v['old'].strip(),name
  new=v['next']
 for root in [r/'candidate',r/'api/payload']:
  p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(new,encoding='utf8')
