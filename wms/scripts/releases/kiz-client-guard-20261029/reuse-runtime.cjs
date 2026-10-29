// TEST: execute the actual current-runtime scan/bind hooks with synthetic collaborators only.
const assert=require('node:assert/strict'),path=require('node:path');
const root=process.argv[2];if(!root)throw Error('Runtime directory required');
const {MarketplaceConnectionsService}=require(path.join(root,'modules/marketplace-connections/marketplace-connections.service.js'));
const {FboTwoStageService}=require(path.join(root,'modules/tsd/fbo-two-stage.service.js'));
const {pickUnboxed}=require(path.join(root,'modules/tsd/fbo-unboxed-picking.js'));
const helper=require(path.join(root,'common/kiz-client-review.js'));
const serial='010460000000000121AbCdEfGhIjKlM',kiz=serial+'\u001d91EE12\u001d92'+'A'.repeat(43)+'=';
let passed=0;process.env.WMS_KIZ_CLIENT_GUARD_ENABLED='true';
function fixture(previous=false){
 const task={id:'task',clientId:'client',requestId:'request',skuId:'sku',boxId:'box',boxCode:'FFL_BOX',barcode:'4600000000001',barcodes:['4600000000001'],requiresKiz:true,status:'IN_PROGRESS',marketplace:'OZON',orderId:'123',connectionId:'connection',workerUserId:'operator',workerName:'Operator',kiz:null};
 const mark={id:'mark',value:kiz,clientId:'client',skuId:'sku',boxId:'box',status:'AVAILABLE',updatedAt:new Date('2026-10-29'),box:{id:'box',clientId:'client',warehouseId:'wh',code:'FFL_BOX'},sku:{name:'Suit'}};
 const request={id:'request',clientId:'client',warehouseId:'wh',status:'IN_WORK',number:1};let row=null;const writes=[];
 const db={$queryRaw:async()=>[],$executeRaw:async()=>1,
  productMark:{findMany:async()=>[mark],findFirst:async()=>mark,update:async({data})=>{Object.assign(mark,data,{updatedAt:new Date()});writes.push('mark');return mark}},
  clientRequest:{findUnique:async()=>request},fboAssemblyUnit:{findMany:async()=>[]},
  fbsTsdAssembly:{findUnique:async()=>task,findMany:async()=>[]},
  shippedKizHistory:{findMany:async()=>previous?[{id:'ship',assemblyId:'oldtask',clientId:'client',requestId:'old',kiz,shippedAt:new Date('2026-10-01')}]:[]},
  kizReviewCase:{findUnique:async()=>row,findMany:async()=>[],upsert:async({create,update})=>row=row?{...row,...update}:{id:'review',...create},update:async({data})=>row={...row,...data}},
  box:{findUnique:async()=>mark.box},inventoryAuditBox:{count:async()=>0},stockBalance:{findFirst:async()=>({id:'balance',quantity:1,boxId:'box',status:'AVAILABLE'})},
  auditLog:{create:async()=>{writes.push('audit');return{}}},stockMovement:{findUnique:async()=>({clientId:'client',sourceDocument:'request',skuId:'sku',boxId:'box',status:'PACKING'})},
  clientMarketplaceConnection:{findFirst:async()=>({apiKey:'synthetic'})}};
 db.$transaction=fn=>fn(db);
 const service=Object.create(MarketplaceConnectionsService.prototype);
 Object.assign(service,{prisma:db,loadOwnedFbsTsdAssembly:async()=>task,requireFbsOrderStillCollectable:async()=>{},assertFbsTsdLeaseVersion:async()=>task,
  requireFbsRelabelSourceBox:()=>{},findPreviousWildberriesKizUsage:async()=>null,isFbsEmergencyAssemblyRequest:async()=>false,
  updateFbsTsdUnderLease:async(_t,_u,data)=>Object.assign(task,data),recordAcceptedFbsKizScan:async()=>{},formatFbsTsdAssembly:async t=>t,
  submitOzonFbsTask:async()=>{writes.push('ozon-submit');return task},loadWildberriesFbsKizPreflight:async()=>({alreadyAttached:false,supplierStatus:'confirm',remoteKizValues:[]}),
  reserveAcceptedWildberriesStock:async()=>{Object.assign(mark,{status:'PACKING',stockMovementId:'movement',updatedAt:new Date()})}});
 return{db,task,mark,request,service,writes,row:()=>row};
}
(async()=>{
 const user={id:'operator',name:'Operator'};
 const blocked=fixture(true);let external=0;
 global.fetch=async()=>{external++;return new Response(null,{status:204})};
 await assert.rejects(blocked.service.scanFbsTsdKiz('task',{kiz},user),/ОТЛОЖИТЕ/);
 assert.equal(external,0);assert.equal(blocked.row().status,'OPEN');assert(!blocked.writes.includes('mark'));passed++;
 const normal=fixture();await normal.service.scanFbsTsdKiz('task',{kiz},user);
 assert.equal(normal.task.wbMetaStatus,'ACCEPTED');assert.equal(normal.row().resolution,'FIRST_USE');
 await normal.service.completeFbsTsdAssembly('task',user);assert(normal.writes.includes('ozon-submit'));passed++;
 const wb=fixture();wb.task.marketplace='WILDBERRIES';await wb.service.scanFbsTsdKiz('task',{kiz},user);
 assert.equal(external,1);assert.equal(wb.mark.status,'PACKING');
 await helper.assertFbsClientKiz(wb.db,wb.task,kiz,user);passed++;
 const fbo=Object.create(FboTwoStageService.prototype),bad=fixture(true);fbo.balances={balanceKey:()=> 'balance'};
 await assert.rejects(fbo.bindPickedMark(bad.db,bad.request,'sku','box',kiz,'operation',user),/ОТЛОЖИТЕ/);
 assert(!bad.writes.includes('mark'));passed++;
 const good=fixture();const bound=await fbo.bindPickedMark(good.db,good.request,'sku','box',kiz,'operation',user);
 assert.equal(bound.id,'mark');assert.equal(good.row().resolution,'FIRST_USE');passed++;
 const unboxed=fixture(true);process.env.WMS_FBO_UNBOXED_PICK_ENABLED='true';
 unboxed.request.client={storesWithoutBoxes:true};unboxed.mark.boxId=null;
 unboxed.db.sku={findMany:async()=>[]};unboxed.db.clientRequest.findMany=async()=>[];
 unboxed.db.wbOrderShipment={findMany:async()=>[]};unboxed.db.stockMovement.findMany=async()=>[];
 unboxed.db.stockBalance.findMany=async()=>[{skuId:'sku',quantity:1}];
 await assert.rejects(pickUnboxed(unboxed.db,unboxed.request,[{skuId:'sku',remaining:1,barcode:'4600000000001',sku:{needsChestnyZnak:true,barcodes:[]}}],
  {action:'PICK_UNIT',barcode:'4600000000001',kiz},'operation',user,async()=>{throw Error('unexpected stock mutation')},async()=>unboxed.mark),/ОТЛОЖИТЕ/);passed++;
 const manual=fixture(true);manual.request.items=[];
 manual.db.fboAssembly={findUniqueOrThrow:async()=>({pickClosure:null})};manual.db.sku={findUnique:async()=>({id:'sku',clientId:'client',barcodes:[{value:'4600000000001'}]})};
 manual.db.fboAssemblyBox={findUnique:async()=>({requestId:'request',closedAt:null,wholeBox:false})};manual.db.fboAssemblyUnit.findUnique=async()=>null;
 fbo.box=async()=>({id:'target'});fbo.requireIdleBox=async()=>{};
 await assert.rejects(fbo.manualPack(manual.db,manual.request,{kiz,barcode:'4600000000001'},user,'operation'),/ОТЛОЖИТЕ/);
 assert(!manual.writes.includes('mark'));passed++;
 process.env.WMS_KIZ_CLIENT_GUARD_ENABLED='false';const sold=fixture(true);
 await sold.service.scanFbsTsdKiz('task',{kiz},user);assert.equal(sold.row(),null);assert.equal(sold.task.wbMetaStatus,'ACCEPTED');passed++;
 console.log(JSON.stringify({passed,actualRuntime:true,syntheticOnly:true}));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
