# FIX: patch two verified runtime modules, preserving parallel packing and later server fixes.
from pathlib import Path
import sys
root=Path(sys.argv[1])
def once(s,a,b):
 assert s.count(a)==1, 'Runtime anchor drift: '+a
 return s.replace(a,b,1)
p=root/'modules/tsd/tsd-assembly.service.js';s=p.read_text()
s=once(s,'async listActiveRequests(user, workflow)', 'async listActiveRequests(user, workflow, marketplace)')
s=once(s,'        const fboFilter =', "        if (marketplace && (!workflow || !['WB', 'OZON'].includes(marketplace))) throw new common_1.BadRequestException('Unknown FBO marketplace');\n        const fboFilter =")
s=once(s,'            fbsOrderLinks: { none: {} },', "            fbsOrderLinks: { none: {} },\n            ...(marketplace ? { ozonShipment: marketplace === 'OZON' ? { isNot: null } : { is: null } } : {}),")
p.write_text(s)
p=root/'modules/tsd/tsd-device.controller.js';s=p.read_text()
s=once(s,'listAssemblyRequests(user, workflow)', 'listAssemblyRequests(user, workflow, marketplace)')
s=once(s,'this.assembly.listActiveRequests(user, workflow)', 'this.assembly.listActiveRequests(user, workflow, marketplace)')
a="    __param(1, (0, common_1.Query)('workflow')),\n    __metadata(\"design:type\", Function),\n    __metadata(\"design:paramtypes\", [Object, String]),"
b="    __param(1, (0, common_1.Query)('workflow')),\n    __param(2, (0, common_1.Query)('marketplace')),\n    __metadata(\"design:type\", Function),\n    __metadata(\"design:paramtypes\", [Object, String, String]),"
s=once(s,a,b);p.write_text(s)
