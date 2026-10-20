require('reflect-metadata');
const assert=require('assert/strict'),{PrismaClient}=require('@prisma/client');
const {readPantheraFavorites,savePantheraFavorites}=require('/app/apps/api/dist/modules/auth/panthera-favorites');
const {AuthController}=require('/app/apps/api/dist/modules/auth/auth.controller');
// TEST: real PostgreSQL race on a disposable database, never the application database.
(async()=>{
 assert.equal(process.env.FAVORITES_DISPOSABLE_TEST,'yes');
 assert.equal(Reflect.getMetadata('path',AuthController.prototype.readPantheraFavorites),'me/panthera-favorites');
 assert.equal(Reflect.getMetadata('path',AuthController.prototype.savePantheraFavorites),'me/panthera-favorites');
 const p=new PrismaClient();try{
 await p.$executeRawUnsafe('CREATE TABLE "SystemSetting" ("key" text PRIMARY KEY,"value" jsonb NOT NULL,"updatedByUserId" text,"createdAt" timestamp NOT NULL DEFAULT now(),"updatedAt" timestamp NOT NULL DEFAULT now())');
 const outcomes=await Promise.allSettled([
  savePantheraFavorites(p,'alice',{ids:['fbs'],revision:0}),
  savePantheraFavorites(p,'alice',{ids:['warehouse'],revision:0}),
 ]);
 assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);
 assert.equal(outcomes.filter(o=>o.status==='rejected'&&o.reason.getStatus()===409).length,1);
 assert.deepEqual(await readPantheraFavorites(p,'bob'),{ids:null,revision:0});
 await savePantheraFavorites(p,'alice',{ids:[],revision:1});
 assert.deepEqual(await readPantheraFavorites(p,'alice'),{ids:[],revision:2});
 console.log(JSON.stringify({passed:true,concurrentWinnerCount:1,isolatedUsers:true,emptyList:true,routeMetadata:true}));
 }finally{await p.$disconnect()}
})().catch(e=>{console.error(e);process.exitCode=1});
