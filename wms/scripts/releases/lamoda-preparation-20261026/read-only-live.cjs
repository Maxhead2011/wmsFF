// TEST: read-only production smoke; no accounts, credentials or stock records are created.
require('reflect-metadata');const assert=require('node:assert/strict'),{PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{assert.equal(process.env.WMS_LAMODA_ENABLED,'true');assert.equal(Buffer.from(process.env.WMS_LAMODA_SECRET_KEY||'','base64').length,32);
 const dir='/app/apps/api/dist/';const {LamodaService}=require(dir+'modules/lamoda/lamoda.service');const {ClientScopeService}=require(dir+'modules/auth/client-scope.service');const service=new LamodaService(p,new ClientScopeService(),{});
 const client=await p.client.findFirst({where:{isDemo:false},select:{id:true}});assert(client);const accounts=await service.accounts(client.id,{permissionCodes:['system:admin'],roleCodes:['OWNER'],clientScopeMode:'ALL'});assert(Array.isArray(accounts));
 for(const model of ['lamodaAccount','lamodaProduct','lamodaPlan','lamodaDocument','lamodaExchange'])await p[model].count();
 console.log(JSON.stringify({noBusinessWrites:true,enabled:true,tables:5}));
})().finally(()=>p.$disconnect()).catch(e=>{console.error(e.message);process.exitCode=1});
