import {afterEach,expect,it,vi} from 'vitest';
import {createRequire} from 'node:module';
import { fbsStockReserveDisplay as display } from '../src/modules/marketplace-connections/fbs-stock-reserve-display';
import {MarketplaceConnectionsService as SourceService} from '../src/modules/marketplace-connections/marketplace-connections.service';
const Service=process.env.RESERVE_DISPLAY_RUNTIME?createRequire(import.meta.url)(process.env.RESERVE_DISPLAY_RUNTIME).MarketplaceConnectionsService:SourceService;
afterEach(()=>vi.unstubAllEnvs());
// TEST: exercise the actual stock response, including the summary used by the browser.
it.each([false,true])('subtracts safety reserves and totals, managed=%s',async(managed)=>{
 vi.stubEnv('WMS_MARKETPLACE_PRODUCT_LINKS_ENABLED','false');vi.stubEnv('WMS_WB_STOCK_FINE_SETTINGS','true');
 const amounts=[10,26,89];const skus=amounts.map((n,i)=>({id:'s'+i,name:'Product',internalSku:'s'+i,marketplaceProductId:`1:${100+i}`,barcodes:[]}));
 const service=new Service({sku:{findMany:async()=>skus},fbsStockPublication:{findMany:async()=>managed?skus.map(s=>({skuId:s.id,enabled:true,saleLimit:null})):[]}} as any,{} as any);
 service.calculateFbsRelabelStockPlan=async()=>({quantities:new Map(amounts.map((n,i)=>['s'+i,{available:n+2,reserved:2,sellable:n}])),meta:new Map(),reserve:{mode:'UNITS',value:3},skuRules:new Map()});
 service.fetchWildberriesStockAmounts=async()=>new Map([[100,7],[101,23],[102,86]]);
 const result=await service.buildFbsStocksResponse({id:'client'},[],{id:'connection'},[],{id:'warehouse'},'warehouse','Warehouse','execution');
 expect(result.items.map((r:any)=>[r.reserved,r.safetyReserve,r.sellable])).toEqual([[2,3,7],[2,3,23],[2,3,86]]);
 expect(result.summary.sellable).toBe(116);expect(result.summary.excessUnits).toBe(0);
});

// TEST: match publication semantics without charging shared-pool reserves twice.
it('supports low-stock replacement, percentage rounding, clamping and SKU overrides',()=>{
 const reserve={mode:'UNITS' as const,value:3,lowStock:{threshold:5,reserveUnits:1}};
 expect(display(4,'s',{reserve})).toEqual({safetyReserve:1,sellable:3});
 expect(display(5,'s',{reserve})).toEqual({safetyReserve:3,sellable:2});
 expect(display(11,'s',{reserve:{mode:'PERCENT',value:10}})).toEqual({safetyReserve:2,sellable:9});
 expect(display(2,'s',{reserve:{mode:'UNITS',value:3}})).toEqual({safetyReserve:2,sellable:0});
 expect(display(7,'s',{reserve,skuRules:new Map([['s',{reserve:{mode:'NONE',value:0}}]])})).toEqual({safetyReserve:0,sellable:7});
 expect(display(7,'s',{reserve,skuRules:new Map([['s',{blocked:true}]])})).toEqual({safetyReserve:7,sellable:0});
 expect(display(7,'s',{})).toEqual({safetyReserve:0,sellable:7});
});
