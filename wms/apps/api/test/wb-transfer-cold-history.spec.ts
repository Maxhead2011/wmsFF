import { afterEach, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
function setup(flag='true') {
 vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED',flag);
 const link={connectionId:'cabinet',orderId:'101',orderPlacedAt:new Date('2026-09-14T10:00:00Z'),
  requestId:'request',syncStatus:'ACTIVE',request:{warehouseId:'warehouse',status:'SUBMITTED'}};
 const db:any={clientMarketplaceConnection:{findMany:vi.fn(async()=>[{id:'cabinet',apiKey:'test-key'}])},
  fbsOrderRequestLink:{findMany:vi.fn(async()=>[link])},
  fbsTsdAssembly:{findMany:vi.fn(async()=>[{id:'task',connectionId:'cabinet',orderId:'101',requestId:'request',status:'WAITING_STOCK',itemCount:1}])},
  client:{findUniqueOrThrow:vi.fn(async()=>({storesWithoutBoxes:false}))},stockBalance:{findMany:vi.fn(async()=>[])}};
 const service:any=new MarketplaceConnectionsService(db, {requireClientAccess:vi.fn()} as never);
 service.clientScopes={requireClientAccess:vi.fn()};
 service.fbsTsdReservationRowsBySku=vi.fn(async()=>new Map());
 service.refreshFbsOrdersCache=vi.fn(async()=>({orders:(service.wildberriesFbsHistoryCache.get('cabinet')?.orders??[]).map(o=>({
  ...o,id:String(o.id),connectionId:'cabinet',marketplace:'WILDBERRIES',supplierStatus:'confirm',wbStatus:'waiting',product:{id:'sku'},itemCount:1}))}));
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({orders:[{id:101,supplyId:'WB-CURRENT',createdAt:'2026-09-14T10:00:00Z'}],next:0}),{status:200}));vi.stubGlobal('fetch',fetcher);
 const run=()=>service.prepareFbsStockTransfer({clientId:'client',sourceRequestId:'request',orders:[{connectionId:'cabinet',id:'101'}]},
  {activeWarehouseId:'warehouse',writableWarehouseIds:['warehouse']});
 return {service,db,run,fetcher};
}
// TEST: after server restart, a confirmed request order is missing from orders/new and history RAM.
it('recovers the selected WB order before transfer validation, without billing',async()=>{
 const {run,service,fetcher,db}=setup();const result=await run();
 expect(result.orders[0]).toMatchObject({id:'101',supplyId:'WB-CURRENT',noStock:true});
 expect(fetcher).toHaveBeenCalledTimes(1);
 const url=new URL(String(fetcher.mock.calls[0][0]));expect(url.searchParams.has('dateFrom')).toBe(true);
 expect(db.clientMarketplaceConnection.findMany.mock.calls[0][0].where).toMatchObject({clientId:'client',isActive:true});
 expect(service.refreshFbsOrdersCache.mock.calls.every(c=>c[1].billingMode==='skip')).toBe(true);
 expect(service.wildberriesFbsHistoryCache.get('cabinet').expiresAt).toBe(0);
});
it('does not hide a genuinely missing order or use a foreign cabinet',async()=>{
 const {db,run,fetcher}=setup();db.clientMarketplaceConnection.findMany.mockResolvedValue([]);
 await expect(run()).rejects.toThrow('Заказы не найдены');expect(fetcher).not.toHaveBeenCalled();
});
it('does not invent orders from request records when WB omits them',async()=>{
 const {run,fetcher}=setup();fetcher.mockResolvedValue(new Response(JSON.stringify({orders:[],next:0}),{status:200}));
 await expect(run()).rejects.toThrow('Заказы не найдены');
});
it('retains unrelated cached history and its original expiration',async()=>{
 const {run,service}=setup();const expiresAt=Date.now()+100000;
 service.wildberriesFbsHistoryCache.set('cabinet',{orders:[{id:999}],expiresAt});
 await run();expect(service.wildberriesFbsHistoryCache.get('cabinet')).toMatchObject({expiresAt,orders:[{id:999},{id:101}]});
});
it('keeps sold WMS flag-off behavior',async()=>{
 const {run,fetcher}=setup('false');await expect(run()).rejects.toThrow('Заказы не найдены');expect(fetcher).not.toHaveBeenCalled();
});
it('reads subsequent history pages but caches only the selected order',async()=>{
 const {run,fetcher,service}=setup();
 fetcher.mockResolvedValueOnce(new Response(JSON.stringify({orders:Array.from({length:1000},(_,i)=>({id:1000+i})),next:123}),{status:200}));
 await run();expect(fetcher).toHaveBeenCalledTimes(2);
 expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get('next')).toBe('123');
 expect(service.wildberriesFbsHistoryCache.get('cabinet').orders).toHaveLength(1);
});
