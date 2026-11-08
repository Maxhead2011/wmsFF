// TEST: exact candidate, real saved PDF, synthetic queue, no network or production writes.
const assert=require('node:assert/strict'),fs=require('fs');require('reflect-metadata');
const root=process.argv[2],out=process.argv[3];
const {PrintSeriesService:S}=require(root+'/modules/print/print-series.service');
const {PrintSeriesController:C}=require(root+'/modules/print/print-series.controller');
const {ClientScopeService}=require(root+'/modules/auth/client-scope.service');
global.fetch=()=>{throw Error('Network forbidden')};
(async()=>{
 process.env.WMS_PRINT_SERIES_ENABLED='true';let passed=0,writes=0;const jobs=new Map();
 const db={warehouseClient:{findFirst:async()=>({})},fbsPrintStation:{findFirst:async()=>({id:'s',labelWidthMm:58,labelHeightMm:40})},
 systemSetting:{findUnique:async()=>({value:{userId:'u',warehouseId:'w',seenAt:Date.now()}})},printJob:{findUnique:async({where})=>jobs.get(where.id),create:async({data})=>{writes++;jobs.set(data.id,data);return data}}};
 const user={id:'u',activeWarehouseId:'w',permissionCodes:['print:write'],roleCodes:['OPERATOR'],clientScopeMode:'LIMITED',clientIds:['c']};
 const svc=new S(db,new ClientScopeService());
 const body={requestId:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',stationId:'s',clientId:'c',fileBase64:fs.readFileSync('/tmp/wb-ribbon-2818.pdf').toString('base64')};
 assert.equal(Reflect.getMetadata('path',C.prototype.createPdf),'pdf-jobs');passed++;
 const start=Date.now(),result=await svc.createPdf(body,user);assert.equal(result.pages,5);assert.equal(writes,1);passed++;
 const milliseconds=Date.now()-start;
 await svc.createPdf(body,user);assert.equal(writes,1);passed++;
 await assert.rejects(svc.createPdf({...body,clientId:'foreign'},user));assert.equal(writes,1);passed++;
 await assert.rejects(svc.createPdf(body,{...user,activeWarehouseId:'other'}));assert.equal(writes,1);passed++;
 delete process.env.WMS_PRINT_SERIES_ENABLED;await assert.rejects(svc.createPdf(body,user));passed++;
 const pages=[...jobs.values()][0].payload.pages;assert.deepEqual(pages.map(p=>p.value),['WB_1','WB_2','WB_3','WB_4','WB_5']);
 for(let i=0;i<pages.length;i++)fs.writeFileSync(out+'/label-'+(i+1)+'.png',Buffer.from(pages[i].imageBase64,'base64'));
 fs.writeFileSync(out+'/runtime-api-proof.json',JSON.stringify({passed,renderMs:milliseconds,pages:5,syntheticQueue:true,noNetwork:true}));console.log({passed,renderMs:milliseconds});
})().catch(e=>{console.error(e);process.exitCode=1;});
