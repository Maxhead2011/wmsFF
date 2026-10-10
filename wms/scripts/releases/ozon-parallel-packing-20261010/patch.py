# FIX: retain all existing packing guards; remove only the Ozon capability exclusion.
from pathlib import Path
import sys
p=Path(sys.argv[1])/'modules/tsd/fbo-two-stage.service.js'
s=p.read_text(encoding="utf-8");a="parallelPackingSupported: !shipment&&process.env.WMS_FBO_PARALLEL_PACKING_ENABLED === 'true'"
assert s.count(a)==1,'Runtime drift'
p.write_text(s.replace(a,"parallelPackingSupported: process.env.WMS_FBO_PARALLEL_PACKING_ENABLED === 'true'"),encoding="utf-8")
