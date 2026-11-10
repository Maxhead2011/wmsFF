// TEST: execute the exact published-image candidate, without external requests or real printing.
require('reflect-metadata');
const assert=require('node:assert/strict'), path=require('node:path');
const root='/app/apps/api/dist';
process.env.WMS_FBS_REQUEST_AUTO_STATUS_ENABLED='true';
process.env.WMS_FBS_ACTION_STATUS_ENABLED='true';
process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED='false';
process.env.WMS_OZON_FBS_PICK_LINES_ENABLED='false';
const {reconcileFbsRequestStatus}=require(root+'/common/stock/fbs-request-auto-status');
const {marketStatusSlot}=require(root+'/modules/client-requests/market-status-schedule');
function fixture(marketplace='WILDBERRIES',ribbon=false){
 const request={id:'r',clientId:'c',number:1,title:'Test',type:'OUTBOUND',status:'SUBMITTED',items:[{id:'i',skuId:'s',quantity:1}],fbsOrderLinks:[{marketplace,connectionId:'a',orderId:'o',syncStatus:'ACTIVE'}]};
 const task={id:'t',requestItemId:'i',skuId:'s',marketplace,connectionId:'a',orderId:'o',status:'COMPLETED',startedAt:new Date(),completedAt:new Date(),workerUserId:'picker',deviceCode:'TSD:1',itemCount:1};
 const events=[];let prints=[];
 const tx={$queryRaw:async()=>[],clientRequest:{findUnique:async()=>request,update:async({data})=>Object.assign(request,data)},clientRequestEvent:{findFirst:async()=>null,create:async({data})=>events.push(data)},fbsTsdAssembly:{findMany:async()=>[task]},fbsPrintJob:{findMany:async()=>prints},wbOrderShipment:{findMany:async()=>[{assemblyId:'t',quantity:1}]},systemSetting:{findUnique:async()=>({value:{startOnRibbon:ribbon}})}};
 return {request,task,tx,events,print:()=>{prints=[{assemblyId:'t'}]}};
}
const apply=(f,stage)=>reconcileFbsRequestStatus(f.tx,'r',{stage,occurredAt:new Date(),actorId:'picker'});
(async()=>{
 let count=0;
 for(const mp of ['WILDBERRIES','OZON']){
  const f=fixture(mp);await apply(f,'PICK');assert.equal(f.request.status,'IN_WORK');count++;
  f.print();await apply(f,'SOS_PRINT');assert.equal(f.request.status,'PACKED');assert.equal(f.events.at(-1).createdByUserId,'picker');count++;
  await apply(f,'SOS_PRINT');assert.equal(f.events.length,2);count++;
 }
 const fabric=fixture('WILDBERRIES',true);await apply(fabric,'START');assert.equal(fabric.request.status,'SUBMITTED');count++;
 await apply(fabric,'RIBBON');assert.equal(fabric.request.status,'IN_WORK');count++;
 fabric.request.status='DONE';await apply(fabric,'RIBBON');assert.equal(fabric.request.status,'DONE');count++;
 process.env.WMS_FBS_ACTION_STATUS_ENABLED='false';const sold=fixture();await apply(sold,'PICK');assert.equal(sold.request.status,'PACKED');count++;
 process.env.WMS_FBS_ACTION_STATUS_ENABLED='true';
 assert.equal(marketStatusSlot(new Date('2026-11-10T04:59:00Z')),null);
 assert.equal(marketStatusSlot(new Date('2026-11-10T05:00:00Z')),'2026-11-10T08:00+03:00');count++;
 const labels=require(root+'/modules/marketplace-connections/wb-all-labels');let paired;
 labels.wbAllLabels=async(orders,deps,flag)=>{paired=flag;return {warnings:[],fileBase64:Buffer.from('synthetic').toString('base64')}};
 process.env.WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED='true';
 const {MarketplaceConnectionsService}=require(root+'/modules/marketplace-connections/marketplace-connections.service');let remembered;
 const db={systemSetting:{findUnique:async()=>({value:{startOnRibbon:true}}),upsert:async v=>{remembered=v}}};
 const service=new MarketplaceConnectionsService(db,{requireClientAccess(){}});
 service.resolveFbsLabelOrders=async()=>({orders:[{id:'o',connectionId:'a',marketplace:'OZON'}]});
 await service.getFbsAllLabels({clientId:'c',orders:[]},{id:'picker'});
 assert.equal(paired,true);assert.equal(remembered.create.value.orders[0].marketplace,'OZON');count++;
 labels.wbAllLabels=async()=>({warnings:['ШК товара / заказа: unavailable'],fileBase64:''});remembered=null;
 await service.getFbsAllLabels({clientId:'c',orders:[]},{id:'picker'});assert.equal(remembered,null);count++;
 console.log('PASS runtime scenarios',count);
})().catch(e=>{console.error(e);process.exitCode=1});
