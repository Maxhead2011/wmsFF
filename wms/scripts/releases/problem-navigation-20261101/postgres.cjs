// TEST: only disposable DB. Verify actual scoped feed, independent receipts and archival.
require('reflect-metadata');
const assert=require('node:assert/strict'),{PrismaClient}=require('@prisma/client'),db=new PrismaClient();
assert.equal(new URL(process.env.DATABASE_URL).hostname,'problem-navigation-test-pg');
const mods='/app/apps/api/dist/modules/', {InventoryService}=require(mods+'inventory/inventory.service'),{ClientScopeService}=require(mods+'auth/client-scope.service');
(async()=>{
 const wh=await db.warehouse.create({data:{code:'T',name:'W'}}),c=await db.client.create({data:{code:'C',name:'Client'}});
 const users=await Promise.all(['a','b'].map(email=>db.user.create({data:{email:email+'@example.invalid',name:email,passwordHash:'unused'}})));
 const user=n=>({id:users[n].id,roleCodes:['OWNER'],permissionCodes:['system:admin'],clientScopeMode:'ALL',activeWarehouseId:wh.id,warehouseIds:[wh.id]});
 const create=(title,comment,status)=>db.inventorySession.create({data:{type:'BOX_CHECK',warehouseId:wh.id,clientId:c.id,title,comment,status,createdByName:'Picker',createdByUserId:users[0].id}});
 const a=await create('Нет короба','[FBS_MISSING_PALLET_BOX] Короб: FFL_007; палетсорт: 1','ACTIVE'),b=await create('ФБО: пересчёт FFL_009','[FBO_MISSING_STOCK] {}','COMPLETED');
 const service=new InventoryService(db,new ClientScopeService(),{});let rows=await service.warehouseProblems(user(0));assert.equal(rows.length,1);assert.equal(rows[0].boxCode,'FFL_007');assert.equal(rows[0].kind,'box');
 await service.readWarehouseProblem(a.id,user(0));await service.readWarehouseProblem(a.id,user(0));assert.equal((await service.warehouseProblems(user(0)))[0].isRead,true);assert.equal((await service.warehouseProblems(user(1)))[0].isRead,false);
 rows=await service.warehouseProblems(user(0),true);assert.equal(rows.length,2);assert.equal(rows.find(x=>x.id===b.id).kind,'product');assert.equal((await service.warehouseProblems(user(1),true)).length,1);
 assert.deepEqual(await service.warehouseProblems({...user(0),activeWarehouseId:null}),[]);await assert.rejects(()=>service.readWarehouseProblem(a.id,{...user(0),roleCodes:['MANAGER']}));console.log('Scoped read/archive checks passed');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.$disconnect());
