const assert=require('assert/strict');
const {OzonAssemblySupplyService}=require('/app/apps/api/dist/modules/client-requests/ozon-assembly-supply.service');
const service=new OzonAssemblySupplyService({},{});
const originalFetch=global.fetch,originalTimer=global.setTimeout;
(async()=>{
 let calls=0,delays=[];
 global.setTimeout=(fn,ms)=>{delays.push(ms);return originalTimer(fn,0)};
 global.fetch=async()=>++calls===1?new Response('{"message":"limit"}',{status:429}):new Response('{"operation_id":"labels"}');
 assert.deepEqual(await service.call({},'/v1/cargoes-label/create',{},false),{operation_id:'labels'});assert.equal(calls,2);assert.equal(delays[0],1500);
 calls=0;global.fetch=async()=>{calls++;throw Error('transport');};await assert.rejects(service.call({},'/v1/cargoes-label/create',{},false));assert.equal(calls,1);
 calls=0;global.fetch=async()=>{calls++;return new Response('{"message":"internal"}',{status:500});};await assert.rejects(service.call({},'/v1/cargoes-label/create',{},false));assert.equal(calls,1);
 calls=0;global.fetch=async()=>{calls++;return new Response('{"message":"limit"}',{status:429,headers:{'retry-after':'30'}})};await assert.rejects(service.call({},'/v1/cargoes-label/create',{},false));assert.equal(calls,1);
 console.log(JSON.stringify({passed:4}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{global.fetch=originalFetch;global.setTimeout=originalTimer});
