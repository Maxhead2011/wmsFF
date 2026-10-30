// TEST: actual candidate modules, real authorization rules and unchanged denial for internal users.
require('reflect-metadata');const assert=require('node:assert/strict');
const {ClientScopeService}=require('/app/apps/api/dist/modules/auth/client-scope.service');
const {OzonStockAdjustmentService}=require('/app/apps/api/dist/modules/tsd/ozon-stock-adjustment.service');
const {OzonAssemblySupplyService}=require('/app/apps/api/dist/modules/client-requests/ozon-assembly-supply.service');
const {OzonStockAdjustmentController}=require('/app/apps/api/dist/modules/tsd/ozon-stock-adjustment.controller');
const {REQUIRED_PERMISSIONS_KEY}=require('/app/apps/api/dist/modules/auth/decorators/require-permissions.decorator');
(async()=>{process.env.WMS_OZON_FBO_IMPORT_ENABLED='true';let passed=0;
const db={ozonFboShipment:{findUnique:async()=>({request:{clientId:'c',warehouseId:'w'},integration:null})}},scope=new ClientScopeService();
const customer={id:'test',roleCodes:['CLIENT'],permissionCodes:['client-requests:write'],activeWarehouseId:null,clientScopeMode:'LIMITED',clientIds:['c'],writableClientIds:['c']};
for(const kind of ['adjustment','binding']){
 const svc=kind==='adjustment'?new OzonStockAdjustmentService(db,scope,{},{}):new OzonAssemblySupplyService(db,scope),load=u=>kind==='adjustment'?svc.load(db,'r',u):svc.load('r',u,'write',db);
 assert.equal((await load(customer)).request.warehouseId,'w');passed++;
 await assert.rejects(()=>load({...customer,writableClientIds:[]}));passed++;
 await assert.rejects(()=>load({...customer,clientIds:['other'],writableClientIds:['other']}));passed++;
 await assert.rejects(()=>load({...customer,roleCodes:['BRANCH_MANAGER'],activeWarehouseId:'other',warehouseIds:['other'],writableWarehouseIds:['other'],permissionCodes:['stock:write']}));passed++;
}
const svc=new OzonStockAdjustmentService(db,scope,{},{});await assert.rejects(()=>svc.load(db,'r',{...customer,roleCodes:['STAFF'],activeWarehouseId:'w'}));passed++;
assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY,OzonStockAdjustmentController),['client-requests:write']);passed++;
require('/app/apps/api/dist/app.module');passed++;
console.log(JSON.stringify({passed,actualRuntime:true}));
})().catch(e=>{console.error(e);process.exit(1)});
