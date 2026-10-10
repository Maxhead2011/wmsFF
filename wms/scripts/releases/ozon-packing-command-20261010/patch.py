# FIX: unoptimized Ozon progress has units but no count; derive it from physical units.
from pathlib import Path
import sys
p=Path(sys.argv[1])/'modules/tsd/fbo-two-stage.service.js';s=p.read_text(encoding='utf-8')
a="process.env.WMS_FBO_PARALLEL_PACKING_ENABLED === 'true' && progress.count > 0"
assert s.count(a)==1,'Runtime drift'
p.write_text(s.replace(a,"process.env.WMS_FBO_PARALLEL_PACKING_ENABLED === 'true' && (progress.optimized ? progress.count : units.length) > 0"),encoding='utf-8')
