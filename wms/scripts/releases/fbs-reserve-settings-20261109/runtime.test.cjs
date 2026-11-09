// TEST: execute the actual published allocation handler with read-only repository stubs.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(process.argv[2],'utf8');
const method=source.slice(source.indexOf('async listExternalFbsStockAllocation('),source.indexOf('async updateFbsStockAllocation(')).trim();
let fine=true,shares=[];
const handler=vm.runInNewContext('({'+method+'})',{
 wb_stock_reserve_1:{fineStockSettingsEnabled:()=>fine},client_1:{MarketplaceType:{WILDBERRIES:'WILDBERRIES'}},
 common_1:{NotFoundException:Error},wb_stock_observations_1:{wbStockCheckDto:x=>x},
 wb_stock_demand_analysis_1:{analyzeWbStockDemand:(_o,_c,rows)=>({rows})},process:{env:{}}
}).listExternalFbsStockAllocation;
const rule={reserve:{mode:'UNITS',value:2},blocked:true,updatedAt:'2026-11-09T12:00:00.000Z'};
const context={
 requireFbsStockAllocationService:()=>({list:async()=>({shares,policy:{lowStockThreshold:1}})}),
 fbsStockAllocationDemand:async()=>({}),resolveFbsExecutionWarehouseId:async()=> 'warehouse',
 calculateFbsRelabelStockPlan:async()=>({quantities:new Map([['sku-one',{sellable:1}],['sku-two',{sellable:0}]]),meta:new Map(),skuRules:new Map([['sku-one',rule]])}),
 stockControl:{reserveSettings:async()=>({reserve:{mode:'UNITS',value:3}}),analysisSettings:async()=>({maxShareChange:10}),isEnabled:async()=>true},
 fbsOrdersCache:new Map(),loadFbsOrders:async()=>({orders:[]}),
 prisma:{clientMarketplaceConnection:{findFirst:async()=>({fbsWarehouseId:'wb',fbsExecutionWarehouseId:'warehouse'})},
 fbsStockAllocationPolicy:{findUnique:async()=>null},fbsStockPublication:{findMany:async()=>[]},
 sku:{findMany:async()=>[{id:'sku-one',name:'Product',barcodes:[]},{id:'sku-two',name:'Zero',barcodes:[]}]},
 wbStockAvailabilityDay:{findMany:async()=>[]},wbStockPublicationCheck:{findMany:async()=>[]}}
};
(async()=>{
 const result=await handler.call(context,'client','cabinet');
 assert.equal(result.analysis,null);
 assert.equal(result.reserveRows.length,2,'Editable rules must exist without warehouse-share analysis, including zero stock');
 assert.equal(result.reserveRows[0].ruleUpdatedAt,rule.updatedAt);assert.equal(result.reserveRows[0].blocked,true);
 assert.equal(result.reserveRows[0].reserveOverride.value,2);assert.equal(result.reserveRows[1].ruleUpdatedAt,null);
 assert.equal(result.reserveRows[1].reserveOverride,null);assert.equal(result.reserveRows[1].blocked,false);
 shares=[{warehouseId:'wb',percent:100,isPrimary:true}];
 const analyzed=await handler.call(context,'client','cabinet');assert.equal(analyzed.analysis.rows.length,2);assert.equal(analyzed.reserveRows.length,2);
 fine=false;const disabled=await handler.call(context,'client','cabinet');assert.equal(disabled.reserveRows,undefined);
 console.log('PASS runtime3: analysis-null/zero stock, existing analysis, disabled fine-settings gate');
})().catch(e=>{console.error(e);process.exitCode=1});
