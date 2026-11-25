// TEST: actual catalog aliases and FBS/FBO totals on the exact compiled candidate; read-only.
const assert=require('assert/strict'),path=require('path'),root=process.argv[2]||'/app/apps/api/dist';
const {PrismaClient}=require(require.resolve('@prisma/client',{paths:[root]}));
const {identifyFulfillmentProduct:identify}=require(path.join(root,'modules/analytics/fulfillment-groups'));
const {FulfillmentAnalyticsService}=require(path.join(root,'modules/analytics/fulfillment.service'));
const {ClientScopeService}=require(path.join(root,'modules/auth/client-scope.service'));
const p=new PrismaClient();
(async()=>{try{
 process.env.WMS_FULFILLMENT_ANALYTICS_ENABLED='true';
 const rows=await p.sku.findMany({where:{clientId:'1757a389-c0d4-49b5-9347-2bde0c549260',article:{in:['champagne','ivory'].flatMap(c=>[1,3,5,10,20,30,50].map(n=>`${c}_${n}`))}},select:{id:true,clientId:true,name:true,article:true,color:true,size:true,brand:true,category:true,marketplacePayload:true}});
 assert.equal(rows.length,14);const identities=rows.map(s=>identify({...s,skuId:s.id}));
 assert.equal(new Set(identities.map(x=>x.modelKey)).size,1);assert.equal(new Set(identities.map(x=>x.colorKey)).size,1);assert.equal(new Set(identities.map(x=>x.sizeKey)).size,7);assert(identities.every(x=>x.color==='Шампань / айвори'));
 const service=new FulfillmentAnalyticsService(p,new ClientScopeService()),user={id:'readonly-check',roleCodes:['CLIENT'],permissionCodes:[],clientScopeMode:'LIMITED',clientIds:[rows[0].clientId],writableClientIds:[],isDemo:false},reports=[];
 for(const w of (await service.clients(user))[0].warehouses)for(const channel of ['FBS','FBO']){
  const report=await service.dashboard({clientId:rows[0].clientId,warehouseId:w.id,channel,dateFrom:'2026-08-27',dateTo:'2026-11-24'},user);
  for(const level of Object.values(report.groups))for(const field of ['shippedUnits','receivedUnits','currentUnits','freeUnits'])assert.equal(level.reduce((n,x)=>n+x[field],0),report.summary[field]);
  assert(!report.groups.model.some(x=>/^champagne_/.test(x.name)));
  const color=report.groups.color.find(x=>x.skuId===identities[0].colorKey);
  reports.push({channel,skus:report.items.length,units:report.summary.shippedUnits,colorSkus:color?.skuCount,color:color?.color,children:color?.children.length});
 }
 assert(reports.some(x=>x.colorSkus>=14));console.log(JSON.stringify({passed:true,readOnly:true,aliases:14,colorGroups:1,lengthGroups:7,reports}));
}finally{await p.$disconnect();}})().catch(e=>{console.error(e.message);process.exitCode=1});
