// TEST: exact production overlay, read permissions delegated before projections, legacy routes preserved.
const test=require('node:test'),assert=require('node:assert/strict');
const root=process.env.API_DIST||'/app/apps/api/dist';
const {onlinePlanView}=require(root+'/modules/tsd/online-plan-view');
const {FboTwoStageController}=require(root+'/modules/tsd/fbo-two-stage.controller');
const {TsdDeviceController}=require(root+'/modules/tsd/tsd-device.controller');
const {FboRouteDto}=require(root+'/modules/tsd/dto/fbo-route.dto');
const {validate}=require('class-validator');
const plan={needed:251,picked:251,route:[],pickedUnits:Array.from({length:251},(_,i)=>({id:String(i)}))};
test('browser summary, pages, unchanged legacy and sold format',async()=>{
 process.env.WMS_MENU_READS_ENABLED='true';let routeSeen;
 const ctl=new FboTwoStageController({plan:async(id,user,route)=>{assert.equal(user.id,'authorized');routeSeen=route;return plan;}});
 assert.equal((await ctl.plan('r',{id:'authorized'},{view:'summary',sourceBoxCode:'box'})).pickedUnits.length,0);assert.equal(routeSeen.sourceBoxCode,'box');
 assert.equal((await ctl.plan('r',{id:'authorized'},{view:'history',offset:'200'})).pickedUnits.length,51);
 assert.equal(await ctl.plan('r',{id:'authorized'},{}),plan);
 const dto=Object.assign(new FboRouteDto(),{view:'history',offset:'200',palletCode:'p'});assert.deepEqual(await validate(dto,{whitelist:true,forbidNonWhitelisted:true}),[]);
 const response=await TsdDeviceController.prototype.getAssemblyRequest.call({assembly:{getDeviceRequestPlan:async()=>({id:'r',fbo:plan})}},'r',{},'summary');assert.equal(response.fbo.pickedUnitsCount,251);
 process.env.WMS_MENU_READS_ENABLED='false';assert.equal(onlinePlanView(plan,'summary'),plan);
});
test('projection never bypasses the existing authorization failure',async()=>{
 process.env.WMS_MENU_READS_ENABLED='true';const ctl=new FboTwoStageController({plan:async()=>{throw Error('forbidden');}});
 await assert.rejects(()=>ctl.plan('r',{}, {view:'history'}),/forbidden/);
});
