// TEST: exercise the exact candidate methods and Nest query metadata.
const {test}=require('node:test'),assert=require('node:assert/strict');
require('reflect-metadata');
const root=process.env.RUNTIME_ROOT||'/app/apps/api/dist';
const {TsdAssemblyService}=require(root+'/modules/tsd/tsd-assembly.service');
const {ReceiptChannelsController}=require(root+'/modules/warehouse/receipt-channels.controller');
const {PickInstructionService}=require(root+'/modules/stock/pick-instruction.service');
test('web FBO retains access guard and omits obsolete instruction',async()=>{
 process.env.WMS_MENU_READS_ENABLED='true';process.env.WMS_FBO_TWO_STAGE_ENABLED='true';let guard=0;
 const s=new TsdAssemblyService({}, {}, {}, {}, {}, {eligible:async()=>true,plan:async()=>({requestId:'r',picked:12})});
 s.requirePlanRead=async()=>{guard++;};s.getRequestPlan=async()=>{throw Error('unnecessary instruction');};
 assert.equal((await s.getDeviceRequestPlan('r',{})).fbo.picked,12);assert.equal(guard,1);
 s.requirePlanRead=async()=>{throw Error('pending review');};await assert.rejects(s.getDeviceRequestPlan('r',{}),/pending review/);
});
test('disabled rollout and FBS preserve old response',async()=>{
 const s=new TsdAssemblyService({}, {}, {}, {}, {}, {eligible:async()=>false});s.getRequestPlan=async()=>({legacy:true});
 for(const value of ['true','false']){process.env.WMS_MENU_READS_ENABLED=value;assert.deepEqual(await s.getDeviceRequestPlan('r',{}),{legacy:true});}
});
test('receipt summary/detail parameters reach the published controller',()=>{
 const metadata=Reflect.getMetadata('__routeArguments__',ReceiptChannelsController,'list');
 assert.ok(Object.values(metadata).some(x=>x.index===4&&x.data==='summary'));
 assert.ok(Object.values(metadata).some(x=>x.index===5&&x.data==='receiptId'));
});
test('FBS balance query keeps candidate set and omits unused JSON',async()=>{
 process.env.WMS_MENU_READS_ENABLED='true';process.env.WMS_RECEIPT_APPROVAL_ENABLED='false';let args;
 const s=new PickInstructionService({stockBalance:{findMany:async a=>{args=a;return [];}}},{});
 await s.loadAvailableBalances('c','w',[{skuId:'s'}],true);
 assert.equal(args.where.clientId,'c');assert.equal(args.where.warehouseId,'w');assert.equal(args.where.skuId,undefined);
 assert.deepEqual(args.include.sku.omit,{marketplacePayload:true});
});
