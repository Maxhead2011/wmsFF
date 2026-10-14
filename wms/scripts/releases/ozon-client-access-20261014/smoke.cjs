// TEST: actual candidate module, real customer scopes, read-only production transaction.
require('reflect-metadata');const assert=require('assert/strict'),{PrismaClient}=require('@prisma/client');const db=new PrismaClient(),base='/app/apps/api/dist/modules/';
const {ClientScopeService}=require(base+'auth/client-scope.service'),{OzonFboImportService}=require(base+'client-requests/ozon-fbo-import.service'),{OzonLinkImportService}=require(base+'client-requests/ozon-link-import.service');
(async()=>{try{await db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
const row=await tx.user.findUniqueOrThrow({where:{id:'4fe810c2-cfee-4e33-89ad-2d3fff43fae7'},select:{id:true,activeWarehouseId:true,roles:{select:{role:{select:{code:true}}}},clientScopes:true}});
const user={id:row.id,activeWarehouseId:row.activeWarehouseId,roleCodes:row.roles.map(r=>r.role.code),permissionCodes:['client-requests:write'],clientScopeMode:'LIMITED',clientIds:row.clientScopes.filter(s=>s.canRead).map(s=>s.clientId),writableClientIds:row.clientScopes.filter(s=>s.canWrite).map(s=>s.clientId)};
const scope=new ClientScopeService(),importer=new OzonFboImportService(tx,scope),service=new OzonLinkImportService(tx,scope,importer,{});
const expected={'bda8be6b-3328-4cae-a18a-ac0d16dd4301':'2704545','d12fa230-3bd1-4aff-afc3-98771ce89669':'3308562'};
for(const [id,seller]of Object.entries(expected)){const rows=await service.connections(id,user);assert(rows.some(c=>c.sellerId===seller));assert(rows.every(c=>!('apiKey'in c)));assert.equal(await importer.resolveWarehouse(id,user,'write'),'afb244a1-50ae-4ae6-9111-afe85949fa58');}
await assert.rejects(()=>service.connections('foreign',user));await assert.rejects(()=>service.connections(Object.keys(expected)[0],{...user,writableClientIds:[]}));
await assert.rejects(()=>importer.resolveWarehouse(Object.keys(expected)[0],user,'write','foreign'));
console.log(JSON.stringify({passed:true,readOnly:true,managedClients:2,foreignDenied:true,noBusinessWrites:true}));},{timeout:20000});}finally{await db.$disconnect();}})().catch(e=>{console.error(e);process.exitCode=1});
