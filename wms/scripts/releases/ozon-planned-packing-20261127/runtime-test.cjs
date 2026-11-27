// TEST: actual six plans, complete in-memory packing, then the real action handler in a rolled-back transaction.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=process.argv[2]||'/app/apps/api/dist';
const {PrismaClient}=require('/app/apps/api/node_modules/@prisma/client');const p=new PrismaClient();
const policy=require(root+'/modules/client-requests/ozon-supply-policy');
const planTools=require(root+'/modules/client-requests/ozon-packing-plan');
const {FboTwoStageService}=require(root+'/modules/tsd/fbo-two-stage.service');
const {StockBalancesService}=require(root+'/modules/stock/stock-balances.service');
process.env.WMS_OZON_FBO_IMPORT_ENABLED='true';process.env.WMS_OZON_PLANNED_PACKING_ENABLED='true';process.env.WMS_OZON_PACK_BY_PRODUCT_ENABLED='true';process.env.WMS_FBO_TWO_STAGE_ENABLED='true';
const client='c401202c-be57-4310-9939-2ea36767da37',numbers=[3349,3350,3352,3392,3393,3395];
(async()=>{try{
 const rows=await p.ozonFboShipment.findMany({where:{request:{clientId:client,number:{in:numbers}}},include:{request:{include:{items:{include:{sku:{include:{barcodes:true}}}},fboAssembly:{include:{units:true,boxes:true}}}}}});assert.equal(rows.length,6);
 const results=[];
 for(const row of rows){const plan=row.integration.packingPlan;assert.equal(plan.state,'ACTIVE');planTools.validatePackingPlan(plan.boxes,row.directions,row.integration);policy.assertSupplyMutable(row.integration,'PICK_UNIT');policy.assertSupplyMutable(row.integration,'PACK_PRODUCT');
  const units=plan.boxes.flatMap(b=>b.items.flatMap(i=>Array.from({length:i.quantity},()=>({id:crypto.randomUUID(),skuId:i.skuId,state:'PICKED',wholeBox:false}))));
  for(const b of plan.boxes)assert.throws(()=>planTools.assertPlannedBoxComplete(plan,units,b.boxCode));
  for(const u of units){const suggestion=planTools.plannedSuggestions(plan,units,[]).find(v=>v.skuId===u.skuId);assert(suggestion);assert.throws(()=>planTools.assertPlannedUnit(plan,units,'FFL_WRONG',u.id));
   planTools.assertPlannedUnit(plan,units,suggestion.targetBoxCode,u.id);u.state='PACKED';u.targetBoxCode=suggestion.targetBoxCode;assert.throws(()=>planTools.assertPlannedUnit(plan,units,suggestion.targetBoxCode,u.id));}
  for(const b of plan.boxes)planTools.assertPlannedBoxComplete(plan,units,b.boxCode);
  results.push({number:row.request.number,cargoes:plan.boxes.length,plannedUnits:units.length,picked:row.request.fboAssembly?.units.filter(u=>u.state!=='RETURNED').length||0,packed:row.request.fboAssembly?.units.filter(u=>u.state==='PACKED').length||0,simulation:'PASS'});
 }
 const row=rows.find(r=>r.request.number===3350),id=row.requestId,actor=await p.user.findFirst({select:{id:true,name:true}}),user={...actor,permissionCodes:['system:admin'],roleCodes:['ADMIN']};
 const scopes={requireClientAccess:(_u,c)=>assert.equal(c,client)},balances=Object.create(StockBalancesService.prototype),lock={assertStockMovementsAllowed:async()=>{}};
 const svc=new FboTwoStageService(p,scopes,balances,{},lock,{});
 const unit=row.request.fboAssembly.units.find(u=>u.state==='PICKED'&&!u.wholeBox);assert(unit,'Need a picked unit for rollback regression');
 const item=row.request.items.find(i=>i.skuId===unit.skuId);assert(item);
 const resolved=await svc.resolvePlannedPacking(id,{barcode:item.barcode,kiz:unit.kiz||undefined},user);assert.equal(resolved.skuId,unit.skuId);assert(resolved.packingUnitId);
 const token='planned-test-'+crypto.randomUUID(),body={action:'PACK_PRODUCT',operationId:token,barcode:item.barcode,kiz:unit.kiz||undefined,direction:resolved.direction,targetBoxCode:resolved.targetBoxCode,packingUnitId:resolved.packingUnitId};
 let exercised=false;
 try{await p.$transaction(async tx=>{
  const proxy=new Proxy(tx,{get:(o,k)=>k==='$transaction'?async fn=>fn(tx):o[k]});const handler=new FboTwoStageService(proxy,scopes,balances,{},lock,{});handler.recoveryTransaction=true;
  await assert.rejects(()=>handler.executeAction(id,{...body,targetBoxCode:'FFL_WRONG'},user),/план/);
  await handler.executeAction(id,body,user);
  const after=await tx.fboAssemblyUnit.findUniqueOrThrow({where:{id:body.packingUnitId}});assert.equal(after.state,'PACKED');assert.equal(after.targetBoxCode,body.targetBoxCode);
  const count=await tx.stockMovement.count({where:{idempotencyKey:{startsWith:id+':'+token}}});assert(count>0);
  await handler.executeAction(id,body,user);assert.equal(await tx.stockMovement.count({where:{idempotencyKey:{startsWith:id+':'+token}}}),count);
  await assert.rejects(()=>handler.executeAction(id,{...body,operationId:token+'-repeat'},user),/уже вложена|не отобрана/);
  await assert.rejects(()=>handler.executeAction(id,{action:'CLOSE_BOX',operationId:token+'-close',targetBoxCode:body.targetBoxCode},user),/план/);
  exercised=true;throw new Error('ROLLBACK_PLANNED_TEST');
 },{timeout:45000});}catch(e){if(e.message!=='ROLLBACK_PLANNED_TEST')throw e;}
 assert(exercised);assert.equal((await p.fboAssemblyUnit.findUniqueOrThrow({where:{id:body.packingUnitId}})).state,'PICKED');assert.equal(await p.fboAssemblyAction.count({where:{id:{startsWith:id+':'+token}}}),0);assert.equal(await p.stockMovement.count({where:{idempotencyKey:{startsWith:id+':'+token}}}),0);
 process.env.WMS_OZON_PLANNED_PACKING_ENABLED='false';assert.throws(()=>policy.assertSupplyMutable(row.integration,'PACK_PRODUCT'));policy.assertSupplyMutable(row.integration,'PICK_UNIT');
 console.log(JSON.stringify({passed:true,requests:results,realActionRollback:true,replayNoDuplicate:true,wrongBoxRejected:true,incompleteBoxRejected:true,stockAndBillingUnchanged:true}));
}finally{await p.$disconnect()}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
