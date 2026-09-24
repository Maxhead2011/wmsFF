import {afterEach, expect, it, vi} from 'vitest';
import {MarketplaceConnectionsService} from '../src/modules/marketplace-connections/marketplace-connections.service';
import {retainDovoz1049Route} from '../src/modules/marketplace-connections/fbs-dovoz1049-route';

it.each([
  {clientId:'sold-client'}, {connectionId:'another-account'}, {marketplace:'OZON'},
  {sourceSkuId:'unapproved-size'}, {orderId:'5749624405'}, {requestId:'763ab283-da9b-4a2f-912d-773ab3f22cad'},
  {status:'COMPLETED'}, {completedAt:new Date()}, {kiz:'already-scanned'}, {relabelConfirmedAt:new Date()},
])('does not preserve an unapproved or finished replacement: %j', patch => {
  // TEST: request 1113, sold WMS and excluded orders cannot inherit the size override.
  const f=fixture();expect(retainDovoz1049Route({...f.task,...patch})).toBe(false);
});

afterEach(() => vi.unstubAllEnvs());
function fixture(requestId = '22ca973f-e181-4bd9-9e32-0e463f3c5681') {
  vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', 'true');
  const task:any = {id:'task', clientId:'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9',
    connectionId:'3f022635-2efb-4b56-85ab-dfd48d9c24a8',orderId:'5723435480',marketplace:'WILDBERRIES',
    requestId, requestItemId:'item', skuId:'target', sourceSkuId:'2be8eae1-bf1f-4111-b4c7-ba66c7870fc4',
    relabelRequired:true,relabelConfirmedAt:null,status:'RESERVED',reservedBoxId:'box',reservedBoxCode:'SOURCE_BOX',
    reservedAt:new Date(),updatedAt:new Date(),kiz:null,barcode:null,sourceBarcode:null,boxId:null,completedAt:null,itemCount:1};
  const db:any = {
    client:{findUnique:vi.fn(async()=>({storesWithoutBoxes:false}))},
    clientRequestItem:{findMany:vi.fn(async()=>[{id:'item',requestId,skuId:'target'}])},
    stockBalance:{findMany:vi.fn(async()=>[])},
    fbsTsdAssembly:{findMany:vi.fn(async()=>[task]),updateMany:vi.fn(async()=>({count:1})),update:vi.fn(async({data}:any)=>({...task,...data}))},
    storagePalletBox:{findMany:vi.fn(async()=>[{boxId:'box',pallet:{code:'PALLET',warehouseId:'warehouse'}}])},
  };
  const service:any = new MarketplaceConnectionsService(db,{} as never);
  service.fbsTsdReservationRowsBySku=vi.fn(async()=>new Map());
  const order:any={id:task.orderId,connectionId:task.connectionId,marketplace:'WILDBERRIES',category:'active',supplierStatus:'confirm',
    product:{id:'target',name:'Target',needsChestnyZnak:true},request:{id:requestId,warehouseId:'warehouse'},
    relabeling:null,itemCount:1,requiredMeta:['sgtin'],optionalMeta:[],barcodes:['new']};
  return {task,db,service,order};
}

