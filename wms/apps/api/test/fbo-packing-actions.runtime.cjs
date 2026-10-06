// TEST: compare mutations/errors to the exact published implementation, with no real database.
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),Module=require('node:module');
const path=require('node:path');
const runtime=(process.env.FBO_API_DIST || path.resolve(__dirname,'../dist'))+'/modules/tsd';
const {FboTwoStageService:Candidate}=require(runtime+'/fbo-two-stage.service');
const originalPath=process.env.FBO_ORIGINAL_SERVICE || path.resolve(__dirname,'../../../../../../vps-backups/fbo-packing-base-20261003/runtime/apps/api/dist/modules/tsd/fbo-two-stage.service.js');
const originalModule=new Module(runtime+'/fbo-original.js');originalModule.filename=runtime+'/fbo-original.js';originalModule.paths=Module._nodeModulePaths(runtime);originalModule._compile(fs.readFileSync(originalPath,'utf8'),originalModule.filename);
const Original=originalModule.exports.FboTwoStageService;
function matches(row,where){return Object.entries(where).every(([k,v])=>k==='OR'?v.some(w=>matches(row,w)):v&&typeof v==='object'&&'not'in v?row[k]!==v.not:row[k]===v)}
async function run(Type,action,options={}){
 process.env.WMS_FBO_TWO_STAGE_ENABLED='true';process.env.WMS_FBO_PACKING_READS_ENABLED=options.disabled?'false':'true';process.env.WMS_FBO_PARALLEL_PACKING_ENABLED='true';process.env.WMS_FBO_MANUAL_PACKING_ENABLED='true';
 const writes=[],reads=[];const user={id:'a',name:'Actor'};
 const r={id:'r',status:'IN_WORK',items:[{id:'i',skuId:'s',barcode:'b',quantity:3000}]};
 const composition=crypto.createHash('sha256').update(JSON.stringify([['i','s','b',3000]])).digest('hex');
 const units=Array.from({length:2500},(_,i)=>({id:'old'+i,requestId:'r',requestItemId:'i',skuId:'s',barcode:'b',state:'PACKED',wholeBox:false,targetBoxId:'other',markId:null}));
 if(!options.noPicked) units.push({id:'u',requestId:'r',requestItemId:'i',skuId:'s',barcode:'b',state:'PICKED',wholeBox:!!options.whole,markId:options.unmarked?null:'m'});
 units.push({id:'returned',requestId:'r',requestItemId:'i',skuId:'s',barcode:'b',state:'RETURNED',wholeBox:false,markId:'m'});
 const tx={$queryRaw:async()=>[],fboAssemblyAction:{findUnique:async()=>options.retry?{payloadHash:svc.actionHash(dto),actorId:'a'}:null,create:async q=>{writes.push(['receipt',q.data]);return q.data}},
  fboAssembly:{findUnique:async()=>({phase:options.phase||'PICKING',compositionHash:options.changed?'different':composition,pickClosure:options.badClosure?{version:1,quantities:{i:4000}}:null})},
  fboAssemblyUnit:{findMany:async q=>{const rows=units.filter(u=>matches(u,q.where));reads.push(rows.length);return rows},count:async q=>units.filter(u=>matches(u,q.where)).length,update:async q=>{writes.push(['unit',q]);return q.data}},
  fboAssemblyBox:{findUnique:async()=>action==='PACK_UNIT'||options.reopen?{id:'parcel',requestId:'r',boxId:'target',closedAt:options.reopen?new Date('2026-09-01'):null,wholeBox:false}:null,create:async q=>{writes.push(['parcel',q.data]);return q.data},update:async q=>{writes.push(['parcelUpdate',q]);return q.data}},
  stockBalance:{count:async()=>0},productMark:{count:async()=>0,updateMany:async q=>{writes.push(['mark',q]);return{count:1}}},auditLog:{create:async q=>{writes.push(['audit',q.data]);return q.data}}};
 const svc=new Type({$transaction:async fn=>fn(tx)},null,null,null,{assertStockMovementsAllowed:async()=>{}});
 svc.load=async()=>r;svc.requireFbo=()=>{};svc.box=svc.target=async()=>({id:'target',code:'FFL_TARGET'});svc.requireIdleBox=async()=>{};svc.exactMark=async()=>({id:'m'});
 svc.move=async(...args)=>{writes.push(['move',args.slice(2,8)]);return{id:'movement'}};svc.manualPack=async()=>{writes.push(['wholeFallback']);};
 const dto={action,operationId:'op',targetBoxCode:'FFL_TARGET',barcode:'b',kiz:options.unmarked?null:'mark'};
 try {await svc.executeAction('r',dto,user);return {writes,reads,error:null};}catch(e){return{writes,reads,error:e.message};}
}
for(const [action,options] of [
 ['PACK_UNIT',{}],['PACK_UNIT',{unmarked:true}],['PACK_UNIT',{whole:true}],['PACK_UNIT',{retry:true}],['PACK_UNIT',{noPicked:true}],
 ['OPEN_BOX',{}],['OPEN_BOX',{noPicked:true}],['MANUAL_OPEN_BOX',{reopen:true}],['OPEN_BOX',{phase:'CONTROL'}],
 ['PACK_UNIT',{changed:true}],['OPEN_BOX',{badClosure:true}],['OPEN_BOX',{disabled:true}]
])test(`${action} ${JSON.stringify(options)} preserves result`,async()=>{
 const old=await run(Original,action,options),now=await run(Candidate,action,options);
 assert.deepEqual(now.writes,old.writes);assert.equal(now.error,old.error);
 if(!options.disabled&&!options.retry&&!options.changed){assert.ok(now.reads.reduce((s,n)=>s+n,0)<=1,JSON.stringify(now.reads));assert.ok(old.reads.some(n=>n>=2500));}
 if(options.disabled)assert.deepEqual(now.reads,old.reads);
});
