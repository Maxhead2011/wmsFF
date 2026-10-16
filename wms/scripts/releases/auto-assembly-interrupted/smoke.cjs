// TEST: actual compiled recovery, no external network or production database writes.
const assert=require('node:assert/strict'),path=require('node:path');
const root=process.env.RUNTIME_ROOT||'/app/apps/api/dist';
const recovery=require(path.join(root,'modules/marketplace-connections/auto-assembly-recovery.js'));
process.env.WMS_AUTO_ASSEMBLY_ENABLED='true';process.env.WMS_AUTO_ASSEMBLY_RECOVERY_ENABLED='true';process.env.WMS_AUTO_ASSEMBLY_DURABLE_ENABLED='true';
const conn={id:'conn',clientId:'client',marketplace:'WILDBERRIES',isActive:true,fbsExecutionWarehouseId:'warehouse'};
function fixture({supply='WB-GI-123',status='confirm',legacy=true,checkpoint,locked=true}={}){
 const request={id:'request',number:2082,clientId:'client',warehouseId:'warehouse',status:'SUBMITTED'};
 const runKey='fbs.autoAssembly.run.conn.slot';
 const data=new Map([[runKey,{status:'RUNNING',startedAt:'2026-10-15T12:00:45.571Z'}]]);
 const opkey='fbs.autoAssembly.operation.conn.request';
 if(!legacy)data.set(opkey,{requestId:'request',requestNumber:2082,clientId:'client',connectionId:'conn',actor:'actor',runKey,orderIds:['1','2'],groups:[],stage:'REQUEST_CREATED'});
 if(checkpoint)data.set('fbs.autoAssembly.recovery.conn.request',checkpoint);
 const links=['1','2'].map(orderId=>({orderId,requestId:'request',sellerWarehouseId:'1693195',lastSupplyId:supply}));
 const tasks=links.map(l=>({...l,status:'RESERVED',supplyId:supply}));
 const writes=[],httpCalls=[];
 const db={
  systemSetting:{findMany:async q=>[...data].filter(([k])=>k.startsWith(q.where.key.startsWith)).map(([key,value])=>({key,value})),
   findUnique:async q=>data.has(q.where.key)?{key:q.where.key,value:data.get(q.where.key)}:null,
   upsert:async q=>{data.set(q.where.key,structuredClone(q.update.value));writes.push(q.where.key);},
   update:async q=>{data.set(q.where.key,structuredClone(q.data.value));}},
  clientMarketplaceConnection:{findUniqueOrThrow:async()=>conn},
  clientRequestEvent:{findMany:async()=>legacy?[{requestId:'request',request}]:[]},
  clientRequest:{findUnique:async()=>request,findUniqueOrThrow:async()=>request},
  fbsOrderRequestLink:{findMany:async q=>links.filter(l=>!q.where.orderId||q.where.orderId.in.includes(l.orderId)),updateMany:async()=>({count:2})},
  fbsTsdAssembly:{findMany:async()=>tasks,updateMany:async()=>({count:2})},
  fbsWarehouseRoutingRule:{findFirst:async()=>({mode:'CENTRAL'})},
  clientFbsBillingSettings:{findUnique:async()=>({defaultDeliveryDestination:'SORTING_CENTER'})},
  fbsSupplyPlan:{findUnique:async()=>null,upsert:async()=>{}},auditLog:{create:async()=>{}},
  $queryRaw:async()=>[{locked}],$transaction:async action=>action(db),
 };
 let members=supply?['1','2']:[];
 const http=async(url,method='GET',body)=>{
  httpCalls.push({url,method,body});
  if(url==='/api/v3/orders/status')return {orders:['1','2'].map(id=>({id,supplierStatus:status,wbStatus:'waiting'}))};
  if(url.startsWith('/api/v3/supplies?'))return {supplies:[],next:0};
  if(url==='/api/v3/orders/new')return {orders:['1','2'].map(id=>({id,warehouseId:1693195,cargoType:1,crossBorderType:0}))};
  if(url.endsWith('/order-ids'))return {orderIds:members};
  if(url==='/api/v3/supplies'&&method==='POST')return {id:'WB-GI-999'};
  if(url.endsWith('/orders')&&method==='PATCH'){members=body.orders.map(String);return {};}
  if(url.startsWith('/api/v3/supplies/WB-GI-'))return {id:url.split('/').pop(),done:false};
  throw Error('Unexpected request '+method+' '+url);
 };
 return {db,http,httpCalls,data,writes,links,tasks,request,opkey,runKey};
}
async function main(){
 let passed=0;let f=fixture();
 const originalFetch=global.fetch;
 global.fetch=async(url,options={})=>{const result=await f.http(url.replace('https://marketplace-api.wildberries.ru',''),options.method,options.body?JSON.parse(options.body):undefined);return {ok:true,text:async()=>JSON.stringify(result)};};
 try{
  // TEST: exact 2082 failure: stale RUNNING contains no groups. Old code returns [].
  const result=await recovery.recoverFailedAutoAssemblies(f.db,'conn','actor',{allWarehouses:true});
  assert.equal(result.length,1,'Interrupted RUNNING request must be discovered');
  assert.equal(result[0].stage,'VERIFIED');assert.equal(f.data.get(f.runKey).status,'DONE');
  assert.equal(f.httpCalls.filter(c=>['PATCH','DELETE'].includes(c.method)||c.url==='/api/v3/supplies').length,0);passed++;
  const durable=require(path.join(root,'modules/marketplace-connections/auto-assembly-durable.js'));
  f=fixture({legacy:false,supply:null,status:'new'});
  const out=await durable.recoverInterrupted(f.db,conn,'actor',{allWarehouses:true},recovery.recoverAutoAssemblyRequest,f.http);
  assert.equal(out[0].stage,'VERIFIED');assert.equal(f.httpCalls.filter(c=>c.url==='/api/v3/supplies').length,1);passed++;
  f=fixture({legacy:false,supply:null,status:'new',checkpoint:{stage:'CREATE_PENDING',name:'unique'}});
  const ambiguous=await durable.recoverInterrupted(f.db,conn,'actor',{allWarehouses:true},recovery.recoverAutoAssemblyRequest,f.http);
  assert.ok(ambiguous[0].error);assert.equal(f.httpCalls.filter(c=>c.url==='/api/v3/supplies').length,0);passed++;
  f=fixture({locked:false});let ran=false;
  await durable.withRun(f.db,'conn',async()=>{ran=true;});assert.equal(ran,false);passed++;
  f=fixture({legacy:false});f.db.fbsWarehouseRoutingRule.findFirst=async()=>({mode:'EXCLUDED'});
  const excluded=await durable.recoverInterrupted(f.db,conn,'actor',{allWarehouses:true},recovery.recoverAutoAssemblyRequest,f.http);
  assert.match(excluded[0].error,/Маршрутизация/);assert.equal(f.httpCalls.length,0);passed++;
  f=fixture({legacy:false,supply:'WB-GI-123',status:'new',checkpoint:{stage:'ASSIGN_PENDING',supplyId:'WB-GI-123'}});
  let patched=false;
  const partialHttp=async(u,m,b)=>{if(m==='PATCH')patched=true;return u.endsWith('/order-ids')?{orderIds:patched?['1','2']:['1']}:f.http(u,m,b);};
  const partial=await durable.recoverInterrupted(f.db,conn,'actor',{allWarehouses:true},recovery.recoverAutoAssemblyRequest,partialHttp);
  assert.equal(partial[0].stage,'VERIFIED');assert.equal(f.httpCalls.filter(c=>c.method==='PATCH').length,1);
  assert.deepEqual(f.httpCalls.find(c=>c.method==='PATCH').body.orders,[2]);passed++;
  f=fixture();await durable.withRun(f.db,'conn',async()=>{
   durable.setRunKey(f.runKey);
   await durable.requestCreated(f.db,f.request,'client',f.links.map(l=>({id:l.orderId,connectionId:'conn',marketplace:'WILDBERRIES'})),'actor');
   assert.equal(f.data.get(f.opkey).requestNumber,2082); // survives a crash before any WB call
   const handle=await durable.beginSupply(f.db,'conn',[{id:'1'},{id:'2'}],'old');
   assert.equal(f.data.get(handle.key).stage,'CREATE_PENDING');
   await durable.stage(f.db,handle,{stage:'SUPPLY_CREATED',supplyId:'WB-GI-123'});
   assert.equal(f.data.get(handle.key).supplyId,'WB-GI-123');
  });passed++;
  // TEST: load the actual service modules too, and exercise the scheduler's context hook.
  if(process.env.NODE_PATH){
   require('reflect-metadata');
   const Auto=require(path.join(root,'modules/administration/auto-assembly.service.js')).AutoAssemblyService;
   const Market=require(path.join(root,'modules/marketplace-connections/marketplace-connections.service.js')).MarketplaceConnectionsService;
   assert.equal(typeof Market.prototype.moveFbsOrdersToSupply,'function');
   f=fixture({legacy:false});f.data.clear();
   f.data.set('fbs.autoAssembly.config.conn',{enabled:true,allWarehouses:true,times:['09:00'],warehouseIds:[]});
   f.db.systemSetting.create=async q=>{f.data.set(q.data.key,q.data.value);};
   const service={prisma:f.db,connection:async()=>conn,marketplace:{runAutoAssembly:async()=>{
    await durable.requestCreated(f.db,f.request,'client',f.links.map(l=>({id:l.orderId,connectionId:'conn',marketplace:'WILDBERRIES'})),'actor');
    throw Error('failure after durable request');
   }}};
   const result=await Auto.prototype.run.call(service,'conn',{id:'actor'},'manual');
   assert.equal(result.status,'ERROR');assert.equal(f.data.get(f.opkey).requestNumber,2082);
   assert.ok(f.data.get(f.opkey).runKey.startsWith('fbs.autoAssembly.run.conn.'));passed++;
  }
  console.log(JSON.stringify({passed:true,tests:passed,network:'mocked',database:'mocked'}));
 }finally{global.fetch=originalFetch;}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
