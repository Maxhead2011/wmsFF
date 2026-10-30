// FIX: authorized, exact-box ledger correction; picked units and marks are never updated.
const assert=require('node:assert/strict');
const requestId='56c62e8a-a0b0-4392-a81e-823342cad907',boxId='57a5c7a2-c1cf-45c7-9dd6-1cb918d1b962',clientId='c76b78f9-1b83-4e9b-bee3-bc28336ee1c9',actorId='b045e060-dfd7-48af-bb88-12c191ee8eae',receipt='repair-box519-counted-stock-20261030';
async function repair(tx,apply=false){
 await tx.$queryRawUnsafe('SELECT id FROM "ClientRequest" WHERE id=$1 FOR UPDATE',requestId);
 await tx.$queryRawUnsafe('SELECT id FROM "Box" WHERE id=$1 FOR UPDATE',boxId);
 const existing=await tx.auditLog.findUnique({where:{id:receipt}});if(existing)return{repeated:true,payload:existing.payload};
 const r=await tx.clientRequest.findUniqueOrThrow({where:{id:requestId}}),box=await tx.box.findUniqueOrThrow({where:{id:boxId}});assert.equal(r.number,2565);assert.equal(r.clientId,clientId);assert.equal(box.clientId,clientId);assert.equal(box.code,'FFL_LKB2709_519');assert.equal(box.warehouseId,r.warehouseId);
 assert.equal(await tx.inventorySession.count({where:{type:'FULL',status:{in:['ACTIVE','REVIEW']}}}),0);
 assert.equal(await tx.inventoryAuditBox.count({where:{boxId,status:{in:['COUNTING','MISMATCH']},session:{status:{in:['ACTIVE','REVIEW']}}}}),0);
 assert.equal(await tx.productMark.count({where:{boxId}}),0);
 const units=await tx.fboAssemblyUnit.findMany({where:{requestId,sourceBoxId:boxId},orderBy:{id:'asc'}});assert.equal(units.length,9);assert.equal(units.filter(u=>u.barcode==='2056223937997'&&u.state!=='RETURNED').length,7);assert.equal(units.filter(u=>u.barcode==='2056223938000'&&u.state!=='RETURNED').length,2);
 const balances=await tx.stockBalance.findMany({where:{boxId,quantity:{not:0}},orderBy:{skuId:'asc'}});assert.equal(balances.length,2);
 const expected={'fff4eb06-e30d-4261-9d55-0ff63e428394':8,'bea45de9-cbf1-40de-a1ab-bcd3abec4ba9':2};
 for(const b of balances){assert.equal(b.clientId,clientId);assert.equal(b.warehouseId,r.warehouseId);assert.equal(b.status,'AVAILABLE');assert.equal(b.quantity,expected[b.skuId]);}
 const before={balances,units};if(!apply)return{preview:true,before};
 const reason='Катерина подтвердила пустой короб: 7 S + 2 M отобраны Шохидой в №2565, 1 S ранее в №2284. Удалён повторно учтённый остаток после перепривязки КИЗ; отбор и КИЗ сохранены.';
 for(const b of balances){const updated=await tx.stockBalance.updateMany({where:{id:b.id,quantity:b.quantity,status:'AVAILABLE'},data:{quantity:0}});assert.equal(updated.count,1);
 await tx.stockMovement.create({data:{clientId,warehouseId:b.warehouseId,skuId:b.skuId,boxId,palletId:b.palletId,status:'AVAILABLE',type:'INVENTORY_ADJUSTMENT',quantity:-b.quantity,sourceDocument:requestId,idempotencyKey:receipt+':'+b.id,comment:reason}});}
 assert.deepEqual(await tx.fboAssemblyUnit.findMany({where:{requestId,sourceBoxId:boxId},orderBy:{id:'asc'}}),units);
 await tx.auditLog.create({data:{id:receipt,userId:actorId,action:'FBO_COUNTED_STOCK_CORRECTED',entity:'Box',entityId:boxId,payload:JSON.parse(JSON.stringify({reason,before,after:{available:0,pickedUnitsPreserved:9}}))}});
 return{applied:true,box:box.code,removed:10,available:0,pickedUnitsPreserved:9};
}
module.exports={repair};
if(require.main===module){const{PrismaClient}=require('@prisma/client'),p=new PrismaClient();p.$transaction(tx=>repair(tx,process.argv.includes('--apply')),{isolationLevel:'Serializable',timeout:30000}).then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());}
