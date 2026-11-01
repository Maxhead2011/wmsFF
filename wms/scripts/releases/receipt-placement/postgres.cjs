// TEST: the exact published modules, controller metadata and concurrent placement.
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const req = createRequire('/app/apps/api/dist/main.js');
req('reflect-metadata');
const {PrismaClient} = req('@prisma/client');
const {StorageLocationsService} = req('./modules/warehouse/storage-locations.service');
const {StorageLocationsController} = req('./modules/warehouse/storage-locations.controller');
const {TsdDeviceController} = req('./modules/tsd/tsd-device.controller');
const {randomUUID} = require('node:crypto');
const p = new PrismaClient();
(async () => {
  try {
    for (const [controller, method, route] of [[StorageLocationsController,'placementReport','placement-report'],[StorageLocationsController,'receiptPlacementTasks','receipt-placement'],[TsdDeviceController,'receiptPlacementTasks','receipt-placement']]) {
      assert.equal(Reflect.getMetadata('path', controller.prototype[method]), route);
    }
    await p.$executeRawUnsafe('CREATE TABLE "ReceiptStockIdentity" ("boxId" text PRIMARY KEY,"receiptAt" timestamptz)');
    const clientId=randomUUID(),warehouseId=randomUUID(),skuId=randomUUID(),users=[randomUUID(),randomUUID()],pallets=[randomUUID(),randomUUID()];
    await p.client.create({data:{id:clientId,code:clientId,name:'Fixture'}});
    await p.warehouse.create({data:{id:warehouseId,code:warehouseId,name:'Fixture'}});
    await p.sku.create({data:{id:skuId,internalSku:skuId,clientId,name:'Fixture'}});
    for(let i=0;i<2;i++) {
      await p.user.create({data:{id:users[i],email:users[i]+'@test.invalid',name:'Manager '+i,passwordHash:'test'}});
      const box=await p.box.create({data:{code:'BOX_'+i,clientId,warehouseId,status:'active'}});
      await p.stockBalance.create({data:{balanceKey:box.id,clientId,warehouseId,skuId,boxId:box.id,status:'AVAILABLE',quantity:1}});
      await p.storagePallet.create({data:{id:pallets[i],code:'PALLET_'+i,clientId,warehouseId,status:'OPEN',source:'TEST'}});
      await p.systemSetting.create({data:{key:'receipt.membership.v1:'+clientId+':'+box.id,value:{clientId,warehouseId,series:'SERIES:2026:FIXTURE'}}});
    }
    const service=new StorageLocationsService(p,{},{});
    const actor=i=>({id:users[i],name:'Manager '+i,permissionCodes:['system:admin'],roleCodes:['ADMIN'],clientScopeMode:'ALL',activeWarehouseId:warehouseId,warehouseIds:[warehouseId],writableWarehouseIds:[warehouseId]});
    const receipt={placementClientId:clientId,placementDocument:'SERIES:2026:FIXTURE'};
    const started=await service.receiptPlacementAction({...receipt,action:'START'},actor(0));
    assert.equal(started.remaining.length,2);
    assert.equal((await service.receiptPlacementAction({...receipt,action:'FINISH'},actor(1))).canFinish,false);
    assert.equal((await service.receiptPlacementAction({...receipt,action:'DEFER'},actor(1))).status,'DEFERRED');
    await assert.rejects(service.addBox(pallets[0],{boxCode:'BOX_0',...receipt,placementDocument:'OTHER'},actor(0)));
    await Promise.all(pallets.map((id,i)=>service.addBox(id,{boxCode:'BOX_'+i,...receipt},actor(i))));
    const report=await service.placementReport(actor(0));assert.equal(report.summary.awaiting,0);assert.equal(report.summary.boxes,2);assert.equal(report.summary.pallets,2);
    const completed=await service.receiptPlacementAction({...receipt,action:'FINISH'},actor(0));assert.equal(completed.canFinish,true);
    assert.equal(await p.auditLog.count({where:{action:'RECEIPT_PLACEMENT_COMPLETED'}}),1);
    assert.equal((await p.stockBalance.aggregate({_sum:{quantity:true}}))._sum.quantity,2);
    console.log('PASS exact API routes, completion warning, defer, membership guard, two managers, idempotence and stock invariance');
  } finally { await p.$disconnect(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
