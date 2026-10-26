// TEST: read-only check in the published container; no settings, stocks or links are changed.
require('reflect-metadata');
const assert=require('node:assert/strict');
const {PrismaClient}=require('@prisma/client');
const {MultishopStockGroupsService}=require('./dist/modules/marketplace-connections/multishop-stock-groups.service');
const {ClientScopeService}=require('./dist/modules/auth/client-scope.service');
(async()=>{
 const db=new PrismaClient();
 try {
  const service=new MultishopStockGroupsService(db,new ClientScopeService());
  assert.deepEqual(service.capabilities(),{enabled:true,publicationEnabled:false});
  const connection=await db.clientMarketplaceConnection.findFirst({where:{isActive:true,marketplace:{in:['WILDBERRIES','OZON']}},select:{clientId:true}});
  assert(connection);
  const user={id:'read-only-release-check',roleCodes:['ADMIN'],permissionCodes:['system:admin'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[]};
  const result=await service.read(connection.clientId,user);
  assert(Array.isArray(result.connections)&&Array.isArray(result.config.groups));
  const products=await service.products(connection.clientId,'',1,user);assert(products.items.length<=50);
  assert(result.connections.every(c=>!Object.hasOwn(c,'apiKey')&&!Object.hasOwn(c,'sellerId')));
  console.log(JSON.stringify({enabled:true,publicationEnabled:false,clientRead:true,productRead:true,credentialsExcluded:true,mutations:0}));
 } finally {await db.$disconnect();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
