require('reflect-metadata');const assert=require('node:assert/strict');
const {PrismaService}=require('/app/apps/api/dist/common/prisma/prisma.service');
const {ClientRequestsService}=require('/app/apps/api/dist/modules/client-requests/client-requests.service');
const db=new PrismaService();
// TEST: execute real query shapes read-only; never create a customer request or stock movement.
(async()=>{
 const box=await db.box.findFirst({where:{code:{startsWith:'FFL_LKB0610'},status:'active',storagePlacement:{is:null},balances:{some:{status:'AVAILABLE',quantity:{gt:0}}}},include:{balances:{where:{status:'AVAILABLE',quantity:{gt:0}}},client:true}});
 assert.ok(box,'No recent receipt box found for smoke');assert.equal(box.client.stockBalanceMode,'PALLET_SORT');
 const svc=new ClientRequestsService(db,{requireClientAccess:()=>{}},{});
 const skuIds=[...new Set(box.balances.map(x=>x.skuId))];const pending=await svc.pendingPlacementBySkuId(box.clientId,skuIds,box.warehouseId);
 assert.ok([...pending.values()].some(x=>x>0),'Fresh receipt not recognised');
 console.log(JSON.stringify({readOnly:true,receiptPrefix:'FFL_LKB0610',checkedSkuCount:skuIds.length,pendingQuantity:[...pending.values()].reduce((s,n)=>s+n,0)}));
})().finally(()=>db.$disconnect()).catch(e=>{console.error(e.message);process.exitCode=1;});
