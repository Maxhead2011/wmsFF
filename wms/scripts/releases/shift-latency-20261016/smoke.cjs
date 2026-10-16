const assert=require('assert/strict'),path=require('path');
const modulePath=process.argv[2]||'/app/apps/api/dist/common/diagnostics/operation-timing.js';
const originalInterval=global.setInterval,originalInfo=console.info;let timer=null,unref=false;const logs=[];
global.setInterval=(fn,delay)=>{assert.equal(delay,60000);timer=fn;return{unref(){unref=true;}};};
delete process.env.WMS_OPERATION_HISTOGRAM_ENABLED;require(modulePath);assert.equal(timer,null);
delete require.cache[require.resolve(modulePath)];process.env.WMS_OPERATION_HISTOGRAM_ENABLED='true';
const m=require(modulePath);assert(timer&&unref);console.info=record=>logs.push(JSON.parse(record));
(async()=>{try{
 for(let i=0;i<1000;i++)assert.equal(await m.operationTiming('POST /scan',async()=>42),42);
 timer();const summary=logs.find(r=>r.event==='wms_operation_histogram');assert.equal(summary.rows[0].count,1000);assert(!JSON.stringify(summary).includes('traceId'));
 assert(logs.filter(r=>r.event==='wms_operation').length<1000);
 console.info=originalInfo;console.log(JSON.stringify({passed:4,allResponses:1000,disabledByDefault:true,unref:true}));
}finally{console.info=originalInfo;global.setInterval=originalInterval;}})().catch(e=>{console.error(e);process.exitCode=1;});
