// TEST: read-only saved list through the exact controller with no marketplace call.
const assert=require('node:assert/strict'),path=require('path');
const root=path.resolve(process.argv[2]),ids=process.argv[3].split(',');
const {PrismaClient}=require('@prisma/client');
const {MarketplaceConnectionsService:S}=require(root+'/modules/marketplace-connections/marketplace-connections.service.js');
const {MarketplaceConnectionsController:C}=require(root+'/modules/marketplace-connections/marketplace-connections.controller.js');
const db=new PrismaClient();
(async()=>{await db.$transaction(async tx=>{
 await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
 const link=await tx.fbsOrderRequestLink.findFirstOrThrow({where:{orderId:ids[0]}});
 const service=Object.create(S.prototype);service.prisma=tx;
 const response=await service.loadFbsTsdRequestOrders(link.clientId,undefined,undefined,true);
 const selected={...response,orders:response.orders.filter(o=>ids.includes(o.id))};assert.equal(selected.orders.length,ids.length);
 service.listFbsOrdersForDisplay=async()=>selected;
 service.listFbsOrders=async()=>{throw Error('Live marketplace call forbidden')};
 const controller=Object.create(C.prototype);controller.connections=service;
 const result=await controller.listFbsOrders({},link.clientId,undefined,'snapshot');
 for(const order of result.orders)assert.equal(order.reservation?.status,'FABRIC_ON_DEMAND');
 console.log(JSON.stringify({savedOrders:result.orders.length,allCutOnDemand:true,readOnly:true,marketplaceCalls:0}));
 },{timeout:30000});})().finally(()=>db.$disconnect()).catch(e=>{console.error(e.message);process.exitCode=1});
