from pathlib import Path
import json,tarfile,sys
r=Path(sys.argv[1]);base=Path(sys.argv[2])
with tarfile.open(base/'api-runtime.tar.gz','r:gz') as t:
 old={m.name:t.extractfile(m).read().decode('utf8') for m in t.getmembers() if m.isfile()}
for name,v in json.loads((r/'compiled.json').read_text(encoding='utf8')).items():
 if name.endswith('administration-internal-api.service.js'):
  s=old[name];a="prefixes: ['/lamoda'], routeCount: 20";assert s.count(a)==1;new=s.replace(a,"prefixes: ['/lamoda'], routeCount: 21")
 else:
  # Git CRLF checkout versus captured LF is the only permitted baseline normalization.
  if name in old:assert old[name].replace('\r\n','\n').strip()==v['old'].replace('\r\n','\n').strip(),name
  new=v['next']
 for root in [r/'candidate',r/'api/payload']:
  p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(new,encoding='utf8')
