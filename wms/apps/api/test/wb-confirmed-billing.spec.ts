import {afterEach,expect,it,vi} from 'vitest';
import {MarketplaceConnectionsService} from '../src/modules/marketplace-connections/marketplace-connections.service';
const old=process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED;afterEach(()=>{if(old===undefined)delete process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED;else process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED=old;});
// TEST: accepted WB orders can be billed without inventing a warehouse shipment.
it('retains accepted WB orders without fabric pick records',async()=>{
 process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED='true';
 const accepted={id:'accepted',marketplace:'WILDBERRIES',connectionId:'cab',supplierStatus:'complete',wbStatus:'sorted',category:'shipped',itemCount:1};
 const db:any={$queryRaw:vi.fn(async()=>[]),wbOrderShipment:{findMany:vi.fn(async()=>[])}};db.$transaction=vi.fn(async(fn:any)=>fn(db));
 const service:any=new MarketplaceConnectionsService(db,{} as never);service.ensureFbsProcessingChargesLocked=vi.fn(async()=>new Map());
 await service.ensureFbsProcessingCharges('client',[accepted]);
 expect(service.ensureFbsProcessingChargesLocked.mock.calls[0][1]).toEqual([accepted]);
});
// TEST: statuses are authoritative, and local physical evidence must not duplicate accepted remote orders.
it.each(['waiting','canceled','declined_by_client'])('rejects unconfirmed WB status %s',async(wbStatus)=>{
 process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED='true';
 const order:any={id:'o',connectionId:'cab',marketplace:'WILDBERRIES',category:'shipped',supplierStatus:'confirm',wbStatus};
 const db:any={$queryRaw:vi.fn(async()=>[]),wbOrderShipment:{findMany:vi.fn(async()=>[{assemblyId:'a',assemblySnapshot:{},orderSnapshot:order,quantity:1,shippedAt:new Date()}])}};db.$transaction=vi.fn(async(fn:any)=>fn(db));
 const service:any=new MarketplaceConnectionsService(db,{} as never);service.ensureFbsProcessingChargesLocked=vi.fn(async()=>new Map());
 await service.ensureFbsProcessingCharges('client',[order]);expect(service.ensureFbsProcessingChargesLocked.mock.calls[0][1]).toEqual([]);
});
it('uses local evidence once for an accepted remote order',async()=>{
 process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED='true';
 const order:any={id:'o',connectionId:'cab',marketplace:'WILDBERRIES',category:'shipped',supplierStatus:'complete',wbStatus:'sorted'};
 const db:any={$queryRaw:vi.fn(async()=>[]),wbOrderShipment:{findMany:vi.fn(async()=>[{assemblyId:'a',assemblySnapshot:{boxCode:'box'},orderSnapshot:order,quantity:1,shippedAt:new Date()}])}};db.$transaction=vi.fn(async(fn:any)=>fn(db));
 const service:any=new MarketplaceConnectionsService(db,{} as never);service.ensureFbsProcessingChargesLocked=vi.fn(async()=>new Map());
 await service.ensureFbsProcessingCharges('client',[order]);const rows=service.ensureFbsProcessingChargesLocked.mock.calls[0][1];expect(rows).toHaveLength(1);expect(rows[0].processingAssemblyId).toBe('a');
});
it('preserves sold policy when lifecycle flag is off',async()=>{
 process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED='false';
 const order:any={id:'o',connectionId:'cab',marketplace:'WILDBERRIES',category:'shipped',supplierStatus:'complete',wbStatus:'sorted'};
 const db:any={$queryRaw:vi.fn(async()=>[])};db.$transaction=vi.fn(async(fn:any)=>fn(db));const service:any=new MarketplaceConnectionsService(db,{} as never);service.ensureFbsProcessingChargesLocked=vi.fn(async()=>new Map());
 await service.ensureFbsProcessingCharges('client',[order]);expect(service.ensureFbsProcessingChargesLocked.mock.calls[0][1]).toEqual([order]);
});
// TEST: display overlays must never turn WB waiting into confirmed handover.
it('prefers fresh waiting status over a local shipped display overlay',async()=>{
 process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED='true';
 const displayed:any={id:'o',connectionId:'cab',marketplace:'WILDBERRIES',category:'shipped',supplierStatus:'complete',wbStatus:'sorted'};
 const db:any={$queryRaw:vi.fn(async()=>[]),wbOrderShipment:{findMany:vi.fn(async()=>[])}};db.$transaction=vi.fn(async(fn:any)=>fn(db));const service:any=new MarketplaceConnectionsService(db,{} as never);service.ensureFbsProcessingChargesLocked=vi.fn(async()=>new Map());
 await service.ensureFbsProcessingCharges('client',[displayed],[{...displayed,supplierStatus:'confirm',wbStatus:'waiting'}]);expect(service.ensureFbsProcessingChargesLocked.mock.calls[0][1]).toEqual([]);
});
