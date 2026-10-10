// TEST: execute the actual candidate handlers, including the Nest query decorator.
require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {TsdAssemblyService:S}=require('/app/apps/api/dist/modules/tsd/tsd-assembly.service');
const {TsdDeviceController:C}=require('/app/apps/api/dist/modules/tsd/tsd-device.controller');
for(const workflow of ['fbo-pick','fbo-pack']) test(workflow,async()=>{
 process.env.WMS_FBO_TWO_STAGE_ENABLED='true';process.env.WMS_FBO_PARALLEL_PACKING_ENABLED='true';
 let query;
 const s=new S({clientRequest:{findMany:async q=>{query=q;return []}}},{resolveClientFilter:()=> 'client'}, {},{});
 const user={roleCodes:['ADMIN'],permissionCodes:['system:admin']};
 for(const marketplace of ['WB','OZON']){
  await C.prototype.listAssemblyRequests.call({assembly:s},user,workflow,marketplace);
  assert.deepEqual(query.where.ozonShipment,marketplace==='OZON'?{isNot:null}:{is:null});
  assert.equal(query.where.clientId,'client');assert.equal(query.take,100);
  if(workflow==='fbo-pack')assert.ok(query.where.fboAssembly.is.OR,'Parallel packing lost');
 }
 await s.listActiveRequests(user,workflow);assert.equal(query.where.ozonShipment,undefined);
 await assert.rejects(()=>s.listActiveRequests(user,workflow,'invalid'));
});
test('Nest binds marketplace query parameter',()=>{
 const m=Reflect.getMetadata('__routeArguments__',C,'listAssemblyRequests');
 assert.ok(Object.values(m).some(p=>p.index===2&&p.data==='marketplace'));
});
