const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const base=process.env.FBS_SCAN_RUNTIME;
const {MarketplaceConnectionsService:S}=require(path.join(base,'modules/marketplace-connections/marketplace-connections.service.js'));
const flag='WMS_FBS_BOX_SCAN_BOUNDED_ENABLED';
afterEach(()=>delete process.env[flag]);

// TEST: actual candidate entry point shares only pending identical authenticated scans.
test('pending duplicate scans share one result and subsequent scans execute again',async()=>{
 process.env[flag]='true';const s=Object.create(S.prototype);let finish,calls=0;
 s.performFbsTsdBoxScan=()=>{calls++;return new Promise(r=>{finish=r})};
 const user={id:'u',deviceCode:'d'};
 const a=s.scanFbsTsdBox('t',{boxCode:'FFL_A'},user),b=s.scanFbsTsdBox('t',{boxCode:'FFL_A'},user);
 await Promise.resolve();assert.equal(calls,1);finish('ok');assert.deepEqual(await Promise.all([a,b]),['ok','ok']);
 const c=s.scanFbsTsdBox('t',{boxCode:'FFL_A'},user);await Promise.resolve();assert.equal(calls,2);finish('again');await c;
});
test('sold WMS retains separate calls without flag',async()=>{
 const s=Object.create(S.prototype);let calls=0;s.performFbsTsdBoxScan=async()=>++calls;
 await Promise.all([s.scanFbsTsdBox('t',{},{}),s.scanFbsTsdBox('t',{}, {})]);assert.equal(calls,2);
});
test('different device or payload never shares pending work',async()=>{
 process.env[flag]='true';const s=Object.create(S.prototype);let calls=0;s.performFbsTsdBoxScan=async()=>++calls;
 await Promise.all([s.scanFbsTsdBox('t',{boxCode:'A'},{id:'u',deviceCode:'one'}),s.scanFbsTsdBox('t',{boxCode:'A'},{id:'u',deviceCode:'two'}),s.scanFbsTsdBox('t',{boxCode:'B'},{id:'u',deviceCode:'one'})]);assert.equal(calls,3);
});

function fixture(competing){
 process.env[flag]='true';const s=Object.create(S.prototype);const writes=[];let bulk=0;
 const current={id:'current',clientId:'client',requestId:'request',connectionId:'wb',marketplace:'WILDBERRIES',skuId:'old',deviceCode:'device',reservedBoxId:'old-box'};
 const target={...current,id:'target',skuId:'sku',status:'RESERVED',reservedBoxId:'box',itemCount:1,createdAt:new Date(),reservedAt:new Date()};
 const tx={stockBalance:{aggregate:async()=>({_sum:{quantity:1}})},fbsTsdAssembly:{findUnique:async a=>a.where.id==='current'?current:target,update:async a=>{writes.push(a);return {...target,...a.data}}}};
 s.prisma={stockBalance:{findMany:async()=>[{skuId:'sku',quantity:1}]},fbsTsdAssembly:{findMany:async()=>[target]},client:{findUnique:async()=>({relabelingEnabled:false})},fbsOrderRequestLink:{findFirst:async()=>({id:'link'})}};
 s.fbsTsdReservationRowsBySku=async(_input,db)=>{bulk++;return new Map([['sku', db===tx&&competing?[{taskId:'physical-other',boxId:'box',itemCount:1,releasableBackground:false}]:[]]])};
 s.fbsTsdReservationRows=async()=>{throw Error('per-candidate read')};
 s.loadFbsTsdRequestOrders=async()=>({orders:[]});
 s.withFbsTsdLeaseTransaction=async(_t,_u,fn)=>fn(tx);
 s.requireCurrentFbsTsdLease=()=>{};s.formatFbsTsdAssembly=async t=>t;
 return {s,current,writes,bulk:()=>bulk};
}
// TEST: free choice of box survives, but the search snapshot cannot override a fresh physical reservation.
test('switches to another queued order in the scanned box with transaction recheck',async()=>{
 const f=fixture(false);const result=await f.s.switchFbsTsdAssemblyToBox(f.current,{id:'box',code:'FFL_A'},{id:'u',name:'worker'});
 assert.equal(result.boxId,'box');assert.equal(f.writes.length,2);assert.equal(f.bulk(),2);
});
test('fresh reservation blocks switching even when the search snapshot was free',async()=>{
 const f=fixture(true);const result=await f.s.switchFbsTsdAssemblyToBox(f.current,{id:'box',code:'FFL_A'},{id:'u',name:'worker'});
 assert.equal(result,null);assert.equal(f.writes.length,0);assert.equal(f.bulk(),2);
});
test('empty box never loads full request or WB',async()=>{
 process.env[flag]='true';const s=Object.create(S.prototype);s.prisma={stockBalance:{findMany:async()=>[]}};
 s.loadFbsTsdRequestOrders=async()=>{throw Error('full request')};s.loadFbsOrders=async()=>{throw Error('WB')};
 assert.equal(await s.switchFbsTsdAssemblyToBox({clientId:'c'},{id:'b'},{}),null);
});
