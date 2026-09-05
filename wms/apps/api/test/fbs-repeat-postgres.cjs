// TEST: destructive integration checks ONLY against the isolated restored test database.
// Run from the release image, never on a live database or with a bootstrapped AppModule.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const database = new URL(process.env.DATABASE_URL || 'invalid:');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(database.hostname, 'wms-repeat38-postgres-20260905');
assert.equal(database.pathname, '/repeat38_test');
process.env.WMS_FBS_REPEAT_ASSEMBLY_ENABLED = 'true';
const { PrismaClient } = require('@prisma/client');
const { FbsRepeatAssemblyService } = require('../dist/modules/marketplace-connections/fbs-repeat-assembly.service');
const { MarketplaceConnectionsService } = require('../dist/modules/marketplace-connections/marketplace-connections.service');
const { ClientScopeService } = require('../dist/modules/auth/client-scope.service');
const { WarehouseAuthScopeService } = require('../dist/modules/auth/warehouse-auth-scope.service');
const { readFbsAttemptHistory } = require('../dist/common/shipment-history/fbs-attempt-history');
const p = new PrismaClient();
const json = value => JSON.parse(JSON.stringify(value));

async function main() {
  const selection = JSON.parse(fs.readFileSync(process.env.REPEAT_SELECTION_PATH, 'utf8'));
  const ids = selection.orderIds;
  assert.equal(ids.length, 38);
  assert.equal(new Set(ids).size, ids.length);
  const { clientId, connectionId, warehouseId, actorId } = selection;
  const actor = await p.user.findUniqueOrThrow({where:{id:actorId},include:{roles:{include:{role:{include:{permissions:{include:{permission:true}}}}}},clientScopes:{include:{client:{select:{isDemo:true,relabelingEnabled:true}}}},warehouseScopes:{include:{warehouse:{select:{isActive:true}}}}}});
  const roleCodes = actor.roles.map(row => row.role.code);
  const permissionCodes = [...new Set(actor.roles.flatMap(row => row.role.permissions.map(row => row.permission.code)))];
  const scope = await new WarehouseAuthScopeService(p).resolve({roleCodes,permissionCodes,isDemo:false,activeWarehouseId:warehouseId,clientScopes:actor.clientScopes,warehouseScopes:actor.warehouseScopes});
  const user = {id:actor.id,name:actor.name,email:actor.email,roleCodes,permissionCodes,...scope,isDemo:false};
  const scopes = new ClientScopeService();
  const connections = new MarketplaceConnectionsService(p, scopes);
  // TEST: deterministic remote boundary; the Docker network is internal, WB is never contacted.
  connections.readRepeatAssemblyWbStatuses = async () => new Map(ids.map(id => [id,{supplierStatus:'complete',wbStatus:'waiting'}]));
  const service = new FbsRepeatAssemblyService(p, scopes, connections);
  const tasksBefore = await p.fbsTsdAssembly.findMany({where:{clientId,connectionId,orderId:{in:ids}},orderBy:{id:'asc'}});
  assert.equal(tasksBefore.length, 38);
  assert(tasksBefore.every(task => task.status === 'COMPLETED'));
  const dto = {clientId,orders:tasksBefore.map(task => ({id:task.orderId,connectionId,assemblyId:task.id}))};
  const balancesBefore = json(await p.stockBalance.findMany({where:{clientId,warehouseId},orderBy:{id:'asc'}}));
  const printsBefore = json(await p.fbsWebKizStickerPrint.findMany({where:{clientId,orderId:{in:ids}},orderBy:{id:'asc'}}));
  const movementsBefore = json(await p.stockMovement.findMany({where:{OR:tasksBefore.map(task => ({idempotencyKey:{startsWith:`fbs-sticker-pick:${task.id}:`}}))},orderBy:{id:'asc'}}));
  const shippedBefore = json(await p.shippedKizHistory.findMany({where:{clientId,orderId:{in:ids}},orderBy:{id:'asc'}}));
  const preview = await service.preview(dto,user);
  assert.equal(preview.orderCount,38);
  const confirmed = {...dto,previewToken:preview.previewToken,confirmAdditionalStockConsumption:true};

  // TEST: a failure after all task/link replacements rolls the entire transaction back.
  const forced = new Error('TEST_FORCED_AUDIT_FAILURE');
  const failingDb = new Proxy(p,{get(target,key){
    if(key === '$transaction') return (callback,options) => p.$transaction(tx => callback(new Proxy(tx,{get(t,k){
      if(k === 'auditLog') return {create:async()=>{throw forced;}};
      return Reflect.get(t,k);
    }})),options);
    return Reflect.get(target,key);
  }});
  await assert.rejects(new FbsRepeatAssemblyService(failingDb,scopes,connections).create(confirmed,user),error=>error===forced);
  assert.deepEqual(json(await p.fbsTsdAssembly.findMany({where:{clientId,connectionId,orderId:{in:ids}},orderBy:{id:'asc'}})),json(tasksBefore));
  assert.equal(await p.fbsAssemblyAttemptHistory.count({where:{id:{in:tasksBefore.map(task=>task.id)}}}),0);
  console.log('PASS rollback after all 38 replacements');

  // TEST: concurrent double submission creates one request; a later retry returns it.
  const outcomes = await Promise.all([service.create(confirmed,user),service.create(confirmed,user)]);
  assert.equal(outcomes[0].request.id,outcomes[1].request.id);
  const created = outcomes[0].request;
  assert.equal((await service.create(confirmed,user)).request.id,created.id);
  const current = await p.fbsTsdAssembly.findMany({where:{requestId:created.id},orderBy:{id:'asc'}});
  assert.equal(current.length,38);
  assert(current.every(task=>task.status==='RESERVED'&&!task.kiz&&!task.barcode&&!task.completedAt&&!task.workerUserId));
  assert(current.every(task=>!tasksBefore.some(old=>old.id===task.id)));
  const archived = await readFbsAttemptHistory(p,{id:{in:tasksBefore.map(task=>task.id)}});
  assert.equal(archived.length,38);
  for(const old of tasksBefore) {
    const restored = json(archived.find(row=>row.task.id===old.id).task);
    delete restored.cargoPacking;
    assert.deepEqual(restored,json(old));
  }
  assert.deepEqual(json(await p.stockBalance.findMany({where:{clientId,warehouseId},orderBy:{id:'asc'}})),balancesBefore);
  assert.deepEqual(json(await p.fbsWebKizStickerPrint.findMany({where:{clientId,orderId:{in:ids}},orderBy:{id:'asc'}})),printsBefore);
  assert.deepEqual(json(await p.shippedKizHistory.findMany({where:{clientId,orderId:{in:ids}},orderBy:{id:'asc'}})),shippedBefore);
  assert.deepEqual(json(await p.stockMovement.findMany({where:{id:{in:movementsBefore.map(row=>row.id)}},orderBy:{id:'asc'}})),movementsBefore);
  const route = await connections.getFbsRequestRoute(created.id,user);
  assert.deepEqual(route.summary,{total:38,gathered:0,routed:38,unavailable:0});
  console.log('PASS concurrent create, retry, 0/38 route and preservation of old facts');

  // TEST: one new print per attempt is allowed, but duplicate KIZ/order+attempt is rejected.
  const printedOld = printsBefore[0];
  assert(printedOld);
  const task = current.find(row=>row.orderId===printedOld.orderId);
  const print = {kiz:`TEST-REPEAT-${randomUUID()}`,orderId:task.orderId,assemblyId:task.id,clientId,requestId:created.id,printedById:user.id,printedBy:'ISOLATED TEST'};
  await p.fbsWebKizStickerPrint.create({data:print});
  await assert.rejects(p.fbsWebKizStickerPrint.create({data:{...print,kiz:`TEST-REPEAT-${randomUUID()}`}}),error=>error.code==='P2002');
  await assert.rejects(p.fbsWebKizStickerPrint.create({data:{...print,assemblyId:randomUUID()}}),error=>error.code==='P2002');
  console.log('PASS print uniqueness by attempt and KIZ');

  // TEST: an exact-SKU repeat creates a fresh stock movement; retry does not consume twice.
  const pick = current.find(row=>!row.relabelRequired);
  assert(pick);
  const where = {clientId,warehouseId,skuId:pick.skuId,boxId:pick.reservedBoxId,status:'AVAILABLE'};
  const quantity = async()=> (await p.stockBalance.aggregate({where,_sum:{quantity:true}}))._sum.quantity || 0;
  const originalQuantity = await quantity();
  const picked = {...pick,boxId:pick.reservedBoxId,boxCode:pick.reservedBoxCode,barcode:pick.barcodes[0],kiz:null};
  await p.$transaction(tx=>connections.reserveCompletedWildberriesStock(tx,picked,warehouseId));
  assert.equal(await quantity(),originalQuantity-1);
  await p.$transaction(tx=>connections.reserveCompletedWildberriesStock(tx,picked,warehouseId));
  assert.equal(await quantity(),originalQuantity-1);
  assert.deepEqual(json(await p.stockMovement.findMany({where:{id:{in:movementsBefore.map(row=>row.id)}},orderBy:{id:'asc'}})),movementsBefore);
  console.log('PASS independent additional physical pick and idempotent retry');
  console.log(JSON.stringify({passed:true,testRequestNumber:created.number,orderCount:38,productionChanged:false,wbCalled:false}));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>p.$disconnect());
