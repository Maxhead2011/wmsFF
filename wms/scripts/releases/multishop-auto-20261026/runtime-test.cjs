// TEST: actual candidate modules; isolated persistence only, no production records or network.
require('reflect-metadata');
const assert=require('node:assert/strict'),path=require('node:path');
const base=process.env.RUNTIME_ROOT||path.join(process.cwd(),'dist');
const {MultishopStockGroupsService}=require(base+'/modules/marketplace-connections/multishop-stock-groups.service');
const {MultishopStockGroupsController}=require(base+'/modules/marketplace-connections/multishop-stock-groups.controller');
const {MarketplaceConnectionsModule}=require(base+'/modules/marketplace-connections/marketplace-connections.module');
const {MultishopStockSyncService}=require(base+'/modules/marketplace-connections/multishop-stock-sync.service');
const {ClientScopeService}=require(base+'/modules/auth/client-scope.service');
const {allocateShopStock}=require(base+'/modules/marketplace-connections/multishop-stock-plan');
const admin={id:'fixture',roleCodes:['ADMIN'],permissionCodes:['system:admin'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[]};
const group={id:'pair',name:'Pair',warehouseId:'msk',lowStockThreshold:2,members:[{connectionId:'wb',percent:50,priority:0},{connectionId:'ozon',percent:50,priority:1}]};
(async()=>{
 let saved=null,writes=0,audits=0,locks=0;
 const db={systemSetting:{findUnique:async()=>saved,upsert:async({create,update})=>{saved={...(saved?update:create),updatedAt:new Date()};writes++;return saved;}},clientMarketplaceConnection:{findMany:async()=>['wb','ozon'].map(id=>({id,fbsExecutionWarehouseId:'msk'}))},sku:{count:async()=>1},auditLog:{create:async()=>{audits++;}},$executeRaw:async()=>{locks++;}};db.$transaction=async fn=>fn(db);
 const service=new MultishopStockGroupsService(db,new ClientScopeService()),config={groups:[group],assignments:[{skuId:'size52',groupId:'pair'}]};
 process.env.WMS_MULTISHOP_STOCK_ENABLED='false';await assert.rejects(()=>service.read('client',admin));assert.equal(writes,0);
 process.env.WMS_MULTISHOP_STOCK_ENABLED='true';assert.equal(service.capabilities().publicationEnabled,true);
 const reader={...admin,roleCodes:['CLIENT'],permissionCodes:['clients:read'],clientScopeMode:'LIMITED',clientIds:['client']};await assert.rejects(()=>service.save('client',{revision:null,config},reader));await assert.rejects(()=>service.read('other',reader));
 const first=await service.save('client',{revision:null,config},admin);assert(first.revision);assert.equal(writes,1);assert.equal(audits,1);assert.equal(locks,1);
 await assert.rejects(()=>service.save('client',{revision:null,config},admin));assert.equal(writes,1);
 await assert.rejects(()=>service.save('client',{revision:first.revision,config:{...config,assignments:[...config.assignments,...config.assignments]}},admin));assert.equal(writes,1);
 for(let amount=0;amount<100;amount++)assert.equal(allocateShopStock(amount,group).reduce((sum,r)=>sum+r.amount,0),amount);
 assert(Reflect.getMetadata('providers',MarketplaceConnectionsModule).includes(MultishopStockGroupsService));assert(Reflect.getMetadata('controllers',MarketplaceConnectionsModule).includes(MultishopStockGroupsController));
 assert(Reflect.getMetadata('providers',MarketplaceConnectionsModule).includes(MultishopStockSyncService));
 assert.equal(Reflect.getMetadata('design:paramtypes',MultishopStockGroupsController)[1],MultishopStockSyncService);
 const params=Reflect.getMetadata('design:paramtypes',MultishopStockGroupsService);assert.equal(params[1].name,'ClientScopeService');
 console.log(JSON.stringify({passed:8,isolatedPersistence:true,publicationEnabled:true}));
})().catch(e=>{console.error(e);process.exitCode=1});
