// TEST: actual image modules, mocked persistence; no business writes.
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{performance}=require('node:perf_hooks');
const {TsdOperationLogService}=require('/app/apps/api/dist/modules/tsd/tsd-operation-log.service');
const timing=require('/app/apps/api/dist/common/diagnostics/operation-timing');
(async()=>{
 let cases=0,query;
 const service=new TsdOperationLogService({tsdOperation:{findUnique:async q=>{query=q;return {status:'ACCEPTED',serverMessage:'saved'};}}},{});
 process.env.WMS_COMPACT_OPERATION_RECEIPTS_ENABLED='true';
 const receipt=await service.findExisting('one');assert.deepEqual(query.select,{status:true,serverMessage:true,reviewReason:true,resolutionMessage:true});
 assert.equal(service.existingResult({operationKey:'one',operationType:'scan'},receipt).status,'ALREADY_APPLIED');cases++;
 process.env.WMS_COMPACT_OPERATION_RECEIPTS_ENABLED='false';await service.findExisting('one');assert.deepEqual(query,{where:{operationKey:'one'}});cases++;
 const reports=[];const run=n=>timing.operationTiming(n,()=>timing.measureOperation('database',async()=>{await new Promise(r=>setTimeout(r,3));return n;}),r=>reports.push(r));
 assert.deepEqual(await Promise.all([run('a'),run('b')]),['a','b']);assert.notEqual(reports[0].traceId,reports[1].traceId);assert(reports.every(r=>r.stages.database.count===1));cases++;
 assert.equal(await timing.operationTiming('safe',async()=>42,()=>{throw Error('sink');}),42);cases++;
 let emitted=0;const middleware=timing.timingMiddleware(()=>emitted++);process.env.WMS_OPERATION_TIMING_ENABLED='true';
 const res=Object.assign(new EventEmitter(),{statusCode:200,writableFinished:true});middleware({method:'GET',route:{path:'/safe/:id'}},res,()=>{});res.emit('finish');res.emit('close');assert.equal(emitted,1);cases++;
 process.env.WMS_OPERATION_TIMING_ENABLED='false';middleware({},new EventEmitter(),()=>{});assert.equal(emitted,1);cases++;
 let clock=0;const logs=[],sink=timing.boundedTimingSink(r=>logs.push(r),()=>clock);
 for(let i=0;i<100;i++)sink({failed:true,durationMs:1});assert.equal(logs.length,60);clock=60000;sink({failed:true,durationMs:1});assert.equal(logs.length,62);cases++;
 process.env.WMS_OPERATION_TIMING_ENABLED='true';const noLog=timing.timingMiddleware(()=>{});const start=performance.now();
 for(let i=0;i<10000;i++){const response=Object.assign(new EventEmitter(),{statusCode:200,writableFinished:true});noLog({method:'GET',route:{path:'/bench'}},response,()=>{});response.emit('finish');}
 const middlewareMicroseconds=(performance.now()-start)*1000/10000;
 console.log(JSON.stringify({passed:true,cases,noBusinessWrites:true,middlewareMicroseconds,benchmark:'synthetic middleware, not real scan latency'}));
})().catch(e=>{console.error(e);process.exitCode=1});
