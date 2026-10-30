// TEST: disposable internal PostgreSQL only; exercises actual runtime receipt transactions.
const assert=require('node:assert/strict'),path=require('node:path'),{randomUUID}=require('node:crypto');
const url=new URL(process.env.DATABASE_URL||'http://invalid');
assert(process.env.KIZ_GUARD_ISOLATED_TEST==='true' && /test/i.test(url.hostname) && /test/i.test(url.pathname),'Dedicated test database required');
const {PrismaClient,Prisma}=require('@prisma/client'),p=new PrismaClient();
const runtime=process.env.KIZ_RUNTIME_ROOT||'/app/apps/api/dist';
const {StockOperationsService}=require(path.join(runtime,'modules/stock/stock-operations.service.js'));
const {lookupClientKiz,clientKizIdentity,withReceiptErrorKizGuard}=require(path.join(runtime,'common/kiz-client-registry.js'));
const {assertClientKizUse,finishClientKizUse}=require(path.join(runtime,'common/kiz-client-review.js'));
process.env.WMS_KIZ_CLIENT_GUARD_ENABLED='true';
let passed=0;
(async()=>{
 const wh=randomUUID();await p.warehouse.create({data:{id:wh,code:wh,name:'KIZ isolated'}});
 const customers=[];
 for(let i=0;i<2;i++){
  const id=randomUUID(),sku=randomUUID(),box=randomUUID();
  await p.client.create({data:{id,code:id,name:'Synthetic client'}});
  await p.sku.create({data:{id:sku,clientId:id,internalSku:sku,name:'Synthetic suit',needsChestnyZnak:true}});
  await p.box.create({data:{id:box,code:box,clientId:id,warehouseId:wh,status:'receiving'}});
  customers.push({id,sku,box});
 }
 function service(c){
  const s=Object.create(StockOperationsService.prototype);
  Object.assign(s,{prisma:p,clientScopes:{requireClientAccess(){}},resolveWritableWarehouseId:()=>wh,requireBalanceWarehouseId:v=>v,
   resolveOrCreateSkuForReceipt:async()=>({sku:await p.sku.findUnique({where:{id:c.sku}}),createdDraft:false}),
   ensureTargetBox:async()=>p.box.findUnique({where:{id:c.box}}),
   incrementTargetBalance:async(tx,input)=>{const balanceKey=JSON.stringify([c.id,c.sku,c.box,input.status]);
    return tx.stockBalance.upsert({where:{balanceKey},create:{...input,balanceKey},update:{quantity:{increment:input.quantity}}});}});
  return s;
 }
 const c=customers[0],s=service(c),user={id:'synthetic',activeWarehouseId:wh};
 const serial='010460000000000121AbCdEfGhIjKlM',full=serial+'\u001d91EE12\u001d92proof';
 const input=(kiz,key)=>({clientId:c.id,kiz,idempotencyKey:key,barcode:'4600000000001',boxCode:c.box,quantity:1});
 const races=await Promise.allSettled([s.receiveIntoBox(input(full,'race-a'),user),s.receiveIntoBox(input(serial,'race-b'),user)]);
 assert.equal(races.filter(v=>v.status==='fulfilled').length,1,JSON.stringify(races.map(v=>v.status==='rejected'?v.reason.message:v.value)));
 assert.equal(races.filter(v=>v.status==='rejected').length,1);
 assert.equal((await p.stockBalance.aggregate({where:{clientId:c.id},_sum:{quantity:true}}))._sum.quantity,1);
 assert.equal(await p.productMark.count({where:{clientId:c.id}}),1);passed++;
 const accepted=races[0].status==='fulfilled'?'race-a':'race-b';
 assert.equal((await s.receiveIntoBox(input(full,accepted),user)).status,'ALREADY_APPLIED');passed++;
 const another='010460000000000121QbCdEfGhIjKlM';
 const replays=await Promise.all([s.receiveIntoBox(input(another,'same-operation'),user),s.receiveIntoBox(input(another,'same-operation'),user)]);
 assert.deepEqual(replays.map(x=>x.status).sort(),['ALREADY_APPLIED','APPLIED']);passed++;
 const d=customers[1];await service(d).receiveIntoBox({clientId:d.id,kiz:full,idempotencyKey:'other-client',barcode:'4600000000001',boxCode:d.box,quantity:1},user);
 const identities=await p.$queryRaw(Prisma.sql`SELECT "clientId" FROM "KizClientRegistry" WHERE identity=${clientKizIdentity(full)}`);
 assert.equal(identities.length,2);passed++;
 const first=await lookupClientKiz(p,c.id,serial);
 assert.equal(first.firstBoxCode,c.box);assert(first.firstReceivedAt);passed++;
 await p.productMark.deleteMany({where:{clientId:c.id,value:{in:[serial,full]}}});
 const after=await lookupClientKiz(p,c.id,serial);assert.equal(after.firstReceivedAt,first.firstReceivedAt);assert.equal(after.firstBoxCode,c.box);
 await assert.rejects(s.receiveIntoBox(input(serial,'deleted-mark-receipt'),user),/ДУБЛЬ КИЗ/);passed++;
 const counts=await p.stockBalance.aggregate({where:{clientId:c.id},_sum:{quantity:true}});assert.equal(counts._sum.quantity,2);passed++;
 // TEST: the physical-mark fallback recognizes combined legacy scanner formats without a registry row.
 const legacy='010460000000000121ZbCdEfGhIjKlM';
 const legacyRaw=']d2(01)'+legacy.slice(2,16)+'(21)'+legacy.slice(18);
 const legacyMark=await p.productMark.create({data:{clientId:c.id,skuId:c.sku,value:legacyRaw,boxId:c.box,status:'AVAILABLE'}});
 assert.equal((await lookupClientKiz(p,c.id,legacy)).currentBoxCode,c.box);passed++;
 // TEST: no extra unmarked unit when ordinary receipt races administrative acceptance with an error.
 const errorKiz='010460000000000121EbCdEfGhIjKlM';
 const beforeError=(await p.stockBalance.aggregate({where:{clientId:c.id},_sum:{quantity:true}}))._sum.quantity;
 const errorRace=await Promise.allSettled([
  withReceiptErrorKizGuard(p,{clientId:c.id,kiz:errorKiz,operationKey:'error-race',warehouseId:wh},
    tx=>s.receiveIntoBox({...input(undefined,'error-race'),allowReceiptError:true},user,tx)),
  s.receiveIntoBox(input(errorKiz,'ordinary-race'),user)]);
 assert.equal(errorRace.filter(x=>x.status==='fulfilled').length,1,JSON.stringify(errorRace.map(x=>x.status==='rejected'?x.reason.message:x.value)));
 assert.equal((await p.stockBalance.aggregate({where:{clientId:c.id},_sum:{quantity:true}}))._sum.quantity,beforeError+1);passed++;
 // TEST: two independent orders cannot claim one KIZ, even before the first shipment exists.
 const requestA=await p.clientRequest.create({data:{clientId:c.id,warehouseId:wh,type:'OUTBOUND',status:'IN_WORK',title:'Synthetic A'}});
 const requestB=await p.clientRequest.create({data:{clientId:c.id,warehouseId:wh,type:'OUTBOUND',status:'IN_WORK',title:'Synthetic B'}});
 async function task(request){return p.fbsTsdAssembly.create({data:{clientId:c.id,requestId:request.id,connectionId:'synthetic',orderId:randomUUID(),requestItemId:randomUUID(),skuId:c.sku,boxId:c.box,productName:'Synthetic',barcodes:[],storageBoxes:[],deviceCode:'synthetic'}});}
 const ta=await task(requestA),tb=await task(requestB);
 const use=(request,t)=>({scope:'FBS',clientId:c.id,warehouseId:wh,requestId:request.id,taskId:t.id,kiz:legacy,skuId:c.sku,boxId:c.box});
 const inputs=[use(requestA,ta),use(requestB,tb)];
 const claims=await Promise.allSettled(inputs.map(i=>p.$transaction(tx=>assertClientKizUse(tx,i,user))));
 assert.equal(claims.filter(x=>x.status==='fulfilled').length,1,JSON.stringify(claims.map(x=>x.status==='rejected'?x.reason.message:x.value)));
 assert.equal(await p.kizReviewCase.count({where:{clientId:c.id,status:'CLAIMED',resolution:'FIRST_USE'}}),1);passed++;
 // TEST: consuming the permission does not authorize another order inside the same WMS request.
 const winner=claims[0].status==='fulfilled'?0:1,wonInput=inputs[winner],wonTask=winner===0?ta:tb,wonRequest=winner===0?requestA:requestB;
 await p.$transaction(async tx=>{await finishClientKizUse(tx,wonInput);await tx.shippedKizHistory.create({data:{assemblyId:wonTask.id,clientId:c.id,warehouseId:wh,requestId:wonRequest.id,requestNumber:wonRequest.number,requestTitle:wonRequest.title,clientName:'Synthetic',skuId:c.sku,internalSku:c.sku,productName:'Synthetic',kiz:legacy,shippedAt:new Date()}});});
 const second=await task(wonRequest);
 await assert.rejects(p.$transaction(tx=>assertClientKizUse(tx,use(wonRequest,second),user)),e=>e.getResponse?.().code==='KIZ_REVIEW_REQUIRED');passed++;
 // TEST: an early assembly registration cannot race a new receipt before ProductMark/task.kiz is written.
 const fresh='010460000000000121FbCdEfGhIjKlM',early=await task(requestA);
 let claimed,release;const ready=new Promise(r=>claimed=r),hold=new Promise(r=>release=r);
 const claim=p.$transaction(async tx=>{await assertClientKizUse(tx,{...use(requestA,early),kiz:fresh},user);claimed();await hold;});
 await ready;
 const during=s.receiveIntoBox(input(fresh,'receipt-after-claim'),user).then(()=>({accepted:true}),e=>({accepted:false,code:e.getResponse?.().code}));
 release();await claim;assert.deepEqual(await during,{accepted:false,code:'KIZ_DUPLICATE'});
 const origin=await lookupClientKiz(p,c.id,fresh);assert.equal(origin.firstReceivedAt,null);assert.equal(origin.source,'LEGACY_UNKNOWN');passed++;
 console.log(JSON.stringify({passed,isolatedPostgres:true,clientCount:customers.length}));
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(()=>p.$disconnect());
