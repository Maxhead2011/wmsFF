import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { WarehouseController } from '../src/modules/warehouse/warehouse.controller';
import { WarehouseShipmentHistoryService } from '../src/modules/warehouse/warehouse-shipment-history.service';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
const user:any={id:'u',roleCodes:['CLIENT'],permissionCodes:['stock:read'],clientScopeMode:'LIMITED',clientIds:['own'],writableClientIds:['own']};
afterEach(()=>vi.unstubAllEnvs());
// TEST: client reads only own shipments without a warehouse mutation grant.
it('allows scoped client history only on the enabled installation',async()=>{
 const findMany=vi.fn(async()=>[]),svc=new WarehouseShipmentHistoryService({shippedKizHistory:{findMany}} as any,new ClientScopeService()),c=new WarehouseController({} as any,{} as any,svc);
 vi.stubEnv('WMS_CLIENT_WAREHOUSE_ENABLED','true');await c.shipmentHistoryList(user,'own');expect(findMany.mock.calls[0][0].where.clientId).toBe('own');
 expect(()=>c.shipmentHistoryList({...user,roleCodes:['WORKER']},'own')).toThrow('Нет доступа');
 await expect(c.shipmentHistoryList(user,'other')).rejects.toThrow('Нет доступа');
 vi.stubEnv('WMS_CLIENT_WAREHOUSE_ENABLED','false');expect(()=>c.shipmentHistoryList(user,'own')).toThrow('Нет доступа');
});
// TEST: read-only route overrides the class guard; writes still require staff capabilities.
it('keeps warehouse and billing mutations protected',()=>{
 expect(Reflect.getMetadata('requiredPermissions',WarehouseController.prototype.shipmentHistoryList)).toEqual([]);
 for(const name of ['createGoodsArrival','deleteGoodsArrival','syncShipmentHistory'])expect(Reflect.getMetadata('requiredPermissions',(WarehouseController.prototype as any)[name])).toEqual(['warehouse:write']);
 expect(Reflect.getMetadata('requiredPermissions',WarehouseController.prototype.billGoodsArrivals)).toEqual(['billing:write']);
});
