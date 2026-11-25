// TEST: actual candidate controller/service/helper; no application startup or production data.
const assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(process.argv[2]),dir=path.join(root,'modules/marketplace-connections');
require(require.resolve('reflect-metadata',{paths:[root]}));
for(const name of ['marketplace-connections.controller','marketplace-connections.service','ozon-print-preparation','fbs-fabric-queue','ozon-fbs-pick-workflow']){
 const result=spawnSync(process.execPath,['--check',path.join(dir,name+'.js')],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
}
const {MarketplaceConnectionsService:S}=require(path.join(dir,'marketplace-connections.service.js'));
const {MarketplaceConnectionsController:C}=require(path.join(dir,'marketplace-connections.controller.js'));
const helper=require(path.join(dir,'ozon-print-preparation.js'));
process.env.WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED='true';
const settings=new Map(),calls=[];let status='awaiting_packaging';
const db={
 $queryRaw:async()=>[{locked:true}],
 clientMarketplaceConnection:{findMany:async()=>[{id:'c',marketplace:'OZON',sellerId:'s',apiKey:'fixture'}]},
 fbsOrderRequestLink:{findMany:async()=>[{requestId:'r',connectionId:'c',orderId:'o',syncStatus:'ACTIVE',request:{status:'SUBMITTED',warehouseId:'w'}}]},
 systemSetting:{findUnique:async({where})=>settings.get(where.key),upsert:async({where,create})=>settings.set(where.key,{value:create.value})},
 auditLog:{create:async()=>{}},
};
db.$transaction=async fn=>fn(db);
global.fetch=async(url)=>{
 calls.push(url);
 const data=url.endsWith('/get')?{result:{posting_number:'o',status,products:[{sku:42,quantity:2}],requirements:{}}}:{result:[{posting_number:'o'}]};
 if(url.endsWith('/ship'))status='awaiting_deliver';
 return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
};
(async()=>{
 const service=new S(db,{requireClientAccess(_user,id,mode){assert.equal(id,'client');assert.equal(mode,'write');}});
 const dto={clientId:'client',orders:[{connectionId:'c',id:'o'}]},user={id:'operator',activeWarehouseId:'w'};
 assert.equal(Reflect.getMetadata('path',C.prototype.prepareOzonLabels),'fbs/orders/prepare-labels');
 assert.equal((await C.prototype.prepareOzonLabels.call({connections:service},dto,user)).prepared,1);
 assert.equal((await service.prepareOzonLabels(dto,user)).prepared,1);
 assert.equal(calls.filter(url=>url.endsWith('/ship')).length,1);
 assert.equal(await helper.isOzonPrintPrepared(db,'client','c','o',{status,products:[{sku:42,quantity:2}]},'r'),true);
 assert.equal(await helper.isOzonPrintPrepared(db,'client','c','o',{status:'delivered',products:[{sku:42,quantity:2}]},'r'),false);
 process.env.WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED='false';
 await assert.rejects(service.prepareOzonLabels(dto,user));
 console.log('PASS: candidate route/service, first/repeat print, subsequent picking, delivered exclusion, sold isolation; no stock/task writer');
})().catch(e=>{console.error(e);process.exitCode=1});
