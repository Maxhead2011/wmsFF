// TEST: real candidate synchronizer and concurrent transactions, disposable DB only.
require('reflect-metadata');const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
assert.equal(new URL(process.env.DATABASE_URL).hostname,'wb-packed-auto-done-test-pg');
const {PrismaClient}=require('@prisma/client'),p=new PrismaClient(),root='/app/apps/api/dist/';
const {MarketplaceConnectionsService}=require(root+'modules/marketplace-connections/marketplace-connections.service');
const {closeWbPackedRequest}=require(root+'modules/marketplace-connections/wb-packed-auto-done');
(async()=>{
 const c=await p.client.create({data:{code:'TEST',name:'Synthetic'}}),w=await p.warehouse.create({data:{code:'TEST',name:'Synthetic'}});
 const sku=await p.sku.create({data:{clientId:c.id,internalSku:'TEST',name:'Synthetic'}});
 await p.stockBalance.create({data:{balanceKey:randomUUID(),clientId:c.id,warehouseId:w.id,skuId:sku.id,quantity:7,status:'AVAILABLE'}});
 const seed=async()=>{const id=randomUUID();await p.clientRequest.create({data:{id,clientId:c.id,warehouseId:w.id,type:'OUTBOUND',status:'PACKED',title:'Synthetic',items:{create:{skuId:sku.id,quantity:1}},fbsOrderLinks:{create:{clientId:c.id,marketplace:'WILDBERRIES',connectionId:'test',orderId:id}}}});return id};
 const svc=Object.create(MarketplaceConnectionsService.prototype);svc.prisma=p;
 const id=await seed(),order={id,connectionId:'test',marketplace:'WILDBERRIES',supplierStatus:'complete',wbStatus:'sorted'};
 const run=()=>svc.syncOneFbsRequest(c.id,id,new Map([['test:'+id,order]]),[]);
 const outcomes=await Promise.all([run(),run()]);assert.equal(outcomes.filter(x=>x.changed).length,1);
 assert.equal((await p.clientRequest.findUniqueOrThrow({where:{id}})).status,'DONE');
 assert.equal(await p.clientRequestEvent.count({where:{requestId:id,eventType:'STATUS_CHANGED'}}),1);
 assert.equal((await run()).changed,false);
 const second=await seed(),r=await p.clientRequest.findUniqueOrThrow({where:{id:second},include:{fbsOrderLinks:true}});
 const secondOrder={...order,id:second};
 const broken=p.$extends({query:{clientRequestEvent:{create(){throw Error('synthetic event failure')}}}});
 await assert.rejects(()=>broken.$transaction(tx=>closeWbPackedRequest(tx,r,[secondOrder],false)),/synthetic event failure/);
 assert.equal((await p.clientRequest.findUniqueOrThrow({where:{id:second}})).status,'PACKED');
 assert.equal(await p.clientRequestEvent.count({where:{requestId:second}}),0);
 assert.equal(await p.stockMovement.count(),0);assert.equal((await p.stockBalance.findFirst()).quantity,7);
 process.env.WMS_WB_PACKED_AUTO_DONE_ENABLED='false';assert.equal(await closeWbPackedRequest(p,r,[secondOrder],false),false);
 assert.equal((await p.clientRequest.findUniqueOrThrow({where:{id:second}})).status,'PACKED');
 console.log(JSON.stringify({passed:8,concurrency:true,rollback:true,stockUnchanged:true,flagIsolation:true}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());
