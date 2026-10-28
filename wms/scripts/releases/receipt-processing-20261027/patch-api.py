from pathlib import Path
import json,difflib
r=Path('D:/WMSFF/_Kof/work/receipt-processing-20261027')
failed=[]
for item in json.loads((r/'compiled-delta.json').read_text(encoding='utf-8')):
 name=item['name'];dest=r/'api'/name;dest.parent.mkdir(parents=True,exist_ok=True)
 if item['old'] is None:dest.write_text(item['newer'],encoding='utf-8');continue
 live=(r/'api-base'/name).read_text(encoding='utf-8');old=item['old'].splitlines(True);new=item['newer'].splitlines(True)
 for a,b,c,d,e in reversed(difflib.SequenceMatcher(a=old,b=new,autojunk=False).get_opcodes()):
  if a=='equal':continue
  before=''.join(old[max(0,b-1):min(len(old),c+1)]);after=''.join(old[max(0,b-1):b])+''.join(new[d:e])+''.join(old[c:min(len(old),c+1)])
  if live.count(before)!=1:failed.append({'name':name,'op':a,'old':before,'new':after});continue
  live=live.replace(before,after,1)
 dest.write_text(live,encoding='utf-8')
(r/'patch-failures.json').write_text(json.dumps(failed,ensure_ascii=False),encoding='utf-8')
print('unmatched hunks:',len(failed))
for f in failed:print(f['name'],f['op'],f['old'][:100].encode('ascii','backslashreplace').decode())
