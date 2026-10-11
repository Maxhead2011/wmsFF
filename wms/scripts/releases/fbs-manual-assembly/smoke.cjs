// TEST: real candidate and WB reads; preview transaction is always rolled back.
require('reflect-metadata');const assert=require('node:assert/strict');
const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();
const base='/app/apps/api/dist/';
const {FbsManualAssemblyService}=require(base+'modules/marketplace-connections/fbs-manual-assembly.service');
const {FbsManualAssemblyController}=require(base+'modules/marketplace-connections/fbs-manual-assembly.controller');
const {MarketplaceConnectionsService}=require(base+'modules/marketplace-connections/marketplace-connections.service');
const {ClientScopeService}=require(base+'modules/auth/client-scope.service');
(async()=>{
 const actor=await db.user.findUniqueOrThrow({where:{id:'b045e060-dfd7-48af-bb88-12c191ee8eae'},include:{roles:{include:{role:{include:{permissions:{include:{permission:true}}}}}}}});
 const permissionCodes=[...new Set(actor.roles.flatMap(r=>r.role.permissions.map(p=>p.permission.code)))];
 assert.equal(actor.status,'ACTIVE');assert(permissionCodes.includes('system:admin'));
 const user={id:actor.id,email:actor.email,name:actor.name,roleCodes:actor.roles.map(r=>r.role.code),permissionCodes,isDemo:actor.isDemo,activeWarehouseId:actor.activeWarehouseId,clientScopeMode:'ALL',clientIds:[],writableClientIds:[]};
 const scopes=new ClientScopeService();let rolledBack=false;
 const rollbackPrisma=new Proxy(db,{get(target,key){
  if(key!=='$transaction')return Reflect.get(target,key);
  return async(fn,options)=>{const abort=new Error('TEST preview rollback');let value;
   try{await db.$transaction(async tx=>{value=await fn(tx);throw abort;},options);}catch(e){if(e!==abort)throw e;rolledBack=true;}
   return value;
  };
 }});
 const service=new FbsManualAssemblyService(rollbackPrisma,scopes,new MarketplaceConnectionsService(db,scopes));
 const controller=new FbsManualAssemblyController(service);
 assert.deepEqual(controller.capabilities(user),{enabled:true});
 assert.deepEqual(controller.capabilities({...user,roleCodes:['MANAGER']}),{enabled:false});
 const input={clientId:'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9',connectionId:'3f022635-2efb-4b56-85ab-dfd48d9c24a8',warehouseId:'afb244a1-50ae-4ae6-9111-afe85949fa58',orderIds:['5996192771','5996851459']};
 const options=await controller.options(input.clientId,user);assert(options.connections.some(c=>c.id===input.connectionId));assert(options.warehouses.some(w=>w.id===input.warehouseId));
 const preview=await controller.preview(input,user);assert(rolledBack);assert.equal(preview.canCreate,false);assert.equal(preview.token,null);
 assert.equal(preview.rows.length,2);assert(preview.rows.every(r=>r.blockers.some(b=>b.includes('Уже есть связь с заявкой №1921'))));
 console.log(JSON.stringify({passed:true,previewRolledBack:true,businessWrites:false,capability:true,unauthorizedRoleBlocked:true,options:true,existingRequest:1921,orders:preview.rows.map(r=>({orderId:r.orderId,supplyId:r.supplyId,blocked:true}))}));
})().finally(()=>db.$disconnect()).catch(e=>{console.error(e.stack);process.exitCode=1;});
