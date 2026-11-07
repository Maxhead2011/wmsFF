// TEST: exact candidate service and helpers; only database/marketplace adapters are synthetic.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),Module=require('module');
const root=path.resolve(process.argv[2]),candidate=path.join(root,'api-candidate');
fs.cpSync(root+'/api-base',candidate,{recursive:true});fs.cpSync(root+'/api-payload',candidate,{recursive:true});
const local=Module.createRequire(path.resolve('apps/api/package.json')),load=Module._load;
Module._load=function(name,parent,main){
 if(name.endsWith('/prisma.service'))return {PrismaService:class{}};
 if(name.endsWith('/client-scope.service'))return {ClientScopeService:class{}};
 if(name.endsWith('/fbo-two-stage.service'))return {FboTwoStageService:class{}};
 if(name.endsWith('/ozon-assembly-supply.service'))return {OzonAssemblySupplyService:class{}};
 if(name.endsWith('/wb-order-stock-lifecycle'))return {wbReservationQuantities:async()=>new Map([['sku',2]])};
 if(parent?.filename.startsWith(candidate)&&name.startsWith('@'))return local(name);
 return load.apply(this,arguments);
};
const {OzonStockAdjustmentService}=require(candidate+'/modules/tsd/ozon-stock-adjustment.service');
process.env.WMS_OZON_FBO_IMPORT_ENABLED='true';
function fixture(phase='CONTROL'){
 const integration={connectionId:'c',orderId:'123',orderNumber:'123',state:'DATA_FILLING',mapping:{A:'42'},operations:{},supplies:[{id:'42',name:'A',items:[{sku:'99',barcode:'123',offerId:'a',quantity:10,quant:1}]}]};
 const s={requestId:'r',directions:[{name:'A',items:[{skuId:'sku',barcode:'123',quantity:10}]}],integration,request:{id:'r',clientId:'client',warehouseId:'w',status:'IN_WORK',items:[{id:'i',skuId:'sku',barcode:'123',quantity:10}],fboAssembly:{phase,boxes:[{id:'box',boxId:'b',direction:'A',closedAt:'date',confirmedAt:null}],units:Array.from({length:7},(_,i)=>({id:'u'+i,skuId:'sku',state:'PACKED',targetBoxId:'b'}))}}};
 const remote=structuredClone(integration),calls=[],writes=[];
 const db={ozonFboShipment:{findUnique:async()=>structuredClone(s),update:async({data})=>Object.assign(s,structuredClone(data))},clientMarketplaceConnection:{findFirst:async()=>({id:'c',apiKey:'test'})},clientRequestItem:{update:async({data})=>{writes.push('item');Object.assign(s.request.items[0],data)},delete:async()=>writes.push('delete')},auditLog:{create:async()=>{}},fboAssembly:{update:async()=>{}},$queryRaw:async()=>{},stockBalance:{findMany:async()=>[{skuId:'sku',quantity:8}]},sku:{findMany:async()=>[{id:'sku',name:'Dress',barcodes:[{value:'123'}]}]}};db.$transaction=fn=>fn(db);
 const ozon={snapshot:async()=>structuredClone(remote),call:async(c,p,b)=>{calls.push(p);if(p.endsWith('/supplies/get'))return {supplies_cargoes:[{supply_id:42,cargoes_without_transport_cargoes:[],transport_cargoes:[]}]};if(p.endsWith('/content/update')){assert.equal(s.integration.adjustment.operations[0].state,'SENDING');assert.equal(writes.length,0);remote.supplies[0].items[0].quantity=b.items[0].quantity;return {operation_id:'op'}}return {status:'SUCCESS'};}};
 const user={id:'u',activeWarehouseId:'w',permissionCodes:['system:admin']};const svc=new OzonStockAdjustmentService(db,{requireClientAccess:()=>{}},{adjustmentContext:async()=>{throw Error('Physical correction must not read a stock route')}},ozon);
 const preview=()=>svc.preview('r',user,{mode:'AVAILABLE'}),apply=p=>svc.start('r',{token:p.token,quantities:p.rows.map(r=>r.after),mode:'AVAILABLE',confirm:true},user);
 return {s,remote,calls,writes,ozon,svc,user,preview,apply};
}
(async()=>{let passed=0;
 {const x=fixture(),physical=structuredClone(x.s.request.fboAssembly),p=await x.preview();assert.equal(p.after,7);assert.equal(p.physicalBasis,'PACKED');assert.equal((await x.apply(p)).operation.state,'APPLIED');assert.deepEqual(x.s.request.fboAssembly,physical);assert.equal(x.s.request.items[0].quantity,7);passed++;}
 {const x=fixture();x.s.request.items[0].quantity=7;x.s.directions[0].items[0].quantity=7;const p=await x.preview();assert(p.changes);assert.equal((await x.apply(p)).operation.state,'APPLIED');passed++;}
 {const x=fixture(),p=await x.preview();x.remote.supplies[0].items[0].quantity++;await assert.rejects(x.apply(p),/предпросмотр/);assert.equal(x.writes.length,0);passed++;}
 {const x=fixture(),p=await x.preview();x.s.request.fboAssembly.boxes[0].confirmedAt='now';await assert.rejects(x.apply(p));assert.equal(x.writes.length,0);passed++;}
 {const x=fixture(),original=x.ozon.call;x.ozon.call=async(...a)=>{if(a[1].endsWith('/content/update')){x.calls.push(a[1]);throw Error('timeout')}return original(...a)};await x.apply(await x.preview());await x.svc.resume('r',x.user);assert.equal(x.s.integration.adjustment.operations[0].state,'UNKNOWN');assert.equal(x.calls.filter(p=>p.endsWith('/content/update')).length,1);assert.equal(x.writes.length,0);passed++;}
 {const x=fixture();await assert.rejects(x.svc.preview('r',x.user));passed++;}
 {const x=fixture();x.s.integration.frozenHash='locked';await assert.rejects(x.preview());passed++;}
 {const x=fixture();x.ozon.call=async()=>({supplies_cargoes:[{supply_id:42,transport_cargoes:[{}]}]});await assert.rejects(x.preview(),/грузоместа/);passed++;}
 fs.writeFileSync(root+'/runtime-api-proof.json',JSON.stringify({passed,synthetic:true,noProductionWrites:true}));console.log(JSON.stringify({passed}));
})().catch(e=>{console.error(e);process.exitCode=1});
