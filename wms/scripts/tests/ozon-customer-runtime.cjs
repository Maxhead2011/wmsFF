// TEST: execute the exact candidate's locked packing path, including its existing fast-ACK hash.
const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {FboTwoStageService}=require(process.env.RUNTIME_ROOT+'/modules/tsd/fbo-two-stage.service');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fixture(){
 process.env.WMS_FBO_TWO_STAGE_ENABLED='true';process.env.WMS_OZON_FBO_IMPORT_ENABLED='true';process.env.WMS_FBO_FAST_ACK_ENABLED='false';
 const request={id:'r',status:'IN_WORK',warehouseId:'w',clientId:'c',items:[{id:'l',skuId:'s',barcode:'123',quantity:2,sku:{}}]};
 const units=[{id:'u1',requestItemId:'l',skuId:'s',barcode:'123',state:'PACKED',targetBoxId:'b',wholeBox:false,markId:null},
 {id:'u2',requestItemId:'l',skuId:'s',barcode:'123',state:'PICKED',targetBoxId:null,wholeBox:false,markId:null}];
 const parcels=[{requestId:'r',boxId:'b',boxCode:'B',direction:'Уфа',closedAt:null,wholeBox:false}];
 let moves=0;const actions=new Map();
 const tx={$queryRaw:async()=>[],ozonFboShipment:{findUnique:async()=>({directions:[{name:'Уфа',items:[{skuId:'s',quantity:1}]},{name:'Москва',items:[{skuId:'s',quantity:1}]}]})},
 fboAssembly:{findUnique:async()=>({phase:'PACKING',compositionHash:hash([['l','s','123',2]])})},
 fboAssemblyAction:{findUnique:async({where})=>actions.get(where.id),create:async({data})=>actions.set(data.id,data)},
 fboAssemblyUnit:{findMany:async()=>units,update:async({where,data})=>Object.assign(units.find(u=>u.id===where.id),data)},
 fboAssemblyBox:{findMany:async()=>parcels,findUnique:async()=>parcels[0]},box:{findUniqueOrThrow:async()=>({id:'holding'})},auditLog:{create:async()=>{}}};
 const svc=Object.create(FboTwoStageService.prototype);svc.prisma={$transaction:fn=>fn(tx)};svc.lock={assertStockMovementsAllowed:async()=>{}};
 svc.load=async()=>request;svc.requireFbo=()=>{};svc.box=async()=>({id:'b',code:'B'});svc.move=async()=>{moves++;return{id:'move'};};
 return{svc,units,parcels,moves:()=>moves};
}
test('rejects a full destination before moving the next picked unit',async()=>{
 const f=fixture();await assert.rejects(()=>f.svc.executeAction('r',{action:'PACK_UNIT',operationId:'one',barcode:'123',targetBoxCode:'B'},{id:'picker'}),/превышено/);assert.equal(f.moves(),0);
});
test('packs the other destination once; repeating the same operation does not move stock again',async()=>{
 const f=fixture();f.units[0].targetBoxId='other';f.parcels.push({...f.parcels[0],boxId:'other'});f.parcels[0].direction='Москва';
 const dto={action:'PACK_UNIT',operationId:'one',barcode:'123',targetBoxCode:'B'};
 await f.svc.executeAction('r',dto,{id:'picker'});await f.svc.executeAction('r',dto,{id:'picker'});assert.equal(f.moves(),1);
});
test('rejects manual demand changes for a customer-file assembly',async()=>{
 const f=fixture();process.env.WMS_FBO_MANUAL_PACKING_ENABLED='true';
 await assert.rejects(()=>f.svc.executeAction('r',{action:'MANUAL_PACK_UNIT',operationId:'one'},{id:'picker'}),/поштучный/);assert.equal(f.moves(),0);
});
test('different destination changes the ACK identity without changing legacy hashes',()=>{
 const f=fixture(),dto={action:'OPEN_BOX',targetBoxCode:'B'};
 assert.equal(f.svc.actionHash(dto),hash(['OPEN_BOX',null,'B',null,null,null]));
 assert.notEqual(f.svc.actionHash({...dto,direction:'Уфа'}),f.svc.actionHash({...dto,direction:'Москва'}));
});
