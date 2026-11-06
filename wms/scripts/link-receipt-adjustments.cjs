// FIX: explicit operational binding; defaults to preview and never modifies stock movements or balances.
const fs=require('fs'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const runtime=createRequire(process.cwd()+'/package.json');
const {PrismaClient}=runtime('@prisma/client');const p=new PrismaClient();
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),save=process.argv.includes('--save');
const {receiptDocuments}=runtime('./dist/modules/warehouse/receipt-channel-policy');
const {applyReceiptLinkedAdjustments}=runtime('./dist/modules/warehouse/receipt-linked-adjustments');
(async()=>{
 assert.equal(process.env.WMS_RECEIPT_LINKED_ADJUSTMENTS_ENABLED,'true','Release flag must be enabled');
 const result=await p.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',`receipt-adjustments:${input.clientId}:${input.warehouseId}:${input.receiptId}`);
  const key=`receipt.adjustments.v1:${input.clientId}:${input.warehouseId}:${input.receiptId}`;
  const existing=await tx.systemSetting.findUnique({where:{key}});
  if(existing){assert.deepEqual(existing.value,input,'Existing binding differs');return {alreadyLinked:true};}
  const docs=await receiptDocuments(tx,input.clientId,input.warehouseId,undefined,undefined,true);
  const doc=docs.find(d=>d.id===input.receiptId);assert(doc,'Receipt missing');
  assert.equal(doc.sourceDocument,input.sourceDocument);
  const allCorrections=await tx.stockMovement.findMany({where:{clientId:input.clientId,warehouseId:input.warehouseId,boxId:{in:doc.boxes.map(b=>b.id)},type:'INVENTORY_ADJUSTMENT'},select:{id:true}});
  assert.deepEqual(allCorrections.map(m=>m.id).sort(),input.movements.map(m=>m.id).sort(),'Corrections changed since review');
  const before=doc.received;
  const proxy=new Proxy(tx,{get(target,prop){if(prop==='systemSetting')return {findMany:async()=>[{value:input}]};return target[prop];}});
  await applyReceiptLinkedAdjustments(proxy,input.clientId,input.warehouseId,[doc]);
  const delta=input.movements.reduce((s,m)=>s+m.quantity,0);assert.equal(doc.received,before+delta);
  if(save){await tx.systemSetting.create({data:{key,value:input}});await tx.auditLog.create({data:{action:'RECEIPT_ADJUSTMENTS_LINKED',entity:'Receipt',entityId:input.receiptId,payload:{clientId:input.clientId,warehouseId:input.warehouseId,before,after:doc.received,delta,movementIds:input.movements.map(m=>m.id),reason:input.reason,stockChanged:false}}});}
  return {saved:save,before,delta,after:doc.received,movements:input.movements.length,stockChanged:false};
 },{isolationLevel:'Serializable',timeout:60000});console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>p.$disconnect());
