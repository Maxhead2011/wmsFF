# FIX: no broad runtime replacement; fail if a reviewed compiler hunk is ambiguous.
from pathlib import Path
import json,sys,difflib
root=Path(sys.argv[1]);changes={}
for name,value in json.loads(Path(sys.argv[2]).read_text(encoding='utf-8')).items():
 path=root/name
 if value['old'] is None:
  assert not path.exists(),name
  changes[path]=value['next'];continue
 content=path.read_text(encoding='utf-8');old=value['old'].splitlines(True);new=value['next'].splitlines(True)
 for group in difflib.SequenceMatcher(None,old,new,autojunk=False).get_grouped_opcodes(3):
  before=''.join(old[group[0][1]:group[-1][2]]);after=''.join(new[group[0][3]:group[-1][4]])
  assert content.count(before)==1,(name,before[:100])
  content=content.replace(before,after,1)
 changes[path]=content
for path,content in changes.items():path.write_bytes(content.encode())
print('Prepared four Lamoda runtime modules; other modules preserved')
