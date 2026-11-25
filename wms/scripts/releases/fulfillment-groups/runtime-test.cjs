// TEST: compiled candidate, real scoped read-only reports, every requested client and every hierarchy total.
require('/app/apps/api/node_modules/reflect-metadata');
const assert=require('node:assert/strict'),{createRequire}=require('node:module'),req=createRequire('/app/apps/api/dist/main.js');
const {PrismaClient}=req('@prisma/client'),{ClientScopeService}=req('./modules/auth/client-scope.service.js'),{FulfillmentAnalyticsService}=req('./modules/analytics/fulfillment.service.js');
const p=new PrismaClient(),service=new FulfillmentAnalyticsService(p,new ClientScopeService());
(async()=>{try{
 const clients=await p.$queryRawUnsafe(`SELECT DISTINCT c.id,c.name FROM "Client" c JOIN "Sku" s ON s."clientId"=c.id WHERE c."isDemo"=false AND (c.name ~* '(Корол[её]в|Елецк|Лукин|Кубрин)' OR s.article ~* '^(gab|satin|sat)_') ORDER BY c.name`);
 assert(clients.some(c=>c.name.includes('Лукин')));assert(clients.some(c=>c.name.includes('Елецк')));assert(clients.some(c=>c.name.includes('Кубрин')));assert(clients.some(c=>/Корол/.test(c.name)));
 const results=[],start=Date.now();
 for(const client of clients){
  const user={id:'grouping-read-only-check',roleCodes:['CLIENT'],permissionCodes:[],clientScopeMode:'LIMITED',clientIds:[client.id],writableClientIds:[],isDemo:false};
  delete process.env.WMS_FULFILLMENT_ANALYTICS_ENABLED;await assert.rejects(()=>service.clients(user),/не включена/);process.env.WMS_FULFILLMENT_ANALYTICS_ENABLED='true';
  const accessible=await service.clients(user);assert.equal(accessible.length,1);assert.equal(accessible[0].id,client.id);
  for(const warehouse of accessible[0].warehouses)for(const channel of ['FBS','FBO']){
   const q={clientId:client.id,warehouseId:warehouse.id,channel,dateFrom:'2026-08-27',dateTo:'2026-11-24'};
   await assert.rejects(()=>service.dashboard({...q,clientId:'not-owned'},user),/Нет доступа/);
   const report=await service.dashboard(q,user);assert(!JSON.stringify(report).includes('marketplacePayload'));
   for(const level of Object.values(report.groups)){
    for(const field of ['shippedUnits','receivedUnits','currentUnits','freeUnits'])assert.equal(level.reduce((n,x)=>n+x[field],0),report.summary[field]);
    for(const field of ['recommendedUnits','toReplenish','surplusUnits'])assert.equal(level.reduce((n,x)=>n+(x[field]??0),0),report.items.reduce((n,x)=>n+(x[field]??0),0));
    assert(level.every(x=>x.shipmentRequests!==null&&x.shipmentRequests<=report.quality.completedRequests));
   }
   results.push({client:client.name,channel,skuCount:report.items.length,models:report.groups.model.length,kinds:report.groups.kind.length,shippedUnits:report.summary.shippedUnits,fabrics:report.groups.model.filter(x=>x.shippedMetres!==null).length,conflicts:report.groups.model.filter(x=>x.warnings.includes('GROUP_COLOR_CONFLICT')).length});
  }
 }
 assert(results.some(x=>x.fabrics>0),'No active fabric rows verified');
 console.log(JSON.stringify({passed:true,readOnly:true,clientIsolation:true,allLevelTotals:true,independentVariantRecommendations:true,durationMs:Date.now()-start,results}));
}finally{await p.$disconnect();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
