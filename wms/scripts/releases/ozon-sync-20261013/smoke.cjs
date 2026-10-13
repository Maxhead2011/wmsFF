// TEST: candidate runtime, mocked writes plus read-only live preview.
const assert=require('node:assert/strict');
const {Logger}=require('/app/apps/api/node_modules/@nestjs/common');Logger.overrideLogger(false);
const {OzonStockAdjustmentService}=require('/app/apps/api/dist/modules/tsd/ozon-stock-adjustment.service');
const {OzonAssemblySupplyService}=require('/app/apps/api/dist/modules/client-requests/ozon-assembly-supply.service');
const {PrismaClient}=require('/app/apps/api/node_modules/@prisma/client');
(async()=>{
 const link={connectionId:'c',orderId:'123',orderNumber:'123',state:'DATA_FILLING',mapping:{A:'42'},operations:{},supplies:[{id:'42',name:'A',items:[{barcode:'123',quantity:3,sku:'99',quant:1}]}]};
 const s={requestId:'r',integration:link,directions:[{name:'A',items:[{skuId:'s',barcode:'123',quantity:2}]}],request:{id:'r',status:'IN_WORK',clientId:'c',warehouseId:'w',items:[{id:'i',skuId:'s',barcode:'123',quantity:2}],fboAssembly:{phase:'PACKING',units:[{id:'u',skuId:'s',state:'PACKED',targetBoxId:'box'}],boxes:[{id:'b',boxId:'box',direction:'A'}]}}};
 let writes=0,phase=null;const db={ozonFboShipment:{findUnique:async()=>structuredClone(s),update:async({data})=>{writes++;Object.assign(s,data)}},clientMarketplaceConnection:{findFirst:async()=>({id:'c',apiKey:'fixture'})},sku:{findMany:async()=>[{id:'s',name:'Dress',barcodes:[{value:'123'}]}]},clientRequestItem:{update:async({data})=>{writes++;return Object.assign(s.request.items[0],data)}},fboAssembly:{update:async({data})=>{phase=data.phase}},auditLog:{create:async()=>{}},$queryRaw:async()=>{}};db.$transaction=async f=>f(db);
 const remote=structuredClone(link),ozon={snapshot:async()=>structuredClone(remote),call:async(c,path)=>{assert.equal(path,'/v1/cargoes/supplies/get');return {supplies_cargoes:[{supply_id:42}]}}};
 const svc=new OzonStockAdjustmentService(db,{requireClientAccess(){}},{},ozon),user={id:'u',permissionCodes:['system:admin'],activeWarehouseId:'w'};
 const p=await svc.syncPreview('r',user);assert.equal(writes,0);assert.equal(p.after,3);
 remote.supplies[0].items[0].quantity=4;await assert.rejects(()=>svc.syncApply('r',{token:p.token,confirm:true},user));assert.equal(writes,0);
 remote.supplies[0].items[0].quantity=3;await svc.syncApply('r',{token:p.token,confirm:true},user);assert.equal(s.request.items[0].quantity,3);assert.equal(s.request.fboAssembly.units[0].id,'u');assert.equal(phase,'PICKING');
 const live=new PrismaClient();let preview;
 try{const request=await live.clientRequest.findUnique({where:{id:'f07a4c72-8adc-4a9a-ac03-47cc840ee191'}});assert(request);const service=new OzonStockAdjustmentService(live,{requireClientAccess(){}},{},new OzonAssemblySupplyService(live,{}));preview=await service.syncPreview(request.id,{id:'b045e060-dfd7-48af-bb88-12c191ee8eae',permissionCodes:['system:admin'],activeWarehouseId:request.warehouseId});assert(preview.after>0);}finally{await live.$disconnect();}
 console.log(JSON.stringify({passed:true,runtimeCases:3,liveReadOnly:true,businessWrites:false,needed:preview.needed,after:preview.after,rows:preview.rows.length}));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
