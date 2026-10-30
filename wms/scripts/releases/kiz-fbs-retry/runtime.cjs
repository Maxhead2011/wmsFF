// TEST: exercise the actual published-format module, never warehouse writes.
const assert=require('node:assert/strict'),path=require('node:path');
const h=require(path.join(process.argv[2],'common/kiz-client-review.js'));
process.env.WMS_KIZ_CLIENT_GUARD_ENABLED='true';
const kiz='010460000000000121ABCDEFGHIJKLM';
const i={scope:'FBS',clientId:'c',warehouseId:'w',requestId:'r',taskId:'t',skuId:'s',boxId:'b',kiz};
let row=null,events=[],moves=[{quantity:1}],passed=0;
const mark={id:'m',clientId:'c',skuId:'s',boxId:'b',value:kiz,status:'AVAILABLE',updatedAt:new Date('2026-10-29')};
const task={id:'t',clientId:'c',requestId:'r',skuId:'s',boxId:'b',kiz,wbMetaStatus:'ACCEPTED',stockWarehouseId:'w',itemCount:1};
const db={$queryRaw:async()=>[],$executeRaw:async()=>1,
 clientRequest:{findUnique:async()=>({id:'r',clientId:'c',warehouseId:'w',status:'IN_WORK'})},
 fbsTsdAssembly:{findUnique:async()=>task,findMany:async()=>[]},fboAssemblyUnit:{findMany:async()=>[]},
 shippedKizHistory:{findMany:async()=>events},productMark:{findMany:async()=>[mark]},
 stockMovement:{findMany:async({where})=>{assert.equal(where.idempotencyKey.startsWith,'fbs-sticker-pick:t:');return moves;}},
 kizReviewCase:{findUnique:async()=>row,findMany:async()=>[],upsert:async({create,update})=>row=row?{...row,...update}:{id:'case',...create}},
 auditLog:{create:async()=>({})}};db.$transaction=fn=>fn(db);
(async()=>{
 await h.assertClientKizUse(db,i,{id:'u'});
 Object.assign(mark,{boxId:null,status:'PACKING',updatedAt:new Date('2026-10-30')});
 assert.equal(await h.assertClientKizUse(db,i,{id:'u'}),'ALLOW');passed++;
 moves=[{quantity:1},{quantity:-1}];await assert.rejects(h.assertClientKizUse(db,i,{id:'u'}));passed++;
 row=null;events=[{id:'ship',kiz,orderId:'12345',warehouseId:'w',shippedAt:new Date('2026-10-01T10:00:00Z')}];
 await assert.rejects(h.withClientKizReview(db,{id:'u'},()=>h.assertClientKizUse(db,i,{id:'u'})),/01\.10\.2026.*12345/);assert.equal(row.status,'OPEN');passed++;
 events=[];await assert.rejects(h.withClientKizReview(db,{id:'u'},()=>h.assertClientKizUse(db,i,{id:'u'})));assert.equal(row.status,'OPEN');assert.equal(row.evidence.history[0].orderId,'12345');passed++;
 console.log(JSON.stringify({passed}));
})().catch(e=>{console.error(e);process.exit(1)});
