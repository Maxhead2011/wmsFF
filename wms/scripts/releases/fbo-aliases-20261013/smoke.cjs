// TEST: actual runtime, both packing paths and a read-only request2000 plan.
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
require('reflect-metadata');
require('@nestjs/common').Logger.overrideLogger(false);
const {FboTwoStageService}=require('/app/apps/api/dist/modules/tsd/fbo-two-stage.service');
const {ClientScopeService}=require('/app/apps/api/dist/modules/auth/client-scope.service');
const {PrismaClient}=require('@prisma/client');
const db=new PrismaClient();
(async()=>{
 const saved={...process.env};let cases=0;
 for(const ozon of [false,true])for(const barcode of ['4610389218703','4630584392961','wrong']){
  process.env.WMS_FBO_TWO_STAGE_ENABLED='true';process.env.WMS_FBO_PACKING_READS_ENABLED='true';process.env.WMS_OZON_FBO_IMPORT_ENABLED=String(ozon);process.env.WMS_FBO_FAST_ACK_ENABLED='false';
  const item={id:'i',skuId:'greta54',barcode:'4630584392961',quantity:1,sku:{barcodes:[{value:'4610389218703'},{value:'4630584392961'}]}};
  const unit={id:'u',requestItemId:'i',skuId:'greta54',barcode:item.barcode,state:'PICKED',wholeBox:false,markId:null};let moved=false;
  const tx={$queryRaw:async()=>[],ozonFboShipment:{findUnique:async()=>ozon?{directions:[{name:'D',items:[{skuId:'greta54',barcode:item.barcode,quantity:1}]}]}:null},fboAssemblyAction:{findUnique:async()=>null},fboAssembly:{findUnique:async()=>({phase:'PACKING',compositionHash:createHash('sha256').update(JSON.stringify([['i','greta54',item.barcode,1]])).digest('hex')})},fboAssemblyUnit:{count:async()=>1,findMany:async q=>{
   if(!ozon){assert.equal(q.where.requestId,'r');assert.equal(q.where.state,'PICKED');assert.deepEqual(q.where.OR[1],{skuId:{in:barcode==='wrong'?[]:['greta54']}});return barcode==='wrong'?[]:[unit];}return [unit];
  }},fboAssemblyBox:{findMany:async()=>[{boxId:'target',direction:'D'}],findUnique:async()=>({requestId:'r',direction:'D',closedAt:null,wholeBox:false})},box:{findUniqueOrThrow:async()=>({id:'holding'})}};
  const s=new FboTwoStageService({$transaction:async fn=>fn(tx)},null,null,null,{assertStockMovementsAllowed:async()=>{}},null);
  s.load=async()=>({id:'r',status:'IN_WORK',items:[item],client:{}});s.requireFbo=()=>{};s.box=async()=>({id:'target'});s.move=async()=>{moved=true;throw Error('STOCK_BOUNDARY')};
  let error;try{await s.act('r',{action:'PACK_UNIT',operationId:'op',barcode,targetBoxCode:'target'},{id:'worker'});}catch(e){error=e;}
  assert(error);assert.equal(moved,barcode!=='wrong',error.message);if(moved)assert.equal(error.message,'STOCK_BOUNDARY');cases++;
 }
 for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);
 const request=await db.clientRequest.findFirstOrThrow({where:{number:2000}});
 const readDb=new Proxy(db,{get(t,n){if(n==='$transaction')return async(fn,options)=>{const rollback=Error('readonly');let result;try{await db.$transaction(async tx=>{result=await fn(tx);throw rollback},options)}catch(e){if(e!==rollback)throw e}return result};const v=t[n];return typeof v==='function'?v.bind(t):v}});
 const user={id:'b045e060-dfd7-48af-bb88-12c191ee8eae',permissionCodes:['system:admin'],roleCodes:[],activeWarehouseId:request.warehouseId};
 const s=new FboTwoStageService(readDb,new ClientScopeService(),null,null,null,null);const plan=await s.plan(request.id,user);
 const greta=plan.lines.find(l=>l.skuId==='1e30ddb9-d0fa-417a-9077-9e32a817e591');assert(greta);assert(greta.barcodes.includes('4610389218703'));assert(greta.barcodes.includes('4630584392961'));
 assert.equal(typeof s.adjustmentContext,'function');
 console.log(JSON.stringify({passed:true,readOnly:true,runtimePackingCases:cases,request:2000,greta:{barcode:greta.barcode,barcodes:greta.barcodes},ozonAdjustmentRetained:true}));
})().finally(()=>db.$disconnect()).catch(e=>{console.error(e.stack);process.exitCode=1});
