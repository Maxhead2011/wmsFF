// TEST: compiled transport retry and live request check, with no business writes.
const assert=require('node:assert/strict');
const {OzonAssemblySupplyService}=require('/app/apps/api/dist/modules/client-requests/ozon-assembly-supply.service');
const {PrismaClient}=require('@prisma/client');
(async()=>{
 const fetchOriginal=global.fetch,svc=new OzonAssemblySupplyService({},{});let calls=0;
 try{
  global.fetch=async()=>++calls===1?new Response('{"message":"limit"}',{status:429}):new Response('{"operation_id":"ok"}');
  assert.equal((await svc.call({},'/v1/cargoes/create',{},false)).operation_id,'ok');assert.equal(calls,2);
  calls=0;global.fetch=async()=>{calls++;throw Error('timeout');};
  await assert.rejects(svc.call({},'/v1/cargoes/create',{},false));assert.equal(calls,1);
  const user={};let saved=0;
  const link={connectionId:'c',orderId:'123',mapping:{X:'42'},supplies:[],operations:{'42':{state:'UNKNOWN',error:'Ozon: HTTP 429. limit'}}};
  svc.load=async()=>({integration:link,request:{clientId:'c'}});svc.connection=async()=>({});svc.locked=async(_id,_u,fn)=>fn({integration:link},{});svc.save=async()=>{saved++;};svc.view=async()=>({});
  svc.call=async()=>({supplies_cargoes:[{supply_id:42,transport_cargoes:[],cargoes_without_transport_cargoes:[]}]});
  await svc.status('r',user);assert.equal(link.operations['42'],undefined);assert.equal(saved,1);
 }finally{global.fetch=fetchOriginal;}
 const db=new PrismaClient();try{
  const s=await db.ozonFboShipment.findUniqueOrThrow({where:{requestId:'f07a4c72-8adc-4a9a-ac03-47cc840ee191'}});
  const ops=Object.values(s.integration.operations);assert.equal(ops.length,5);assert(ops.every(o=>o.state==='SUCCESS'));const ids=ops.flatMap(o=>o.cargoes.map(c=>c.cargoId));assert.equal(ids.length,9);assert.equal(new Set(ids).size,9);
  console.log(JSON.stringify({passed:true,runtimeCases:3,request2000:{confirmedDirections:5,cargoes:9}}));
 }finally{await db.$disconnect();}
})().catch(e=>{console.error(e);process.exitCode=1;});
