from pathlib import Path
import tarfile,json
r=Path(__file__).parent
names=json.loads((r/'api-changes.json').read_text())
with tarfile.open(r/'base/api-runtime.tar.gz') as t:
 for n in names[:-1]:(r/'api'/n).write_bytes(t.extractfile(n).read())
def edit(n,changes):
 p=r/'api'/n;s=p.read_text(encoding='utf-8')
 for old,new in changes:
  assert s.count(old)==1,(n,old[:120],s.count(old))
  s=s.replace(old,new,1)
 p.write_text(s,encoding='utf-8')
helper='require("./fbo-unboxed-picking")'
edit(names[0],[("r._count.fbsOrderLinks || r.client.storesWithoutBoxes)","r._count.fbsOrderLinks || (r.client.storesWithoutBoxes && !"+helper+".unboxedFboEnabled()))")])
after=(r/'after'/names[1]).read_text(encoding='utf-8')
start=after.index('        // FIX: no source location');end=after.index('        const waitingBySku',start)
block=after[start:end].replace('(0, fbo_unboxed_picking_1.unboxedFree)',helper+'.unboxedFree')
edit(names[1],[
 ("r._count.fbsOrderLinks || r.client.storesWithoutBoxes)","r._count.fbsOrderLinks || (r.client.storesWithoutBoxes && !"+helper+".unboxedFboEnabled()))"),
 ('        const boxes = (indexedStock ?', '        const unboxed = r.client.storesWithoutBoxes && '+helper+'.unboxedFboEnabled();\n        const boxes = unboxed || (indexedStock ?'),
 ('const packingSnapshot = (indexedStock', 'const packingSnapshot = unboxed || (indexedStock'),
 ('        const waitingBySku = new Map();',block+'        const waitingBySku = new Map();'),
 ('packingByProductSupported:', 'unboxedPickingSupported: unboxed, packingByProductSupported:'),
 ("                if (dto.action === 'PICK_UNIT' || dto.action === 'PICK_BOX') {", "                if ("+helper+".unboxedFboEnabled() && r.client.storesWithoutBoxes && (dto.action === 'PICK_UNIT' || dto.action === 'PICK_BOX')) {\n                    requirePhase('PICKING');\n                    await "+helper+".pickUnboxed(tx,r,lines,dto,key,user,this.move.bind(this),this.exactMark.bind(this));\n                } else if (dto.action === 'PICK_UNIT' || dto.action === 'PICK_BOX') {"),
 ('skuId, boxId: from, status: sourceStatus, quantity: { gt: 0 }','skuId, boxId: from, ...(from===null?{palletId:null}:{}), status: sourceStatus, quantity: { gt: 0 }'),
])
edit(names[2],[("if (client.storesWithoutBoxes)","if (client.storesWithoutBoxes && !require('../tsd/fbo-unboxed-picking').unboxedFboEnabled())")])
print('Four-module delta prepared; existing runtime extensions retained')
