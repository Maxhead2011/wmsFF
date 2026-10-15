const assert=require('node:assert/strict');
const root='/app/apps/api/dist/modules/marketplace-connections/';
const {MarketplaceConnectionsService:S}=require(root+'marketplace-connections.service');
const {evaluateFbsStockMonitorWms:evaluate}=require(root+'fbs-stock-monitoring.rules');
async function probe(mode,status='WAITING_STOCK',warehouse='branch',enabled=true){
 process.env.WMS_FBS_MONITOR_ROUTING_ENABLED=String(enabled);let wb=0,wms=0;
 const db={clientMarketplaceConnection:{findMany:async()=>[{id:'c',clientId:'client',apiKey:'test',fbsWarehouseId:'wb',fbsExecutionWarehouseId:'moscow',fbsAutoRouteNewWarehouses:false}]},fbsWarehouseRoutingRule:{findMany:async()=>[{connectionId:'c',marketplaceWarehouseId:'wb',mode,executionWarehouseId:'branch'}]},fbsTsdAssembly:{findMany:async()=>[{id:'a',connectionId:'c',orderId:'o',skuId:'s',itemCount:1,status,reservedAt:status==='RESERVED'?new Date():null,stockWarehouseId:warehouse}]}};
 const svc=new S(db,{});svc.fetchWildberriesStockAmounts=async()=>{wb++;return new Map([[10,2]])};svc.resolveFbsExecutionWarehouseId=async(c,w)=>w;svc.calculateFbsStockQuantities=async(c,ids,w)=>{wms++;assert.equal(w,enabled&&mode==='BRANCH'?'branch':'moscow');return new Map([['s',{available:4,reserved:1,sellable:3}]])};
 const [r]=await svc.probeFbsStockMonitoring([{eventId:'e',connectionId:'c',clientId:'client',orderId:'o',skuId:'s',quantity:1,chrtId:10,marketplaceWarehouseId:'wb',eventType:'SALE'}]);
 if(mode==='EXCLUDED'&&enabled){assert.equal(wb,0);assert.equal(wms,0);assert.ok(r.wmsError)}
 assert.equal(r.wmsReservationMatched,!enabled||(status==='RESERVED'&&warehouse==='branch'&&mode==='BRANCH'));
}
(async()=>{await probe('BRANCH');await probe('BRANCH','RESERVED');await probe('BRANCH','RESERVED','wrong');await probe('EXCLUDED');await probe('CENTRAL','WAITING_STOCK','moscow',false);assert.equal(evaluate({eventType:'SALE',quantity:1,beforeAmount:10,currentAmount:1,exactOrderMatched:true,exactReservationMatched:false,exactReservationRequired:true,nowMs:10,deadlineMs:1,attempt:2,maxAttempts:2}).status,'ERROR');console.log(JSON.stringify({passed:true,cases:6,businessWrites:0}));})().catch(e=>{console.error(e);process.exit(1)});
