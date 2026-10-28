# FIX: apply unique compiler deltas to materialized verified runtime only.
from pathlib import Path
import json,sys,difflib
r=Path(sys.argv[1])
for n,v in json.loads((r/'compiled.json').read_text(encoding='utf-8')).items():
 p=r/'candidate'/n;s=p.read_text(encoding='utf-8');old=v['old'].splitlines(True);new=v['next'].splitlines(True)
 for g in difflib.SequenceMatcher(None,old,new,autojunk=False).get_grouped_opcodes(3):
  before=''.join(old[g[0][1]:g[-1][2]]);after=''.join(new[g[0][3]:g[-1][4]])
  assert s.count(before)==1,(n,before[:100]);s=s.replace(before,after,1)
 p.write_bytes(s.encode());out=r/'api/payload'/n;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(p.read_bytes())
