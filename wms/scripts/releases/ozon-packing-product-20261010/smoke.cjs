// TEST: inspect an actual Ozon plan inside a read-only transaction.
require('reflect-metadata');const assert=require('node:assert/strict'),{PrismaClient}=require('@prisma/client');
// The capability is independent of route allocation; omit those locking reads in this read-only proof.
require('/app/apps/api/dist/modules/tsd/fbo-fbs-reservations').loadFboFbsAvailability=async()=>({free:()=>0,take:()=>{}});
require('/app/apps/api/dist/modules/tsd/fbo-request-route').loadFboRoutePreference=async()=>null;
const {FboTwoStageService:S}=require('/app/apps/api/dist/modules/tsd/fbo-two-stage.service');const db=new PrismaClient();
(async()=>{const proof=await db.$transaction(async tx=>{
 await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
 assert.equal(process.env.WMS_FBO_PARALLEL_PACKING_ENABLED,'true');
 const r=await tx.clientRequest.findFirst({where:{ozonShipment:{isNot:null},fboAssembly:{is:{phase:{in:['PICKING','PACKING']},units:{some:{state:'PICKED'}}}}},include:{client:true,items:{include:{sku:true}}}});
 if(!r)return {passed:true,readOnly:true,activePartialOzon:false};
 const snapshotDb=new Proxy(tx,{get(target,key){if(key==='box')return {findMany:async()=>[]};return target[key];}});
 const s=new S(snapshotDb,{},{});s.busyBoxes=async()=>new Set();const p=await s.snapshot(snapshotDb,r);
 assert.equal(p.marketplace,'OZON');assert.equal(p.packingByProductSupported,true);assert.ok(Array.isArray(p.packingSuggestions));assert.ok(p.picked>0);
 return {passed:true,readOnly:true,routeExcluded:true,request:r.number,picked:p.picked,packed:p.packed,needed:p.needed,phase:p.phase,packingByProductSupported:p.packingByProductSupported,suggestions:p.packingSuggestions.length};
},{timeout:60000});console.log(JSON.stringify(proof));})().finally(()=>db.$disconnect()).catch(e=>{console.error(e.message);process.exitCode=1});
