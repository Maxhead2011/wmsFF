from pathlib import Path
import json,difflib
r=Path(__file__).parent
for n in json.loads((r/'api-changes.json').read_text(encoding='utf8')):
 new=(r/'compiled-new'/n).read_text(encoding='utf8');p=r/'candidate-api'/n;p.parent.mkdir(parents=True,exist_ok=True)
 if not (r/'compiled-old'/n).exists():p.write_text(new,encoding='utf8');continue
 old=(r/'compiled-old'/n).read_text(encoding='utf8');live=(r/'api-base'/n).read_text(encoding='utf8');changes=[]
 if n=='modules/administration/administration-internal-api.service.js':
  a="prefixes: ['/warehouse/receipt-channels'], routeCount: 4,";assert live.count(a)==1
  p.write_text(live.replace(a,a.replace('4,','7,')),encoding='utf8');print(n,'route count');continue
 for g in difflib.SequenceMatcher(None,old.splitlines(True),new.splitlines(True),autojunk=False).get_grouped_opcodes(5 if n.endswith(("stock-operations.service.js","receipt-channel-policy.js")) else 1):
  a,b=g[0][1],g[-1][2];c,d=g[0][3],g[-1][4]
  before=''.join(old.splitlines(True)[a:b]);after=''.join(new.splitlines(True)[c:d])
  if live.count(before)!=1 and n=='modules/stock/pick-instruction.service.js' and 'exports.relabelBarcodeNote' in before:
   before='const common_1 = require("@nestjs/common");\n'
   after='const receipt_channel_policy_1 = require("../warehouse/receipt-channel-policy");\n'+before
  if live.count(before)==0:
   bl,al=before.splitlines(True),after.splitlines(True)
   while len(bl)>1 and len(al)>1 and bl[0]==al[0] and live.count(''.join(bl))==0:bl.pop(0);al.pop(0)
   while len(bl)>1 and len(al)>1 and bl[-1]==al[-1] and live.count(''.join(bl))==0:bl.pop();al.pop()
   before,after=''.join(bl),''.join(al)
  if live.count(before)!=1:
   (r/(Path(n).stem+'-unmatched.txt')).write_text(before,encoding='utf8');raise Exception('Runtime anchor mismatch '+n+' '+str(live.count(before)))
  changes.append((before,after))
 for before,after in reversed(changes):live=live.replace(before,after,1)
 p.write_text(live,encoding='utf8');print(n,len(changes),'verified blocks')


