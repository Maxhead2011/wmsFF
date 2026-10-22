// TEST: run against the candidate image's actual snapshot, with deterministic stock reads and no network.
const assert=require('node:assert/strict'),root='/app/apps/api/dist/modules/tsd/';
const {FboTwoStageService}=require(root+'fbo-two-stage.service');
require(root+'fbo-fbs-reservations').loadFboFbsAvailability=async()=>({free:id=>id==='blocked'?0:5,take(){}});
require(root+'fbo-request-route').loadFboRoutePreference=async()=>null;
async function scenario(code,enabled=true,busy=false,placed=true){
 process.env.WMS_FBO_ALTERNATIVE_PICK_ENABLED=String(enabled);
 const boxes=['first','other','blocked'].map((id,i)=>({id,code:'FFL_'+id,balances:[{skuId:'s',quantity:5,status:'AVAILABLE'}],productMarks:[],storagePlacement:placed?{pallet:{code:'PALET_SORT_'+i}}:null}));
 const tx={ozonFboShipment:{findUnique:async()=>null},fboAssembly:{findUnique:async()=>({phase:'PICKING',units:[],boxes:[]})},user:{findMany:async()=>[]},box:{findMany:async query=>{assert.equal(query.where.clientId,'client');assert.equal(query.where.warehouseId,'warehouse');assert.equal(query.where.status,'active');return boxes;}}};
 const request={id:'r',clientId:'client',warehouseId:'warehouse',client:{},items:[{id:'i',skuId:'s',barcode:'123',quantity:1,sku:{name:'Item',isUnmarked:true}}]};
 const service=new FboTwoStageService(tx,{});service.busyBoxes=async()=>new Set(busy?['other']:[]);
 return service.snapshot(tx,request,{sourceBoxCode:code});
}
(async()=>{
 let count=0;
 for(const [code,enabled,busy,placed,expected] of [
 ['FFL_other',true,false,true,'FFL_other'],['ffl_OTHER',true,false,true,'FFL_other'],
 ['FFL_other',true,false,false,'FFL_other'],['FFL_other',false,false,true,'FFL_first'],
 ['FFL_other',true,true,true,'FFL_first'],['FFL_blocked',true,false,true,'FFL_first'],
 ['FFL_foreign',true,false,true,'FFL_first'],['123',true,false,true,'FFL_first']]){
  const p=await scenario(code,enabled,busy,placed);assert.equal(p.route[0].boxCode,expected);assert.equal(p.picked,0);assert.equal(p.needed,1);assert.equal(p.shortage,0);assert.equal(p.alternativePickingSupported,enabled);count++;
 }
 console.log(JSON.stringify({passed:true,cases:count,network:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
