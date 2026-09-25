const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('path');
const {TsdAssemblyService:S}=require(path.join(process.env.FBS_ROUTE_RUNTIME,'modules/tsd/tsd-assembly.service.js'));
// TEST: execute the actual runtime, preserving its deployed relabel implementation.
for(const [enabled,source,quantity,expected] of [[true,null,2,1],[false,null,2,0],[true,null,0,0],[true,'source',2,1]]) {
 test(JSON.stringify({enabled,source,quantity}),async()=>{
  process.env.WMS_FBS_ONLINE_RELABEL_LOCATIONS_ENABLED=String(enabled);
  const db={fbsOrderRequestLink:{findMany:async()=>[{orderId:'5864079913',connectionId:'wb',lastSkuId:'sku',lastItemCount:1}]},
   fbsTsdAssembly:{findMany:async()=>[{id:'task',orderId:'5864079913',connectionId:'wb',requestItemId:'item',skuId:'sku',sourceSkuId:source,
    reservedBoxCode:'FFL_LKB0909_356',status:'RESERVED',itemCount:1,deviceCode:'AUTO',updatedAt:new Date()}]},
   auditLog:{findMany:async()=>[]},sku:{findMany:async()=>[{id:'sku'}]},storagePalletBox:{findMany:async()=>[]},
   stockBalance:{findMany:async()=>quantity?[{skuId:source||'sku',quantity,box:{code:'FFL_LKB0909_356'}}]:[]}};
  const s=new S(db,{},{},{},{});
  const result=await s.loadFbsAssemblyFacts('request-1368',[{itemId:'item',skuId:'sku',requestedQuantity:1,allocations:[]}]);
  const hints=result.notCollected.rows[0].availableBoxes;
  assert.equal(hints.length,expected);if(expected)assert.equal(hints[0].quantity,1);
 });
}
