// TEST: read-only production dataset through the exact compiled service, including client scope.
const assert=require('assert/strict'),{createRequire}=require('module'),path=require('path');const dist=process.argv[2],req=createRequire(path.join(dist,'main.js'));
const {PrismaClient}=req('@prisma/client'),{FulfillmentAnalyticsService}=req(dist+'/modules/analytics/fulfillment.service'),{ClientScopeService}=req(dist+'/modules/auth/client-scope.service');
process.env.WMS_FULFILLMENT_ANALYTICS_ENABLED='true';const p=new PrismaClient();
(async()=>{try{const all=await p.client.findMany({where:{isDemo:false},select:{id:true,status:true}}),expected=all.filter(c=>c.status!=='ARCHIVED').map(c=>c.id).sort();
 const user={id:'read-only-verification',roleCodes:['OWNER'],permissionCodes:['system:admin'],clientScopeMode:'ALL',clientIds:[],warehouseIds:[],isDemo:false};
 const service=new FulfillmentAnalyticsService(p,new ClientScopeService()),rows=await service.clients(user);assert.deepEqual(rows.map(c=>c.id).sort(),expected);
 const active=all.find(c=>c.status!=='ARCHIVED'),archived=all.find(c=>c.status==='ARCHIVED');assert(active&&archived);
 const limited=await service.clients({...user,roleCodes:['CLIENT'],permissionCodes:[],clientScopeMode:'LIMITED',clientIds:[active.id,archived.id]});assert.deepEqual(limited.map(c=>c.id),[active.id]);
 console.log(JSON.stringify({passed:true,readOnly:true,total:all.length,archived:all.length-rows.length,visible:rows.length,limitedScopePreserved:true}));
}finally{await p.$disconnect();}})().catch(e=>{console.error(e);process.exitCode=1});
