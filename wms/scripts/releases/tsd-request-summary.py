"""FIX: bounded display-only patch over the verified production runtime."""
import argparse
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('--target',required=True)
a=p.parse_args()
f=Path(a.target)/'modules/tsd/tsd-assembly.service.js'
s=f.read_text(encoding='utf-8')
start=s.index('    async listActiveRequests(')
end=s.index('\n    async ',start+10)
chunk=s[start:end]
for old,new in [
 ('                title: true,','                number: true,\n                items: { select: { quantity: true } },\n                title: true,'),
 ('            requestId: request.id,','            requestId: request.id,\n            number: request.number,\n            totalQuantity: request.items?.reduce((sum, item) => sum + item.quantity, 0) ?? 0,')]:
 if chunk.count(old)!=1: raise RuntimeError('Runtime drift: '+old)
 chunk=chunk.replace(old,new,1)
f.write_bytes((s[:start]+chunk+s[end:]).encode('utf-8'))
print('Prepared one display-only runtime module')
