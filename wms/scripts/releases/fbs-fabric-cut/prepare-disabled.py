"""Build the disabled foundation overlay; never replace existing runtime services."""
from pathlib import Path
import sys, re, json, hashlib

root, compiled = map(Path, sys.argv[1:3])
changed = []
def edit(name, transform):
    p = root / ('modules/' + name + '.js')
    before = p.read_text(encoding='utf8')
    after = transform(before)
    assert after != before, name
    with p.open('w', encoding='utf8', newline='\n') as stream:
        stream.write(after)
    changed.append(p.relative_to(root).as_posix())
def once(s, old, new):
    assert s.count(old) == 1, old[:100]
    return s.replace(old, new, 1)

service = (compiled/'modules/marketplace-connections/marketplace-connections.service.js').read_text(encoding='utf8')
method = service[service.index('    async confirmFbsTsdFabricCut('):service.index('    // FIX: printing inside FBS assembly')]
imports = '\n'.join(line for line in service.splitlines() if 'const fabric_fbs_' in line) + '\n'
edit('marketplace-connections/marketplace-connections.service', lambda s: once(once(s, '"use strict";', '"use strict";\n'+imports), '    async getFbsTsdRelabelPrintContext(', method+'    async getFbsTsdRelabelPrintContext('))

controller = (compiled/'modules/tsd/tsd-device.controller.js').read_text(encoding='utf8')
method = controller[controller.index('    confirmFbsFabricCut('):controller.index('    releaseFbsAssembly(')]
start = controller.index("    (0, common_1.Post)('fbs/tasks/:id/confirm-fabric-cut')")
start = controller.rfind('__decorate([', 0, start)
end = controller.index('], TsdDeviceController.prototype, "confirmFbsFabricCut", null);', start) + len('], TsdDeviceController.prototype, "confirmFbsFabricCut", null);')
metadata = controller[start:end]+'\n'
edit('tsd/tsd-device.controller', lambda s: once(once(s, '    releaseFbsAssembly(', method+'    releaseFbsAssembly('), "__decorate([\n    (0, common_1.Post)('fbs/tasks/:id/release')", metadata+"__decorate([\n    (0, common_1.Post)('fbs/tasks/:id/release')"))
old = "    return (0, fbs_physical_pick_1.withFbsTsdCapability)(request.user, request.headers['x-tsd-fbs-capability']);"
new = "    const user = (0, fbs_physical_pick_1.withFbsTsdCapability)(request.user, request.headers['x-tsd-fbs-capability']);\n    return user && request.headers['x-tsd-fabric-capability'] === 'fabric-cut-v1' ? { ...user, tsdFabricCutConfirmation: true } : user;"
edit('tsd/tsd-fbs-user.decorator', lambda s: once(s, old, new))
edit('administration/administration-internal-api.service', lambda s: once(once(s, 'routeCount: 107, // FIX: physical source-scan resolution endpoint.', 'routeCount: 108, // FIX: disabled fabric confirmation endpoint.'), "description: 'Приёмка, размещение, сборка FBS/ФБО, перемещения и синхронизация ТСД.'", "description: 'Приёмка, размещение, сборка FBS/ФБО, перемещения и синхронизация ТСД. Подтверждение нарезки требует WMS_FBS_FABRIC_CUT_ENABLED.'"))
for p in sorted((compiled/'modules/warehouse').glob('fabric-fbs-*.js')):
    if '.spec.' in p.name: continue
    dest = root/'modules/warehouse'/p.name
    assert not dest.exists(), dest
    dest.write_bytes(p.read_bytes())
    changed.append(dest.relative_to(root).as_posix())
print(json.dumps(changed))
