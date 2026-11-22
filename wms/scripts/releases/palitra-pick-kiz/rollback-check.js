// TEST: run the candidate policy on a real branch balance, rolling the generated identity back.
const {PrismaClient}=require('@prisma/client');
const {bindNewPickMark}=require('./dist/common/palitra-pick-kiz');
const assert=require('node:assert/strict');
const db=new PrismaClient();
const rollback=new Error('rollback fixture');
(async()=>{
 const clientId='e8597352-0b93-442c-9582-c694620a9695';
 const sku=await db.sku.findFirstOrThrow({where:{clientId,barcodes:{some:{value:'4610460840526'}}}});
 const balance=await db.stockBalance.findFirstOrThrow({where:{clientId,skuId:sku.id,quantity:{gt:0},boxId:null,palletId:null,status:'AVAILABLE'}});
 const kiz='010461046084052621'+require('crypto').randomBytes(7).toString('hex').slice(0,13);
 const input={clientId,warehouseId:balance.warehouseId,skuId:sku.id,boxId:null,kiz};
 await db.$transaction(async tx=>{
  const before=await tx.stockBalance.findUniqueOrThrow({where:{id:balance.id}});
  const mark=await bindNewPickMark(tx,input,'ROLLBACK-TEST');
  assert(mark.stockMovementId);
  assert.equal(mark.boxId,null);
  assert.equal(mark.status,'AVAILABLE');
  assert.equal((await tx.stockBalance.findUniqueOrThrow({where:{id:balance.id}})).quantity,before.quantity);
  await assert.rejects(()=>bindNewPickMark(tx,input,'ROLLBACK-TEST'));
  const user=await tx.user.findFirstOrThrow({select:{id:true,name:true}});
  const id=require('node:crypto').randomUUID();
  const request=await tx.clientRequest.create({data:{id,number:-Math.floor(Math.random()*1000000000)-1,clientId,warehouseId:balance.warehouseId,type:'OUTBOUND',status:'IN_WORK',title:'ROLLBACK ONLY'},include:{client:true}});
  const item=await tx.clientRequestItem.create({data:{requestId:id,skuId:sku.id,name:sku.name,barcode:'4610460840526',quantity:1},include:{sku:{include:{barcodes:true}}}});
  await tx.fboAssembly.create({data:{requestId:id,compositionHash:'rollback'}});
  const second='010461046084052621'+require('crypto').randomBytes(7).toString('hex').slice(0,13);
  const {FboTwoStageService}=require('./dist/modules/tsd/fbo-two-stage.service');
  const {StockBalancesService}=require('./dist/modules/stock/stock-balances.service');
  const svc=new FboTwoStageService(db,null,new StockBalancesService(db));
  await require('./dist/modules/tsd/fbo-unboxed-picking').pickUnboxed(tx,request,[{...item,remaining:1}],{action:'PICK_UNIT',barcode:item.barcode,kiz:second},id,user,svc.move.bind(svc),()=>{throw Error('unexpected original lookup')});
  const unit=await tx.fboAssemblyUnit.findFirstOrThrow({where:{requestId:id}});
  assert.equal(unit.kiz,second);assert.equal(unit.pickedByUserId,user.id);assert.equal(unit.state,'PICKED');
  assert.equal((await tx.stockBalance.findUniqueOrThrow({where:{id:balance.id}})).quantity,before.quantity-1);
  assert.deepEqual((await tx.stockMovement.findMany({where:{sourceDocument:id},select:{type:true,quantity:true}})).map(x=>x.type+':'+x.quantity).sort(),['MOVE:-1','MOVE:1']);
  throw rollback;
 },{isolationLevel:'Serializable',timeout:30000}).catch(error=>{if(error!==rollback)throw error;});
 assert.equal(await db.productMark.count({where:{clientId,value:kiz}}),0);
 console.log('Verified loose-stock binding, duplicate rejection, unchanged quantity and rollback.');
})().finally(()=>db.$disconnect());
