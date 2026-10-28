// TEST: execute the exact patched agent and SKU controller; no database/printer connection.
const assert=require('node:assert/strict'),path=require('path'),Module=require('module');
const root=path.resolve(process.argv[2]);
const original=Module._load;Module._load=function(name,...args){if(name==='@prisma/client')return original.call(this,process.env.TEST_PRISMA_CLIENT||require.resolve('../../../apps/api/node_modules/@prisma/client'),...args);if(name.endsWith('/prisma.service'))return {PrismaService:class{}};return original.call(this,name,...args);};
const {PrintAgentService}=require(root+'/modules/print/print-agent.service.js');
const {SkusController}=require(root+'/modules/skus/skus.controller.js');
const {SkusService}=require(root+'/modules/skus/skus.service.js');
let passed=0,found=true,skuAvailable=true,queries=[],jobs=[];
const sku={id:'s',clientId:'c',name:'Костюм',marketplacePayload:null,barcodes:[{id:'w',value:'2000000000011',isPrimary:true}]};
const db={sku:{findFirst:async()=>skuAvailable?sku:null,findMany:async q=>{queries.push(q);return [sku]}},lamodaProduct:{
 findFirst:async q=>{assert.deepEqual(q.where,{skuId:'s',barcode:'04640684262439',isPresent:true,linkState:'CONFIRMED',account:{isActive:true,clientId:'c'}});return found?{id:'lm'}:null},
 findMany:async()=>[{id:'lm',skuId:'s',barcode:'04640684262439',account:{clientId:'c'}}]},
 fbsPrintStation:{findFirst:async()=>({id:'station'})},printJob:{create:async q=>{jobs.push(q);return{id:'job'}}}};
const scopes={resolveClientFilter:()=> 'c'},user={id:'u',permissionCodes:[],roleCodes:[],warehouseIds:[]};
const png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(709,16);png.writeUInt32BE(472,20);
const input={stationId:'station',skuId:'s',barcode:'04640684262439',copies:1,widthMm:60,heightMm:40,imageBase64:png.toString('base64')};
(async()=>{
 process.env.WMS_LAMODA_ENABLED='true';const service=new PrintAgentService(db,scopes);
 await service.createSkuJob(input,user);assert.equal(jobs[0].data.payload.barcode,input.barcode);passed++;
 found=false;await assert.rejects(()=>service.createSkuJob(input,user),/Штрихкод/);assert.equal(jobs.length,1);passed++;
 found=true;skuAvailable=false;await assert.rejects(()=>service.createSkuJob(input,user),/Штрихкод/);passed++;
 skuAvailable=true;process.env.WMS_LAMODA_ENABLED='false';await assert.rejects(()=>service.createSkuJob(input,user),/Штрихкод/);passed++;
 await service.createSkuJob({...input,barcode:sku.barcodes[0].value},user);assert.equal(jobs.length,2);passed++;
 process.env.WMS_LAMODA_ENABLED='true';const controller=new SkusController(new SkusService(db,scopes,{}));
 const rows=await controller.list(user,'c','LM','','true');assert.equal(rows[0].barcodes[1].source,'LAMODA');assert.equal(rows[0].barcodes[0].isPrimary,true);assert.equal(sku.barcodes.length,1);passed++;
 const plain=await controller.list(user,'c','LM');assert.equal(plain[0].barcodes.length,1);passed++;
 assert(queries[0].where.OR.some(p=>p.article)); // Preserve production article lookup, absent in stale source.
 assert.equal(queries[0].where.clientId,'c');passed++;
 console.log(JSON.stringify({passed,syntheticApi:true}));
})().catch(e=>{console.error(e);process.exitCode=1});
