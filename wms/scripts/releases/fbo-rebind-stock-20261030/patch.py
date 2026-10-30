# FIX: exact runtime delta; do not replace the divergent full service from source.
from pathlib import Path
import sys
p=Path(sys.argv[1])/'modules/tsd/fbo-two-stage.service.js'
s=p.read_text()
needle="        let movementId = previous?.stockMovementId ?? null;"
assert s.count(needle)==1
s=s.replace(needle,"        const reusedCountedStock = await require('./fbo-rebind-stock').reuseCountedFboStock(tx,r,skuId,boxId,source,physicalBalance);\n        let movementId = reusedCountedStock ? null : (previous?.stockMovementId ?? null);")
a=s.index("            const target = await tx.box.findUniqueOrThrow({ where: { id: boxId } });",s.index('    async bindPickedMark('))
b=s.index("\n\n        }",a)
s=s[:a]+"            if (!reusedCountedStock) {\n"+s[a:b]+"\n            }"+s[b:]
s=s.replace("sourceBoxId: boxId, recovered: recover,","sourceBoxId: boxId, recovered: recover, reusedCountedStock,")
p.write_text(s)
