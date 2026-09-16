import {afterEach, expect, it, vi} from 'vitest';
import {MarketplaceConnectionsService} from '../src/modules/marketplace-connections/marketplace-connections.service';

afterEach(() => vi.unstubAllEnvs());
function fixture(requestId = '16086a76-475c-463c-9dfd-430addda504b') {
  vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', 'true');
  const task:any = {id:'task', clientId:'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9',
    connectionId:'3f022635-2efb-4b56-85ab-dfd48d9c24a8',orderId:'5752506052',marketplace:'WILDBERRIES',
    requestId, requestItemId:'item', skuId:'target', sourceSkuId:'ac7d161f-a671-4efa-955b-d1a68d287bc4',
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

it('keeps the approved source and route of request 1049 across two background refreshes',async()=>{
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

it('still releases request 1049 reservations after cancellation',async()=>{
  // TEST: the route exception cannot keep a cancelled order reserved.
  const f=fixture();f.order.category='cancelled';f.order.supplierStatus='cancel';
  await f.service.syncFbsPalletSortReservations(f.task.clientId,[f.order]);
  const writes=[...f.db.fbsTsdAssembly.updateMany.mock.calls,...f.db.fbsTsdAssembly.update.mock.calls];
  expect(writes.some(([arg]:any)=>arg.data.status==='RELEASED'&&arg.data.reservedBoxId===null)).toBe(true);
});
