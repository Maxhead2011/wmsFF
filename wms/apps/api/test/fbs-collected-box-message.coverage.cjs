// TEST: native coverage of the compiled read-only diagnostic, without additional packages.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {collectedFbsBoxMessage}=require('../dist/modules/marketplace-connections/fbs-collected-box-message');
test('all diagnostic paths preserve the selection boundary',async()=>{
 const prior=process.env.WMS_FBS_COLLECTED_SKU_MESSAGE_ENABLED;
 const input={clientId:'client',warehouseId:'warehouse',requestId:'request',boxId:'box'};
 const setup=()=>{
  const s={balances:[{skuId:'sku'}],items:[{id:'item',skuId:'sku',quantity:1}],
    tasks:[{requestItemId:'item',skuId:'sku',sourceSkuId:null,status:'COMPLETED',completedAt:new Date(),itemCount:1}]};
  const db={stockBalance:{findMany:async()=>s.balances},clientRequestItem:{findMany:async()=>s.items},
    fbsTsdAssembly:{findMany:async()=>s.tasks}};
  return {s,run:()=>collectedFbsBoxMessage(db,input)};
 };
 try {
  process.env.WMS_FBS_COLLECTED_SKU_MESSAGE_ENABLED='false';
  assert.equal(await collectedFbsBoxMessage({},input),null);
  process.env.WMS_FBS_COLLECTED_SKU_MESSAGE_ENABLED='true';
  assert.match(await setup().run(),/Нужное количество этого товара уже собрано/);
  for(const mutate of [
   s=>s.balances=[],s=>s.items=[],s=>s.items[0].skuId=null,s=>s.items[0].skuId='other',
   s=>s.tasks[0].sourceSkuId='sku',s=>s.tasks[0].status='IN_PROGRESS',s=>s.tasks[0].completedAt=null,
   s=>s.tasks[0].itemCount=2,s=>s.tasks[0].requestItemId='old',s=>s.tasks[0].skuId='other',
   s=>s.items[0].quantity=2,s=>s.tasks=[]
  ]){const f=setup();mutate(f.s);assert.equal(await f.run(),null);}
  const mixed=setup();mixed.s.balances.push({skuId:'other'});
  mixed.s.items.push({id:'other',skuId:'other',quantity:1});
  mixed.s.tasks.push({...mixed.s.tasks[0],requestItemId:'other',skuId:'other'});
  assert.match(await mixed.run(),/этих товаров.*2 из 2/);
 }finally{if(prior===undefined)delete process.env.WMS_FBS_COLLECTED_SKU_MESSAGE_ENABLED;
  else process.env.WMS_FBS_COLLECTED_SKU_MESSAGE_ENABLED=prior;}
});

