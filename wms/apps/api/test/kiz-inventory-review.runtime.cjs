// TEST: execute the exact published/candidate runtime, never a stale source rebuild.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {releaseCancelledBindings}=require(path.resolve(process.env.KIZ_RUNTIME_DIR || 'dist','common/kiz-cancelled-reuse.js'));
const identity='0104640569959171215bVpmIld*31.o';
const earlier=new Date('2026-09-18T15:02:17Z'), later=new Date('2026-10-02T15:18:37Z');
function fixture(){
 const old={id:'old',clientId:'client',orderId:'order',requestId:'request',status:'WB_ACCOUNTED',kiz:identity,updatedAt:earlier,completedAt:null};
 const mark={id:'mark',clientId:'client',value:identity,status:'AVAILABLE',boxId:'box',skuId:'sku',updatedAt:later};
 const evidence={checkedAt:new Date().toISOString(),decision:'REVIEW',circulation:null,orders:[{orderId:'order',verified:true,supplierStatus:'complete',wbStatus:'canceled_by_client',containsKiz:false,supplyAccepted:false}]};
 const f={old,mark,evidence,links:[old],requests:[{id:'request',warehouseId:'warehouse'}],marks:[mark],fbo:[],
 history:[{id:'shipment',assemblyId:'old',requestId:'request',clientId:'client',warehouseId:'warehouse',orderId:'order',kiz:identity,shippedAt:earlier}],
 box:{id:'box',clientId:'client',warehouseId:'warehouse',status:'active'},balance:1,writes:[],updates:[],count:1,
 audit:{id:'proof',entityId:'inventory',userId:'admin',createdAt:later,payload:{boxId:'box',clientId:'client',warehouseId:'warehouse',roundStartedAt:'2026-10-02T15:00:00Z',scans:[{identity,value:identity,skuId:'sku'}],previousScannedMarks:[mark]}}};
 f.tx={$queryRaw:async()=>[],fbsTsdAssembly:{findMany:async()=>f.links,updateMany:async args=>{f.updates.push(args);return {count:f.count}}},
 clientRequest:{findMany:async()=>f.requests},productMark:{findMany:async()=>f.marks,findUnique:async()=>f.current===undefined?f.mark:f.current},
 box:{findUnique:async()=>f.box},fboAssemblyUnit:{findMany:async()=>f.fbo},shippedKizHistory:{findMany:async()=>f.history},
 auditLog:{findFirst:async()=>f.audit,create:async args=>{f.writes.push(args);return args.data}},stockBalance:{aggregate:async()=>({_sum:{quantity:f.balance}})}};
 return f;
}
function flags(enabled=true){process.env.WMS_KIZ_CANCELLED_ADMIN_REUSE_ENABLED='true';process.env.WMS_KIZ_PHYSICAL_REVIEW_ENABLED='true';process.env.WMS_KIZ_INVENTORY_ADMIN_REUSE_ENABLED=String(enabled)}
async function run(f,confirm=true){return releaseCancelledBindings(f.tx,'client',identity,f.evidence,'manager','review','current',confirm)}
test('WB_ACCOUNTED + cancelled WB + later confirmed recount releases only historical KIZ slot',async()=>{flags();const f=fixture();await run(f);assert.equal(f.updates.length,1);assert.deepEqual(f.updates[0].data,{kiz:null});assert.equal(f.updates[0].where.updatedAt,earlier);assert.equal(f.writes[0].data.action,'KIZ_INVENTORY_BINDING_ARCHIVED');assert.equal(f.writes[0].data.userId,'manager');assert.equal(f.writes[0].data.payload.before.kiz,identity);assert.deepEqual(f.writes[0].data.payload.inventoryProof.shipmentIds,['shipment']);});
const rejected={
 'flag disabled':f=>flags(false),
 'sold':f=>f.evidence.orders[0].wbStatus='sold',
 'retired':f=>f.evidence.circulation='RETIRED',
 'written off':f=>f.evidence.circulation='WRITTEN_OFF',
 'RELABEL decision':f=>f.evidence.decision='RELABEL',
 'unverified WB':f=>f.evidence.orders[0].verified=false,
 'KIZ still on WB':f=>f.evidence.orders[0].containsKiz=true,
 'accepted supply':f=>f.evidence.orders[0].supplyAccepted=true,
 'unknown supply':f=>f.evidence.orders[0].supplyAccepted=null,
 'unknown supplier state':f=>f.evidence.orders[0].supplierStatus='new',
 'stale WB evidence':f=>f.evidence.checkedAt=earlier.toISOString(),
 'active old pick':f=>f.old.status='IN_PROGRESS',
 'return required':f=>f.old.status='RETURN_REQUIRED',
 'open historical request':f=>f.requests=[],
 'duplicate mark':f=>f.marks.push({...f.mark,id:'duplicate'}),
 'foreign client':f=>f.mark.clientId='other',
 'different warehouse':f=>f.box.warehouseId='other',
 'archived box':f=>f.box.status='archived',
 'mark not available':f=>f.mark.status='SHIPPING',
 'concurrent mark update':f=>f.current={...f.mark,updatedAt:new Date()},
 'active FBO':f=>f.fbo=[{activeMarkId:'mark'}],
 'missing shipment':f=>f.history=[],
 'another historical order':f=>f.history.push({...f.history[0],orderId:'other'}),
 'shipment after recount':f=>{f.history[0].shippedAt=new Date()},
 'missing proof':f=>f.audit=null,
 'proof missing actor':f=>f.audit.userId=null,
 'wrong proof box':f=>f.audit.payload.boxId='other',
 'wrong proof warehouse':f=>f.audit.payload.warehouseId='other',
 'wrong proof client':f=>f.audit.payload.clientId='other',
 'old recount':f=>f.audit.payload.roundStartedAt=earlier.toISOString(),
 'different scanned KIZ':f=>f.audit.payload.scans[0].value='010000000000000021DIFFERENT0000',
 'different scanned SKU':f=>f.audit.payload.scans[0].skuId='other',
 'missing scan':f=>f.audit.payload.scans=[],
 'duplicate scan':f=>f.audit.payload.scans.push({...f.audit.payload.scans[0]}),
 'wrong mark in proof':f=>f.audit.payload.previousScannedMarks=[],
 'zero stock':f=>f.balance=0
};
for(const [name,change] of Object.entries(rejected))test('reject: '+name,async()=>{flags();const f=fixture();change(f);await assert.rejects(run(f));assert.equal(f.updates.length,0);assert.equal(f.writes.length,0)});
test('no physical administrator confirmation',async()=>{flags();const f=fixture();await assert.rejects(run(f,false));assert.equal(f.updates.length,0)});
test('concurrent historical binding change fails transaction',async()=>{flags();const f=fixture();f.count=0;await assert.rejects(run(f));assert.equal(f.updates[0].where.status,'WB_ACCOUNTED')});
test('COMPLETED and RELEASED historical slots use same proof',async()=>{for(const status of ['COMPLETED','RELEASED']){flags();const f=fixture();f.old.status=status;f.old.completedAt=earlier;await run(f);assert.equal(f.updates.length,1)}});
