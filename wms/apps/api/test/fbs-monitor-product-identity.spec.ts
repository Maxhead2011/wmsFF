import { afterEach, expect, it, vi } from 'vitest';
import { FbsStockMonitoringService as SourceMonitor } from '../src/modules/marketplace-connections/fbs-stock-monitoring.service';
import * as sourceIdentity from '../src/modules/marketplace-connections/fbs-monitor-product-identity';
import {createRequire} from 'node:module';
const runtime=(name:string)=>createRequire(import.meta.url)(process.env.KUBRIN_RUNTIME+'/modules/marketplace-connections/'+name+'.js');
const FbsStockMonitoringService=process.env.KUBRIN_RUNTIME?runtime('fbs-stock-monitoring.service').FbsStockMonitoringService:SourceMonitor;
const {monitorIdentityKey,monitorProductIdentities}=process.env.KUBRIN_RUNTIME?runtime('fbs-monitor-product-identity'):sourceIdentity;
afterEach(() => vi.unstubAllEnvs());
// TEST: an Ozon-owned legacy SKU field must not hide the linked WB size.
it('ingests WB identity from the exact client/account link', async () => {
  vi.stubEnv('WMS_MARKETPLACE_PRODUCT_LINKS_ENABLED', 'true');
  vi.stubEnv('WMS_MARKETPLACE_PRODUCT_LINK_CLIENTS', 'client');
  const create=vi.fn().mockResolvedValue({});
  const db:any={
    clientMarketplaceConnection:{findMany:async()=>[{id:'c',clientId:'client',fbsWarehouseId:'wb'}]},
    sku:{findMany:async()=>[{id:'sku',marketplaceProductId:'123456',barcodes:[]}]},
    marketplaceProductLink:{findMany:async()=>[{clientId:'client',connectionId:'c',skuId:'sku',productId:'555:666',status:'LINKED',marketplace:'WILDBERRIES'}]},
    fbsStockMonitorConfig:{findMany:async()=>[]},
    fbsStockMonitorEvent:{findMany:async()=>[],create},
    fbsStockPublication:{findMany:async()=>[]},fbsStockMonitorRun:{create:async()=>({})},
  };
  const monitor:any=new FbsStockMonitoringService(db,{} as any,{get:()=>undefined} as any,{} as any);
  monitor.loadLatestGroupSnapshots=async()=>new Map();
  await monitor.ingestOrders([{clientId:'client',connectionId:'c',orderId:'1',skuId:'sku',category:'active',quantity:1,createdAt:new Date().toISOString()}]);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({nmId:'555',chrtId:process.env.KUBRIN_RUNTIME?666n:666})}));
});
const row={clientId:'client',connectionId:'c',skuId:'sku',marketplaceProductId:'old:99'};
// TEST: another account or an ambiguous/review mapping must not trigger a wrong-size read.
it.each([[],[{...row,connectionId:'other',productId:'11:22'}],[{...row,productId:'11:22'},{...row,productId:'33:44'}],[{...row,productId:'malformed'}]].map(links=>({links})))('fails closed for unusable links %j',async ({links})=>{
  vi.stubEnv('WMS_MARKETPLACE_PRODUCT_LINKS_ENABLED','true');vi.stubEnv('WMS_MARKETPLACE_PRODUCT_LINK_CLIENTS','client');
  expect((await monitorProductIdentities({marketplaceProductLink:{findMany:async()=>links}} as any,[row])).get(monitorIdentityKey(row))).toBeNull();
});
it('retains legacy identity without querying links on other installations',async()=>{
  vi.stubEnv('WMS_MARKETPLACE_PRODUCT_LINKS_ENABLED','false');
  expect((await monitorProductIdentities({} as any,[row])).get(monitorIdentityKey(row))).toEqual({nmId:'old',chrtId:99});
});
// TEST: the persisted null identity is repaired before probing, not only for new events.
it('rechecks existing events with the linked identity and saves it',async()=>{
  vi.stubEnv('WMS_MARKETPLACE_PRODUCT_LINKS_ENABLED','true');vi.stubEnv('WMS_MARKETPLACE_PRODUCT_LINK_CLIENTS','client');
  const event={...row,id:'event',orderId:'1',eventType:'SALE',quantity:1,nmId:null,chrtId:null,deadlineAt:new Date(0),wbStatus:'UNAVAILABLE',wmsStatus:'ERROR',wbAttempts:10,wmsAttempts:10,marketplaceWarehouseId:'wb'};
  const update=vi.fn().mockResolvedValue({}),probe=vi.fn().mockResolvedValue([{eventId:'event',wbCurrentAmount:1,wbOrderMatched:true,wmsCurrentAmount:2,wmsSellableAmount:1,wmsReservedAmount:1,wmsReservationMatched:true,wmsReservationRequired:true}]);
  const db:any={marketplaceProductLink:{findMany:async()=>[{...row,productId:'555:666'}]},
    fbsStockMonitorEvent:{findMany:async()=>[event],updateMany:async()=>({count:1}),update},
    fbsStockMonitorRun:{create:async()=>({id:'run'}),update:async()=>({})},fbsStockMonitorConfig:{findMany:async()=>[]},
    fbsStockMonitorHistory:{create:async()=>({})},$transaction:async(rows:any[])=>Promise.all(rows)};
  const monitor:any=new FbsStockMonitoringService(db,{} as any,{get:()=>undefined} as any,{} as any);monitor.registerProbe(probe);
  await monitor.runChecks({force:true,where:{clientId:'client'}});
  expect(probe).toHaveBeenCalledWith([expect.objectContaining({chrtId:666})]);
  expect(update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({nmId:'555',chrtId:666,wmsStatus:'SUCCESS'})}));
});
