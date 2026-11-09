// TEST: actual production schema in an isolated disposable database, WB mocked.
const assert=require('node:assert/strict');assert.equal(process.env.NODE_ENV,'test');assert.equal(new URL(process.env.DATABASE_URL).hostname,'wb-shipping-test-pg');
process.env.WMS_WB_SHIPPING_POINTS_ENABLED='true';
const {PrismaClient}=require('@prisma/client'),p=new PrismaClient();
const {MarketplaceConnectionsService}=require('./dist/modules/marketplace-connections/marketplace-connections.service');
(async()=>{
 const c=await p.client.create({data:{code:'SHIPPING_TEST',name:'Synthetic'}}),u=await p.user.create({data:{email:'shipping@test.invalid',passwordHash:'disabled',name:'Test'}});
 const conn=await p.clientMarketplaceConnection.create({data:{clientId:c.id,marketplace:'WILDBERRIES',apiKey:'SYNTHETIC'}});
 const plan=await p.fbsSupplyPlan.create({data:{clientId:c.id,connectionId:conn.id,supplyId:'WB-GI-QA',deliveryDestination:'PICKUP_POINT',orderIds:['1','2','3','4'],cargoPlaceIds:['box1'],cargoPlaceCount:1}});
 let ids=['box1'],posts=0;
 global.fetch=async(url,init)=>{let data={shippingPointId:42,shippingDt:'2099-11-09',shippingType:'selfShipping'};
  if(url.includes('shipping-points?'))data={shippingPoints:[{id:42,available:true,officeType:'pp',city:'Москва'}]};
  if(url.endsWith('/shipping-method'))data={results:[{supplyId:plan.supplyId,success:true}]};
  if(url.endsWith('/order-ids'))data={orders:[1,2,3,4]};
  if(url.endsWith('/trbx')){if(init.method==='POST'){posts++;await new Promise(r=>setTimeout(r,100));ids=['box1','box2'];}data={trbxes:ids.map(id=>({id}))};}
  return new Response(JSON.stringify(data),{status:200});
 };
 const host={prisma:p,clientScopes:{requireClientAccess(){}},refreshFbsOrdersCache:async()=>({}),resolveSelectedFbsOrders:async()=>({orders:[{connectionId:conn.id,id:'1',supplyId:plan.supplyId,marketplace:'WILDBERRIES',supplierStatus:'confirm'}]}),loadSelectedConnections:async()=>[conn]};
 const dto={clientId:c.id,orders:[{connectionId:conn.id,id:'1'}],shippingCity:'Москва',plannedDeliveryDate:'2099-11-09',shippingPointId:'42',cargoPlaceTotal:2};
 const run=mode=>MarketplaceConnectionsService.prototype.configureFbsShipping.call(host,dto,{id:u.id},mode);
 await run('save');await Promise.all([run('cargo'),run('cargo')]);
 assert.equal(posts,1);const actual=await p.fbsSupplyPlan.findUnique({where:{id:plan.id}});assert.deepEqual(actual.cargoPlaceIds,['box1','box2']);assert.equal(actual.cargoPlaceCount,2);
 assert.equal(actual.plannedDeliveryDate.toISOString().slice(0,10),'2099-11-09');assert.equal(actual.sentToWbAt,null);
 assert.equal(await p.stockBalance.count(),0);assert.equal(await p.wbOrderShipment.count(),0);
 assert.equal(await p.auditLog.count({where:{action:'WB_CARGO_CREATE_PENDING'}}),1);
 console.log(JSON.stringify({postgres:8,realSchema:true,concurrentCargoCreatedOnce:true,noStockWrites:true,noDelivery:true}));
})().finally(()=>p.$disconnect()).catch(e=>{console.error(e);process.exitCode=1});
