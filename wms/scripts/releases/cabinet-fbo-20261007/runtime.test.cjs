const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.env.RUNTIME_ROOT||'/app/apps/api/dist';
require('reflect-metadata');
const {ClientRequestsService}=require(root+'/modules/client-requests/client-requests.service');
const {StockBalancesService}=require(root+'/modules/stock/stock-balances.service');
const {StockController}=require(root+'/modules/stock/stock.controller');
const {CabinetStockExportDto}=require(root+'/modules/stock/dto/cabinet-stock-export.dto');
// TEST: exercise the actual deployment modules rather than a second source compilation.
test('audit route keeps authenticated request metadata and exact six columns',async()=>{
 process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED='true';
 let write;
 const svc=new StockBalancesService({auditLog:{create:async x=>(write=x,{id:'a',createdAt:new Date()})}},{requireClientAccess:()=>{}});
 const dto={clientId:'c',fileName:'stock.xls',generatedAt:new Date().toISOString(),filters:{search:'blue',section:'stock',scope:'all_filtered_rows'},rows:[{name:'Suit',article:'A',barcode:'123',color:'blue',size:'M',quantity:4}]};
 const {plainToInstance}=require('class-transformer'),{validate}=require('class-validator');
 assert.deepEqual(await validate(plainToInstance(CabinetStockExportDto,dto),{whitelist:true,forbidNonWhitelisted:true}),[]);
 assert.equal(Reflect.getMetadata('path',StockController.prototype.recordCabinetExport),'cabinet-export-audit');
 assert.equal(Reflect.getMetadata('design:paramtypes',StockController.prototype,'recordCabinetExport')[0],CabinetStockExportDto);
 await svc.recordCabinetExport(dto,{id:'u',name:'Manager'},{ip:'192.0.2.2',userAgent:'test'});
 assert.deepEqual(write.data.payload.rows,dto.rows);assert.equal(write.data.payload.ipAddress,'192.0.2.2');assert.equal(write.data.payload.totalQuantity,4);
 process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED='false';write=null;assert.deepEqual(await svc.recordCabinetExport(dto,{id:'u'},{}),{recorded:false});assert.equal(write,null);
});
test('recent confirmed receipt is capped by real balance; reserves counted once',async()=>{
 process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED='true';process.env.WMS_RECEIPT_CHANNELS_ENABLED='false';
 let query;
 const db={client:{findUniqueOrThrow:async()=>({stockBalanceMode:'PALLET_SORT'})},stockBalance:{groupBy:async()=>[{boxId:'b',skuId:'s',_sum:{quantity:2}},{boxId:'old',skuId:'s',_sum:{quantity:20}}]},stockMovement:{groupBy:async x=>(query=x,[{boxId:'b',skuId:'s',_sum:{quantity:3}}])}};
 const svc=new ClientRequestsService(db,{requireClientAccess:()=>{}},{});
 assert.deepEqual(await svc.pendingPlacementBySkuId('c',['s'],'w'),new Map([['s',2]]));
 assert.equal(query.where.type,'RECEIPT');assert.equal(query.where.createdAt.lte-query.where.createdAt.gte,7*86400000);
 svc.resolveRequestWarehouse=async()=> 'w';svc.isPrimaryMoscowWarehouse=async()=>false;svc.resolveAvailabilityItems=async()=>[{index:0,skuId:'s',requestedQuantity:5}];svc.stockQuantityBySkuId=async()=>new Map([['s',2]]);svc.pendingPlacementBySkuId=async()=>new Map([['s',4]]);svc.activeReservationBySkuId=async()=>new Map([['s',{quantity:3,requests:[]}]]);
 const result=await svc.previewAvailability({clientId:'c',type:'OUTBOUND',items:[{skuId:'s',quantity:5}]},{});
 assert.equal(result.canCommit,false);assert.equal(result.lines[0].availableQuantity,3);assert.equal(result.lines[0].pendingPlacementQuantity,3);assert.equal(result.lines[0].shortageQuantity,2);
});
test('current runtime preserves packing capabilities and routes after placement',async()=>{
 process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED='true';
 require(root+'/modules/tsd/fbo-fbs-reservations').loadFboFbsAvailability=async()=>({free:()=>3,take:()=>{}});
 require(root+'/modules/tsd/fbo-request-route').loadFboRoutePreference=async()=>null;
 const {FboTwoStageService}=require(root+'/modules/tsd/fbo-two-stage.service');
 const box={id:'box',code:'FFL_LKB0610_1',balances:[{skuId:'s',status:'AVAILABLE',quantity:3}],productMarks:[],storagePlacement:null};
 const tx={fboAssembly:{findUnique:async()=>null},user:{findMany:async()=>[]},box:{findMany:async()=>[box]}};
 const svc=new FboTwoStageService(tx,{},{},{},{},{});svc.busyBoxes=async()=>new Set();
 const req={id:'r',clientId:'c',warehouseId:'w',client:{stockBalanceMode:'PALLET_SORT'},items:[{id:'i',skuId:'s',barcode:'123',quantity:3,sku:{name:'Suit'}}]};
 const waiting=await svc.snapshot(tx,req);assert.equal(waiting.route.length,0);assert.equal(waiting.pendingPlacementQuantity,3);assert.equal(waiting.shortage,0);assert.ok('manualPackingEnabled' in waiting);assert.ok('remainderTransferEnabled' in waiting);
 box.storagePlacement={pallet:{code:'PALET_SORT_1'}};
 const ready=await svc.snapshot(tx,req);assert.equal(ready.pendingPlacementQuantity,0);assert.equal(ready.route.length,1);assert.equal(ready.route[0].pallet,'PALET_SORT_1');
});
