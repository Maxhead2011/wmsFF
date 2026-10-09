require('reflect-metadata');const assert=require('assert/strict'),{PrismaClient}=require('@prisma/client');const db=new PrismaClient();
const{OzonAssemblySupplyService}=require('/app/apps/api/dist/modules/client-requests/ozon-assembly-supply.service');
const{mergeSupplyOrders,supplyOrders,supplyDifferences}=require('/app/apps/api/dist/modules/client-requests/ozon-supply-policy');
(async()=>{
 const c=await db.clientMarketplaceConnection.findFirstOrThrow({where:{clientId:'c401202c-be57-4310-9939-2ea36767da37',marketplace:'OZON',isActive:true}});
 const service=new OzonAssemblySupplyService(db,{requireClientAccess(){}}),orders=[];
 for(const id of ['133456539','133455507','133455289','133455152'])orders.push(await service.snapshot(c,id));
 const shipment=await db.ozonFboShipment.findUniqueOrThrow({where:{requestId:'13b326b1-ed5c-44c3-9ecc-09e1b65d90fb'}});
 const link=mergeSupplyOrders(orders[0],orders.flatMap(supplyOrders));
 for(const d of shipment.directions){const matches=link.supplies.filter(s=>s.name===d.name);assert.equal(matches.length,1);link.mapping[d.name]=matches[0].id;}
 assert.deepEqual(supplyDifferences(shipment.directions,link),[]);
 const quantity=link.supplies.reduce((n,s)=>n+s.items.reduce((n,i)=>n+i.quantity,0),0);assert.equal(quantity,393);assert.equal(link.supplies.length,11);
 console.log(JSON.stringify({passed:true,readOnly:true,request:1861,orders:4,directions:11,quantity,barcodeDifferences:0}));
})().finally(()=>db.$disconnect()).catch(e=>{console.error(e.message);process.exitCode=1});
