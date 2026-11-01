// TEST: exercise the release modules on disposable PostgreSQL.
require('reflect-metadata');
const {PrismaClient}=require('@prisma/client'),assert=require('node:assert/strict'),db=new PrismaClient();
assert.equal(new URL(process.env.DATABASE_URL).hostname,'fbo-deficit-test-pg');
const base='/app/apps/api/dist/modules/', {ClientScopeService}=require(base+'auth/client-scope.service'),
{ClientRequestsService}=require(base+'client-requests/client-requests.service'),{InventoryService}=require(base+'inventory/inventory.service');
(async()=>{
 const wh=await db.warehouse.create({data:{code:'T',name:'Test'}}),client=await db.client.create({data:{name:'Fixture',code:'TEST',stockBalanceMode:'BOXES'}}),
 actor=await db.user.create({data:{email:'fixture@example.invalid',name:'Picker',passwordHash:'disabled'}}),
 sku=await db.sku.create({data:{clientId:client.id,internalSku:'SKU1',name:'Test',isUnmarked:true}});
 await db.warehouseClient.create({data:{clientId:client.id,warehouseId:wh.id,status:'ACTIVE'}});
 const box=await db.box.create({data:{clientId:client.id,warehouseId:wh.id,code:'BOX',status:'active'}});
 await db.stockBalance.create({data:{balanceKey:'test',warehouseId:wh.id,clientId:client.id,boxId:box.id,skuId:sku.id,status:'AVAILABLE',quantity:13}});
 const pallet=await db.pallet.create({data:{clientId:client.id,code:'PALLET'}});await db.box.update({where:{id:box.id},data:{palletId:pallet.id}});
 const user={id:actor.id,name:actor.name,roleCodes:['OWNER'],permissionCodes:['system:admin'],clientScopeMode:'ALL',warehouseIds:[wh.id],writableWarehouseIds:[wh.id],activeWarehouseId:wh.id,clientIds:[client.id],writableClientIds:[client.id]};
 const dto={clientId:client.id,warehouseId:wh.id,fboExcel:true,type:'OUTBOUND',title:'Excel',destinationCity:'Москва',items:[{skuId:sku.id,barcode:'123',quantity:14}]};
 const scopes=new ClientScopeService(),req=new ClientRequestsService(db,scopes,{}),inventory=new InventoryService(db,scopes,{});
 const fail=await req.previewAvailability(dto,user);assert.equal(fail.canCommit,false);
 await assert.rejects(()=>req.create(dto,user));assert.equal(await db.clientRequest.count(),0);
 await db.inventorySession.create({data:{clientId:client.id,warehouseId:wh.id,type:'BOX_CHECK',title:'Missing BOX',comment:'[FBO_MISSING_PALLET_BOX] BOX; pallet 1',createdByUserId:actor.id,createdByName:actor.name}});
 const rows=await inventory.warehouseProblems(user);assert.equal(rows.length,1);assert.equal(rows[0].worker,'Picker');assert.equal(rows[0].client,'Fixture');
 await assert.rejects(()=>inventory.warehouseProblems({...user,roleCodes:['MANAGER']}));
 const {validate}=require('class-validator'),{FboActionDto}=require(base+'tsd/dto/fbo-action.dto');
 for(const action of ['STOP_PICK','TRANSFER_REMAINDER','REPORT_MISSING','REPORT_MISSING_BOX'])assert.equal((await validate(Object.assign(new FboActionDto(),{action,operationId:'test-12345678'}))).some(e=>e.property==='action'),false,action);
 dto.items[0].quantity=3;dto.fboDecisions=[{barcode:'123',originalQuantity:14,finalQuantity:3}];
 const request=await req.create(dto,user);assert(await db.auditLog.findFirst({where:{entityId:request.id,action:'FBO_EXCEL_STOCK_CHECK'}}));
 const {FboTwoStageService}=require(base+'tsd/fbo-two-stage.service'),fbo=new FboTwoStageService(db,scopes,{}, {}, new (require("/app/apps/api/dist/common/inventory/inventory-lock.service").InventoryLockService)(db), {});
 await fbo.act(request.id,{action:'START',operationId:'test-start-1'},user);
 const plan=await fbo.plan(request.id,user);assert.equal(plan.missingStockReportingSupported,true);assert.equal(plan.route[0].boxCode,'BOX');
 const signal={action:'REPORT_MISSING_BOX',sourceBoxCode:'BOX',palletCode:plan.route[0].pallet,operationId:'test-no-box'};
 await fbo.act(request.id,signal,user);await fbo.act(request.id,signal,user);
 assert.equal(await db.inventorySession.count({where:{title:{contains:'ФБО №'+request.number}}}),1);
 const report={action:'REPORT_MISSING',sourceBoxCode:'BOX',barcode:'123',missingQuantity:'1',operationId:'test-no-item'};
 await fbo.act(request.id,report,user);assert(await db.inventorySession.findUnique({where:{id:request.id+':'+report.operationId}}));
 assert.equal(await db.auditLog.count({where:{action:'HOLD'}}),1);
 assert.equal(await db.stockBalance.count({where:{quantity:13}}),1);console.log('Release API fixture passed');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.$disconnect());
