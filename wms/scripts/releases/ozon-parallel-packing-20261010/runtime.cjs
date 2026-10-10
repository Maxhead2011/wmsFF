// TEST: actual deployed snapshot, with a partial Ozon pick and unchanged direction quotas.
const {test}=require('node:test'),assert=require('node:assert/strict');
const root='/app/apps/api/dist/modules/tsd/';
const availability=require(root+'fbo-fbs-reservations');availability.loadFboFbsAvailability=async()=>({free:()=>0,take:()=>{}});
const route=require(root+'fbo-request-route');route.loadFboRoutePreference=async()=>null;
const {FboTwoStageService:S}=require(root+'fbo-two-stage.service');
for(const enabled of [true,false])test('partial Ozon pick, flag '+enabled,async()=>{
 process.env.WMS_FBO_PARALLEL_PACKING_ENABLED=String(enabled);process.env.WMS_OZON_FBO_IMPORT_ENABLED='true';process.env.WMS_RECEIPT_STOCK_INDEX_ENABLED='true';
 const directions=[{name:'Ozon destination',items:[{skuId:'sku',barcode:'code',quantity:2}]}];
 const tx={ozonFboShipment:{findUnique:async()=>({directions})},fboAssembly:{findUnique:async()=>({phase:'PICKING',units:[{id:'u',requestItemId:'i',skuId:'sku',state:'PICKED'}],boxes:[]})},user:{findMany:async()=>[]},box:{findMany:async()=>[]}};
 const s=new S(tx,{},{});s.busyBoxes=async()=>new Set();
 const p=await s.snapshot(tx,{id:'r',clientId:'c',warehouseId:'w',client:{},items:[{id:'i',skuId:'sku',barcode:'code',quantity:2,sku:{name:'Item'}}]});
 assert.equal(p.parallelPackingSupported,enabled);assert.equal(p.marketplace,'OZON');assert.equal(p.phase,'PICKING');assert.equal(p.picked,1);assert.equal(p.needed,2);assert.equal(p.packed,0);assert.equal(p.directions[0].needed,2);
 const {assertDirectionCapacity}=require(root+'ozon-fbo-directions');assert.throws(()=>assertDirectionCapacity(directions,[],[],undefined,[]));assert.throws(()=>assertDirectionCapacity(directions,[],[],'Ozon destination',[{skuId:'sku'},{skuId:'sku'},{skuId:'sku'}]));
});
