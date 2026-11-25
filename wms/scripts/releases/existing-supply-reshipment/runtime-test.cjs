// TEST: read-only real WB membership/status and local preview through the exact compiled candidate.
const assert=require('assert/strict'),{createRequire}=require('module'),path=require('path');const dist=process.argv[2],req=createRequire(path.join(dist,'main.js'));
const {PrismaClient}=req('@prisma/client'),{FbsReshipmentService}=req(dist+'/modules/marketplace-connections/fbs-reshipment.service'),{ClientScopeService}=req(dist+'/modules/auth/client-scope.service');
const p=new PrismaClient();process.env.WMS_FBS_RESHIPMENT_ENABLED='true';
(async()=>{try{
 const connection=await p.clientMarketplaceConnection.findUniqueOrThrow({where:{id:'cffe0d2d-accc-4edc-aa56-aef92e1a7b54'}}),clientId=connection.clientId;
 async function read(url,body){const r=await fetch('https://marketplace-api.wildberries.ru'+url,{method:body?'POST':'GET',headers:{Authorization:connection.apiKey,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});assert(r.ok,'WB '+r.status);return r.json();}
 const wb={readReshipmentWbSupply:async(c,con,id)=>{assert.equal(c,clientId);assert.equal(con,connection.id);const s=await read('/api/v3/supplies/'+id),m=await read('/api/marketplace/v3/supplies/'+id+'/order-ids');return {id:s.id,done:s.done,orderIds:m.orderIds.map(String)};},readReshipmentWbStatuses:async(c,con,ids)=>{assert.equal(c,clientId);assert.equal(con,connection.id);const r=await read('/api/v3/orders/status',{orders:ids.map(Number)});return new Map(r.orders.map(o=>[String(o.id),o]));}};
 const user={id:'read-only-preview',roleCodes:['OWNER'],permissionCodes:['system:admin'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],activeWarehouseId:'afb244a1-50ae-4ae6-9111-afe85949fa58',writableWarehouseIds:[],isDemo:false};
 const dto={clientId,existingSupplyId:'WB-GI-320629696',mode:'NEW_ITEM',orders:['6333591339','6317973454','6318076875','6351037069','6317866670'].map(id=>({id,connectionId:connection.id}))};
 const service=new FbsReshipmentService(p,new ClientScopeService(),wb),preview=await service.preview(dto,user);assert.equal(preview.orderCount,5);assert.equal(preview.additionalUnits,5);
 console.log(JSON.stringify({passed:true,readOnly:true,preview}));
}finally{await p.$disconnect();}})().catch(e=>{console.error(e.message);process.exitCode=1});
