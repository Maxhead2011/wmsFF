from pathlib import Path
import json,sys
r=Path(sys.argv[1]);compiled=json.loads((r/'compiled.json').read_text())
assert len(compiled)==1
for n,v in compiled.items():
 p=r/'candidate-current'/n;s=p.read_text();a=s.index('    async activeFboCounts(user) {');b=s.index('    async list(query, user) {',a)
 new=v['next'];x=new.index('    async activeFboCounts(user) {');y=new.index('    async list(query, user) {',x)
 s=s[:a]+new[x:y]+s[b:];p.write_bytes(s.encode());out=r/'api/payload'/n;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(s.encode())
