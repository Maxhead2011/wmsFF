// TEST: exact compiled runtime, synthetic receipt/cut and real read-only fabric analytics. No business writes.
require('/app/apps/api/node_modules/reflect-metadata');
const assert=require('node:assert/strict'),{createRequire}=require('node:module'),req=createRequire('/app/apps/api/dist/main.js');
const {addFabricMaterial,addFabricColor,createFabricBinding}=req('./modules/warehouse/fabric-catalog');
const {applyRollAction,fabricSku}=req('./modules/warehouse/fabric-rolls');
const {fabricMaterialAvailability}=req('./modules/warehouse/fabric-fbs-availability');
const {identifyFulfillmentProduct}=req('./modules/analytics/fulfillment-groups');
const made=addFabricMaterial([],'Фатин'),color=addFabricColor([],made.material.id,'Пудровый',made.materials),binding=createFabricBinding(color.colors,made.material.id,color.color.id,3000,made.materials);
const dto={action:'RECEIVE',material:made.material.id,color:color.color.id,count:1};
assert.throws(()=>applyRollAction({rolls:[]},dto,null,'w'));
const received=applyRollAction({rolls:[],catalogMaterials:made.materials,catalogColors:color.colors},dto,null,'w');assert.equal(received.rolls[0].remainingMm,100000);
const sku={id:'test',name:'Фатин 3 м',internalSku:'custom',marketplacePayload:{fabricRollBinding:binding},barcodes:[]};
const cut=applyRollAction(received,{action:'CUT',rollId:received.rolls[0].id,count:2},fabricSku(sku),'w');assert.equal(cut.rolls[0].remainingMm,94000);assert.equal(received.rolls[0].remainingMm,100000);
assert.equal(fabricMaterialAvailability(cut,sku,'w',1).available,true);assert.equal(fabricMaterialAvailability(cut,sku,'other',1).available,false);
assert.equal(identifyFulfillmentProduct({...sku,skuId:sku.id,article:sku.internalSku,color:null,size:null}).model,'Фатин');
const {PrismaClient}=req('@prisma/client'),{ClientScopeService}=req('./modules/auth/client-scope.service'),{FulfillmentAnalyticsService}=req('./modules/analytics/fulfillment.service');
const p=new PrismaClient();
(async()=>{try{
 process.env.WMS_FULFILLMENT_ANALYTICS_ENABLED='true';const service=new FulfillmentAnalyticsService(p,new ClientScopeService());
 const clients=await p.$queryRawUnsafe(`SELECT id,name FROM "Client" WHERE "isDemo"=false AND name ~* '(Бушков|Хрупов)' ORDER BY name`);assert(clients.length>=2);
 const results=[];
 for(const c of clients){const user={id:'readonly-check',roleCodes:['CLIENT'],permissionCodes:[],clientScopeMode:'LIMITED',clientIds:[c.id],writableClientIds:[],isDemo:false};
  for(const w of (await service.clients(user))[0].warehouses)for(const channel of ['FBS','FBO']){
   const report=await service.dashboard({clientId:c.id,warehouseId:w.id,channel,dateFrom:'2026-08-27',dateTo:'2026-11-24'},user);
   for(const level of Object.values(report.groups))for(const field of ['shippedUnits','currentUnits','freeUnits'])assert.equal(level.reduce((n,x)=>n+x[field],0),report.summary[field]);
   const fabrics=report.groups.model.filter(x=>x.shippedMetres!==null);results.push({client:c.name,channel,sku:report.items.length,units:report.summary.shippedUnits,fabrics:fabrics.map(x=>({name:x.name,skus:x.skuCount,units:x.shippedUnits,metres:x.shippedMetres}))});
  }
 }
 assert(results.some(r=>r.fabrics.some(f=>f.name==='Атлас / сатин')));
 console.log(JSON.stringify({passed:true,readOnly:true,newMaterialReceiptCut:true,unknownMaterialRejected:true,materialWarehouseIsolation:true,results}));
}finally{await p.$disconnect();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
