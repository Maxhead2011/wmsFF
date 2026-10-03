// TEST: exercise the published runtime, not the stale TypeScript implementation.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const runtime=process.env.FBO_API_DIST || require('node:path').resolve(__dirname,'../dist');
const {FboTwoStageService}=require(runtime+'/modules/tsd/fbo-two-stage.service');
const reservations=require(runtime+'/modules/tsd/fbo-fbs-reservations');
const preference=require(runtime+'/modules/tsd/fbo-request-route');
const flag='WMS_FBO_PACKING_READS_ENABLED';
async function snapshot(phase, enabled, completedSku=false) {
 const previous=process.env[flag]; process.env[flag]=String(enabled);
 const oldAvailability=reservations.loadFboFbsAvailability, oldPreference=preference.loadFboRoutePreference;
 const calls=[];let availabilityIds;
 reservations.loadFboFbsAvailability=async(db,r,ids)=>{calls.push('availability');availabilityIds=ids;return {free:()=>0,take:()=>{throw Error('no picking permitted')}}};
 preference.loadFboRoutePreference=async()=>{calls.push('preference');return null};
 const units=[{id:'u',requestItemId:'i',skuId:'s',barcode:'b',markId:'m',kiz:'mark',state:'PACKED',targetBoxId:'box',targetBoxCode:'BOX',pickedByUserId:'a',packedByUserId:'a'},
 {id:'v',requestItemId:'i',skuId:'s',barcode:'b',state:'PICKED',wholeBox:false},
 {id:'returned',requestItemId:'i',skuId:'s',barcode:'b',state:'RETURNED'}];
 if(completedSku)units.push({id:'complete',requestItemId:'complete-line',skuId:'complete-sku',barcode:'complete-barcode',state:'PICKED'});
 const assembly=phase?{phase,units,boxes:[{boxId:'box',boxCode:'BOX'}],compositionHash:'old'}:null;
 const tx={fboAssembly:{findUnique:async()=>assembly},user:{findMany:async()=>[{id:'a',name:'Actor'}]},box:{findMany:async()=>{calls.push('boxes');return []}}};
 const service=new FboTwoStageService();service.busyBoxes=async()=>{calls.push('busy');return new Set()};
 const r={id:'r',number:1,clientId:'c',warehouseId:'w',items:[{id:'i',skuId:'s',barcode:'b',quantity:4,sku:{name:'item',needsChestnyZnak:true}}]};
 if(completedSku)r.items.push({id:'complete-line',skuId:'complete-sku',barcode:'complete-barcode',quantity:1,sku:{name:'complete'}});
 try {const value=await service.snapshot(tx,r);delete value.observedAt;return {value,calls,availabilityIds};}
 finally {reservations.loadFboFbsAvailability=oldAvailability;preference.loadFboRoutePreference=oldPreference;if(previous===undefined)delete process.env[flag];else process.env[flag]=previous;}
}
for(const phase of ['PACKING','CONTROL','DONE']) test(`packing snapshot ${phase} is equivalent without route queries`,async()=>{
 const old=await snapshot(phase,false), now=await snapshot(phase,true);
 assert.deepEqual(now.value,old.value);
 assert.equal(now.value.pickedUnits.length,2);assert.equal(now.value.packed,1);
 assert.equal(now.value.boxes[0].quantity,1);assert.equal(now.value.compositionChanged,true);
 assert.deepEqual(now.calls,[]);
 assert.deepEqual(old.calls,['availability','preference','busy']);
});
test('parallel packing reserves only SKUs with positive remaining demand',async()=>{
 const old=await snapshot('PICKING',false,true),now=await snapshot('PICKING',true,true);
 assert.deepEqual(now.value,old.value);assert.deepEqual(now.calls,old.calls);
 assert.deepEqual(old.availabilityIds,['s','complete-sku']);assert.deepEqual(now.availabilityIds,['s']);
});
for(const phase of ['PICKING',null]) test(`picking ${phase} retains all reservation checks`,async()=>{
 const old=await snapshot(phase,false), now=await snapshot(phase,true);
 assert.deepEqual(now,old);assert.deepEqual(now.calls,['boxes','availability','preference','busy']);
});
