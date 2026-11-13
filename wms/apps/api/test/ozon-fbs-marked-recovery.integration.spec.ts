import {afterAll, beforeAll, expect, it, vi} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {recoverOzonMarkedPacking} from '../src/modules/marketplace-connections/ozon-fbs-marked-recovery';
import {assertClientRequestKizShipment,finishClientRequestKizShipment} from '../src/common/kiz-client-review';
import {captureShippedKizHistory} from '../src/common/shipment-history/shipped-kiz-history';

// TEST: opt-in isolated PostgreSQL; never use the application's DATABASE_URL.
const url=process.env.OZON_MARKED_TEST_DATABASE_URL;
const enabled=!!url;
let db:PrismaClient;
beforeAll(async()=>{
 if(!enabled)return;
 const parsed=new URL(url!);
 if(!['localhost','127.0.0.1'].includes(parsed.hostname)||parsed.port!=='55489')throw new Error('Dedicated local test database required');
 db=new PrismaClient({datasources:{db:{url}}});
 await db.$executeRaw`CREATE TABLE IF NOT EXISTS "OzonFbsPickState" ("assemblyId" TEXT PRIMARY KEY REFERENCES "FbsTsdAssembly"("id") ON DELETE CASCADE, "data" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`;
 await db.$executeRaw`CREATE TABLE IF NOT EXISTS "KizClientRegistry" ("clientId" TEXT NOT NULL, identity TEXT NOT NULL, "firstReceivedAt" TIMESTAMPTZ, "firstBoxCode" TEXT, "firstWarehouseId" TEXT, "productName" TEXT, barcode TEXT, "skuId" TEXT, "operationKey" TEXT, "sourceDocument" TEXT, "userId" TEXT, source TEXT NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("clientId",identity))`;
 for(const flag of ['WMS_OZON_UNIT_MARKS_ENABLED','WMS_OZON_MULTILINE_PICKING','WMS_KIZ_CLIENT_GUARD_ENABLED'])vi.stubEnv(flag,'true');
});
afterAll(async()=>{await db?.$disconnect();vi.unstubAllEnvs();});
// TEST: shipped recovery preserves the marketplace-confirmed handover and is idempotent.
it.skipIf(!enabled)('restores two shipped units once and preserves DONE timestamp',async()=>{
 const f=await fixture();
 const done=await db.clientRequest.update({where:{id:f.request.id},data:{status:'DONE'}});
 f.service.readOzonFbsPickPosting.mockImplementation(async()=>({posting_number:f.task.orderId,status:'delivering',products:f.units.map((u,n)=>({sku:u.productId,offer_id:'offer'+n,quantity:1}))}));
 const input={...f.input,mode:'SHIPPED' as const};
 expect(await recoverOzonMarkedPacking(f.service,input,f.user)).toMatchObject({status:'APPLIED',units:2});
 expect(await recoverOzonMarkedPacking(f.service,input,f.user)).toMatchObject({status:'ALREADY_APPLIED'});
 const request=await db.clientRequest.findUniqueOrThrow({where:{id:f.request.id}});
 expect(request.status).toBe('DONE');expect(request.updatedAt).toEqual(done.updatedAt);
 const movements=await db.stockMovement.findMany({where:{sourceDocument:f.request.id}});
 expect(movements).toHaveLength(2);
 expect(movements.map(m=>m.quantity)).toEqual([-1,-1]);
 expect(new Set(movements.map(m=>m.skuId))).toEqual(new Set(f.units.map(u=>u.skuId)));
 expect((await db.stockBalance.aggregate({where:{clientId:f.client.id},_sum:{quantity:true}}))._sum.quantity).toBe(18);
 expect(await db.productMark.count({where:{clientId:f.client.id,status:'SHIPPING'}})).toBe(2);
 const marks=await db.productMark.findMany({where:{clientId:f.client.id},include:{stockMovement:true}});
 for(const mark of marks)expect(mark.stockMovement?.skuId).toBe(mark.skuId);
 expect(await db.kizReviewCase.count({where:{clientId:f.client.id,status:'USED'}})).toBe(2);
 expect(await db.shippedKizHistory.count({where:{clientId:f.client.id}})).toBe(2);
 expect(await db.clientRequestEvent.count({where:{requestId:f.request.id}})).toBe(1);
},30000);
// TEST: a late failure rolls back decrements, marks, repaired items and pick state together.
it.skipIf(!enabled)('rolls back shipped recovery when the second debit fails',async()=>{
 const f=await fixture();
 await db.clientRequest.update({where:{id:f.request.id},data:{status:'DONE'}});
 f.service.readOzonFbsPickPosting.mockImplementation(async()=>({posting_number:f.task.orderId,status:'delivering',products:f.units.map((u,n)=>({sku:u.productId,offer_id:'offer'+n,quantity:1}))}));
 let writes=0;
 const prisma=new Proxy(db,{get(target,key){if(key==='$transaction')return (fn:any,opts:any)=>target.$transaction(async tx=>{
  const proxy=new Proxy(tx,{get(t,k){if(k==='stockMovement')return {...t.stockMovement,create:async(args:any)=>{if(++writes===2)throw new Error('TEST second debit failure');return t.stockMovement.create(args);}};return Reflect.get(t,k);}});
  return fn(proxy);
 },opts);return Reflect.get(target,key);}});
 await expect(recoverOzonMarkedPacking({...f.service,prisma},{...f.input,mode:'SHIPPED'},f.user)).rejects.toThrow('TEST second debit failure');
 expect(writes).toBe(2);
 expect(await db.stockMovement.count({where:{clientId:f.client.id}})).toBe(0);
 expect(await db.productMark.count({where:{clientId:f.client.id}})).toBe(0);
 expect(await db.kizReviewCase.count({where:{clientId:f.client.id}})).toBe(0);
 expect((await db.stockBalance.aggregate({where:{clientId:f.client.id},_sum:{quantity:true}}))._sum.quantity).toBe(20);
 expect(await db.$queryRaw`SELECT "assemblyId" FROM "OzonFbsPickState" WHERE "assemblyId"=${f.task.id}`).toEqual([]);
 const items=await db.clientRequestItem.findMany({where:{requestId:f.request.id}});
 expect(items).toHaveLength(1);expect(items[0].quantity).toBe(2);
 expect((await db.clientRequest.findUniqueOrThrow({where:{id:f.request.id}})).status).toBe('DONE');
},30000);
async function fixture(){
 const key=randomUUID();
 const client=await db.client.create({data:{code:key,name:'Recovery test'}});
 const wh=await db.warehouse.create({data:{code:key,name:'Recovery test'}});
 const actor=await db.user.create({data:{email:key+'@example.invalid',name:'Test owner',passwordHash:'unused'}});
 const units=[];
 for(const [n,barcode] of ['4610460840526','4610460840540'].entries()){
  const sku=await db.sku.create({data:{clientId:client.id,internalSku:String(n),name:'Food '+n,needsChestnyZnak:true,
   barcodes:{create:[{value:barcode},{value:'offer'+n}]}}});
  await db.stockBalance.create({data:{balanceKey:key+n,clientId:client.id,warehouseId:wh.id,skuId:sku.id,status:'AVAILABLE',quantity:10}});
  units.push({productId:n+1,skuId:sku.id,barcode,kiz:'01'+barcode.padStart(14,'0')+'21'+(n?'5K.W,b':'5OdGM-')});
 }
 const request=await db.clientRequest.create({data:{clientId:client.id,warehouseId:wh.id,type:'OUTBOUND',title:'Recovery',
  items:{create:{skuId:units[0].skuId,quantity:2}}},include:{items:true}});
 const task=await db.fbsTsdAssembly.create({data:{clientId:client.id,connectionId:key,marketplace:'OZON',orderId:key,
  requestId:request.id,requestItemId:request.items[0].id,skuId:units[0].skuId,productName:'Food',barcodes:[],storageBoxes:[],itemCount:2,requiresKiz:true,deviceCode:'TEST'}});
 await db.fbsOrderRequestLink.create({data:{clientId:client.id,connectionId:key,marketplace:'OZON',orderId:key,requestId:request.id}});
 const service={prisma:db,clientScopes:{requireClientAccess:vi.fn()},readOzonFbsPickPosting:vi.fn(async()=>({posting_number:key,status:'awaiting_deliver',
  products:units.map((u,n)=>({sku:u.productId,offer_id:'offer'+n,quantity:1}))}))};
 return {client,request,task,units,service,input:{taskId:task.id,operationKey:key,reason:'Confirmed physical packing',units},
  user:{id:actor.id,roleCodes:['OWNER'],activeWarehouseId:wh.id}};
}
it.skipIf(!enabled)('rolls back first mark and item repair when second mark conflicts',async()=>{
 const f=await fixture();
 await db.productMark.create({data:{clientId:f.client.id,skuId:f.units[0].skuId,value:f.units[1].kiz,status:'AVAILABLE'}});
 await expect(recoverOzonMarkedPacking(f.service,f.input,f.user)).rejects.toThrow('КИЗ относится к другому товару');
 expect(await db.productMark.count({where:{clientId:f.client.id}})).toBe(1);
 expect(await db.$queryRaw`SELECT "assemblyId" FROM "OzonFbsPickState" WHERE "assemblyId"=${f.task.id}`).toEqual([]);
 expect(await db.kizReviewCase.count({where:{clientId:f.client.id}})).toBe(0);
 const items=await db.clientRequestItem.findMany({where:{requestId:f.request.id}});
 expect(items).toHaveLength(1);expect(items[0].quantity).toBe(2);
 expect((await db.clientRequest.findUniqueOrThrow({where:{id:f.request.id}})).status).toBe('SUBMITTED');
},30000);
it.skipIf(!enabled)('persists both units once without stock debit or shipment',async()=>{
 const f=await fixture();
 expect(await recoverOzonMarkedPacking(f.service,f.input,f.user)).toMatchObject({status:'APPLIED',units:2});
 expect(await recoverOzonMarkedPacking(f.service,f.input,f.user)).toMatchObject({status:'ALREADY_APPLIED'});
 expect(await db.productMark.count({where:{clientId:f.client.id}})).toBe(2);
 expect(await db.kizReviewCase.count({where:{clientId:f.client.id,status:'CLAIMED'}})).toBe(2);
 expect(await db.stockMovement.count({where:{clientId:f.client.id}})).toBe(0);
 expect(await db.shippedKizHistory.count({where:{clientId:f.client.id}})).toBe(0);
 expect((await db.stockBalance.aggregate({where:{clientId:f.client.id},_sum:{quantity:true}}))._sum.quantity).toBe(20);
 expect((await db.clientRequest.findUniqueOrThrow({where:{id:f.request.id}})).status).toBe('PACKED');
 expect(await db.clientRequestEvent.count({where:{requestId:f.request.id}})).toBe(1);
 // TEST: real guards accept both claims, and history waits for explicit handover.
 await db.$transaction(async tx=>{
  const request=await tx.clientRequest.findUniqueOrThrow({where:{id:f.request.id}});
  await assertClientRequestKizShipment(tx,request,f.user);
  expect(await captureShippedKizHistory(tx,request.id)).toBe(0);
  const at=new Date();
  expect(await captureShippedKizHistory(tx,request.id,at)).toBe(2);
  expect(await captureShippedKizHistory(tx,request.id,at)).toBe(0);
  await finishClientRequestKizShipment(tx,request);
 });
 expect(await db.kizReviewCase.count({where:{clientId:f.client.id,status:'USED'}})).toBe(2);
 expect(await db.shippedKizHistory.count({where:{clientId:f.client.id}})).toBe(2);
},30000);
