from pathlib import Path
import sys
root=Path(sys.argv[1])/'modules'
def change(p,a,b):
 s=p.read_text();assert s.count(a)==1,(p,a);p.write_bytes(s.replace(a,b).encode())
p=root/'tsd/tsd-device.controller.js'
change(p,'    listClients(user) {','    listPlacementClients(user) { return this.devices.listClientsForDevice(user, true); }\n    listClients(user) {')
s=p.read_text();end=s.index('], TsdDeviceController.prototype, "listClients", null);')+len('], TsdDeviceController.prototype, "listClients", null);');start=s.rindex('__decorate([',0,end);m=s[start:end];change(p,m,m+'\n'+m.replace("('clients')","('placement/clients')").replace('"listClients"','"listPlacementClients"'))
p=root/'tsd/tsd-device.service.js'
change(p,'async listClientsForDevice(user) {','async listClientsForDevice(user, placement = false) {\n        if (placement && !user.activeWarehouseId) return [];')
change(p,'status: { not: client_1.ClientStatus.ARCHIVED },','status: placement ? client_1.ClientStatus.ACTIVE : { not: client_1.ClientStatus.ARCHIVED },\n                ...(placement ? { isDemo: !!user.isDemo, warehouseLinks: {some:{warehouseId:user.activeWarehouseId,status:"ACTIVE"}} } : {}),')
change(root/'administration/administration-internal-api.service.js','routeCount: 112, // FIX: disabled fabric','routeCount: 113, // FIX: placement clients and disabled fabric')
