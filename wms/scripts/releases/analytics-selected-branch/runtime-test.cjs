// TEST: real production links, independent expected sets, both branches and limited client access; read-only.
const assert=require('assert/strict'),{createRequire}=require('module'),path=require('path');const dist=process.argv[2],req=createRequire(path.join(dist,'main.js'));
const {PrismaClient}=req('@prisma/client'),{FulfillmentAnalyticsService}=req(dist+'/modules/analytics/fulfillment.service'),{ClientScopeService}=req(dist+'/modules/auth/client-scope.service');
process.env.WMS_FULFILLMENT_ANALYTICS_ENABLED='true';const p=new PrismaClient();
(async()=>{try{
 const branches=await p.warehouse.findMany({where:{city:{in:['Москва','Ногинск']}},select:{id:true,name:true,city:true}});assert(branches.some(b=>b.city==='Ногинск')&&branches.some(b=>b.city==='Москва'));
 const clients=await p.client.findMany({where:{isDemo:false},select:{id:true,status:true}}),links=await p.warehouseClient.findMany({select:{clientId:true,warehouseId:true,status:true}});
 const user={id:'read-only-verification',roleCodes:['OWNER'],permissionCodes:['system:admin'],clientScopeMode:'ALL',clientIds:[],warehouseIds:[],isDemo:false},service=new FulfillmentAnalyticsService(p,new ClientScopeService()),proof=[];
 for(const b of [...branches,branches[0]]){
  const expected=clients.filter(c=>c.status!=='ARCHIVED'&&links.some(l=>l.clientId===c.id&&l.warehouseId===b.id&&l.status==='ACTIVE')).map(c=>c.id).sort();
  const rows=await service.clients({...user,activeWarehouseId:b.id});assert.deepEqual(rows.map(c=>c.id).sort(),expected);assert(rows.every(c=>c.warehouses.length===1&&c.warehouses[0].id===b.id));
  const limited=await service.clients({...user,roleCodes:['CLIENT'],permissionCodes:[],clientScopeMode:'LIMITED',clientIds:expected.slice(0,1),activeWarehouseId:b.id});assert.deepEqual(limited.map(c=>c.id),expected.slice(0,1));
  proof.push({id:b.id,city:b.city,name:b.name,visible:rows.length});
 }
 console.log(JSON.stringify({passed:true,readOnly:true,branches:proof,limitedScopePreserved:true}));
}finally{await p.$disconnect();}})().catch(e=>{console.error(e);process.exitCode=1});