it('keeps the approved source and route of request 1099 across two background refreshes',async()=>{
  // TEST: marketplace enrichment has forgotten the agreed adjacent size; it must not erase its route.
  const f=fixture();
  for(let i=0;i<2;i++){
    const route=await f.service.syncFbsPalletSortReservations(f.task.clientId,[f.order]);
    expect(route.get(f.task.connectionId+':'+f.task.orderId)).toMatchObject({boxCode:'SOURCE_BOX',palletCode:'PALLET'});
  }
  expect(f.db.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
  expect(f.db.fbsTsdAssembly.update).not.toHaveBeenCalled();
});

it('continues ordinary stock calculation for any other request',async()=>{
  // TEST: this exception must not change the sold WMS or another assembly.
  const f=fixture('another-request');
  await f.service.syncFbsPalletSortReservations(f.task.clientId,[f.order]);
  expect(f.db.fbsTsdAssembly.updateMany.mock.calls.length+f.db.fbsTsdAssembly.update.mock.calls.length).toBeGreaterThan(0);
});

it('still releases request 1099 reservations after cancellation',async()=>{
  // TEST: the route exception cannot keep a cancelled order reserved.
  const f=fixture();f.order.category='cancelled';f.order.supplierStatus='cancel';
  await f.service.syncFbsPalletSortReservations(f.task.clientId,[f.order]);
  const writes=[...f.db.fbsTsdAssembly.updateMany.mock.calls,...f.db.fbsTsdAssembly.update.mock.calls];
  expect(writes.some(([arg]:any)=>arg.data.status==='RELEASED'&&arg.data.reservedBoxId===null)).toBe(true);
});

// TEST: the TSD queue must resolve the approved source even when the ordered size has no stock.
it('uses live approved adjacent-size stock in the TSD queue', async () => {
  const f=fixture();f.task.stockWarehouseId='warehouse';
  f.task.sourceProductName='Approved size';f.task.sourceArticle='Source';f.task.sourceBarcodes=['old'];
  f.db.stockBalance.findMany.mockResolvedValue([{boxId:'box',quantity:2,box:{code:'SOURCE_BOX'}}]);
  f.service.fbsTsdReservationRows=vi.fn(async()=>[{boxId:'box',itemCount:1}]);
  const source=await f.service.resolveDovoz1049TsdStockSource(f.task);
  expect(source).toMatchObject({sourceSkuId:f.task.sourceSkuId,relabelRequired:true,withoutBoxQuantity:0,
    storageBoxes:[{code:'SOURCE_BOX',quantity:1,status:'AVAILABLE'}]});
  expect(f.db.stockBalance.findMany.mock.calls[0][0].where).toMatchObject({skuId:f.task.sourceSkuId,warehouseId:'warehouse',status:'AVAILABLE'});
  expect(f.service.fbsTsdReservationRows).toHaveBeenCalledWith(expect.objectContaining({excludeTaskId:f.task.id,skuId:f.task.sourceSkuId}));
});
it('does not send TSD to a source fully reserved by other tasks', async () => {
  // TEST: stored route data cannot override current stock or another reservation.
  const f=fixture();f.task.stockWarehouseId='warehouse';
  f.db.stockBalance.findMany.mockResolvedValue([{boxId:'box',quantity:1,box:{code:'SOURCE_BOX'}}]);
  f.service.fbsTsdReservationRows=vi.fn(async()=>[{boxId:'box',itemCount:1}]);
  expect((await f.service.resolveDovoz1049TsdStockSource(f.task)).storageBoxes).toEqual([]);
});
it('rejects the one-off source for another request or a released task', async()=>{
  // TEST: no effect on the sold WMS or cancelled reservations.
  const f=fixture('other');expect(await f.service.resolveDovoz1049TsdStockSource(f.task)).toBeNull();
  f.task.requestId='22ca973f-e181-4bd9-9e32-0e463f3c5681';f.task.status='RELEASED';
  expect(await f.service.resolveDovoz1049TsdStockSource(f.task)).toBeNull();
  expect(f.db.stockBalance.findMany).not.toHaveBeenCalled();
});
it('issues a TSD task for request 1099 when only the approved replacement is available', async()=>{
  // TEST: reproduces the actual empty queue, rather than merely checking route formatting.
  const f=fixture();f.task.stockWarehouseId='warehouse';f.task.sourceBarcodes=['old'];
  f.db.fbsTsdAssembly.findFirst=vi.fn(async()=>null);
  f.db.fbsTsdAssembly.findUnique=vi.fn(async()=>f.task);
  f.db.fbsTsdAssembly.updateMany=vi.fn(async({data}:any)=>{Object.assign(f.task,data);return {count:1};});
  f.db.clientRequest={findUnique:vi.fn(async()=>({id:f.task.requestId,number:1099,clientId:f.task.clientId,status:'IN_WORK'}))};
  f.db.systemSetting={findUnique:vi.fn(async()=>null)};
  f.db.clientMarketplaceConnection={findMany:vi.fn(async()=>[{clientId:f.task.clientId}])};
  f.db.clientRequestItem.findFirst=vi.fn(async()=>({id:'item'}));
  f.db.stockBalance.findMany.mockResolvedValue([{boxId:'box',quantity:1,box:{code:'SOURCE_BOX'}}]);
  f.service.clientScopes={requireClientAccess:vi.fn()};
  f.service.loadFbsTsdRequestOrders=vi.fn(async()=>({orders:[{...f.order,storageBoxes:[]}]}));
  f.service.mergeSyncedFbsTsdRequestOrders=vi.fn(async(_:any,r:any)=>r);
  f.service.resolveFbsTsdStockSource=vi.fn(async()=>null);
  f.service.fbsTsdReservationRows=vi.fn(async()=>[]);
  f.service.formatFbsTsdAssembly=vi.fn(async(t:any)=>({state:'SCAN_BOX',task:t}));
  f.service.emptyFbsTsdAssembly=vi.fn(async()=>({state:'EMPTY'}));
  const result=await f.service.getNextFbsTsdAssembly('TSD-TEST',{id:'worker',name:'Worker'},f.task.requestId);
  expect(result.state).toBe('SCAN_BOX');
  expect(result.task).toMatchObject({sourceSkuId:'2be8eae1-bf1f-4111-b4c7-ba66c7870fc4',reservedBoxCode:'SOURCE_BOX',status:'IN_PROGRESS'});
  expect(f.service.resolveFbsTsdStockSource).not.toHaveBeenCalled();
});

