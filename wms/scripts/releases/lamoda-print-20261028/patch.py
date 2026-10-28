# FIX: preserve runtime-only print features and fail closed on changed/ambiguous anchors.
from pathlib import Path
import json,sys,difflib
root=Path(sys.argv[1]);changes={}
def replace_once(s,old,new):
 assert s.count(old)==1,old[:120]
 return s.replace(old,new,1)
for name,v in json.loads((root/'compiled.json').read_text(encoding='utf-8')).items():
 p=root/'api'/name
 if v['old'] is None:
  assert not p.exists();changes[p]=v['next'];continue
 s=p.read_text(encoding='utf-8')
 if name=='modules/skus/skus.service.js':
  line='const lamoda_print_barcodes_1 = require("../print/lamoda-print-barcodes");\n'
  anchor='const volume_service_1 = require("../stock/volume.service");'
  s=replace_once(s,anchor,anchor+'\n'+line.rstrip())
  assert v['next'].count(line)==1
  v['next']=v['next'].replace(line,'')
 a=v['old'].splitlines(True);b=v['next'].splitlines(True)
 for g in difflib.SequenceMatcher(None,a,b,autojunk=False).get_grouped_opcodes(1):
  s=replace_once(s,''.join(a[g[0][1]:g[-1][2]]),''.join(b[g[0][3]:g[-1][4]]))
 changes[p]=s
p=root/'api/modules/print/print-agent.service.js';s=p.read_text(encoding='utf-8')
s=replace_once(s,'if (!sku || !sku.barcodes.some(item => item.value === barcode))',
 'if (!sku || (!sku.barcodes.some(item => item.value === barcode) && !await require("./lamoda-print-barcodes").isLamodaPrintBarcode(this.prisma, sku.id, sku.clientId, barcode)))')
changes[p]=s
for p,s in changes.items():p.write_bytes(s.encode('utf-8'))
print('Prepared 4 API modules; unchanged printer queues and original barcode checks retained')
