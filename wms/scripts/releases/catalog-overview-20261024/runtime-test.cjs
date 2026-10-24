// TEST: execute the shipped modules against in-memory fixtures, without a database.
const assert=require('node:assert/strict');require('reflect-metadata');
const root='/app/apps/api/dist/';const catalog=require(root+'modules/marketplace-connections/catalog-reconciliation');
const product=require(root+'modules/marketplace-connections/marketplace-product-links');
const lifecycle=require(root+'common/stock/wb-order-stock-lifecycle');
const {MarketplaceConnectionsService:Service}=require(root+'modules/marketplace-connections/marketplace-connections.service');
const {MarketplaceConnectionsController:Controller}=require(root+'modules/marketplace-connections/marketplace-connections.controller');
(async()=>{
 let value=false,audits=0,writes=0;const db={systemSetting:{findUnique:async()=>({value}),upsert:async()=>{writes++;value=true}},auditLog:{create:async()=>audits++},$queryRaw:async()=>[],clientMarketplaceConnection:{count:async()=>1,findUnique:async()=>({id:'conn',clientId:'client',marketplace:'OZON'})},sku:{findMany:async()=>[{id:'s',marketplaceProductId:'p',barcodes:[{value:'001'}]}]},stockBalance:{groupBy:async()=>[]}};db.$transaction=fn=>fn(db);
 const before=process.env.WMS_MARKETPLACE_PRODUCT_LINK_CLIENTS;
 assert.deepEqual(await catalog.enableCatalogReconciliation(db,'client',{id:'u',roleCodes:['ADMIN']}),{enabled:true,changed:true});
 assert.deepEqual(await catalog.enableCatalogReconciliation(db,'client',{id:'u',roleCodes:['OWNER']}),{enabled:true,changed:false});assert.equal(writes,1);assert.equal(audits,1);assert.equal(process.env.WMS_MARKETPLACE_PRODUCT_LINK_CLIENTS,before);
 await assert.rejects(()=>catalog.enableCatalogReconciliation(db,'client',{id:'u',roleCodes:['CLIENT']}));
 assert.equal((await catalog.savedCatalogCards(db,{id:'conn',clientId:'client',marketplace:'OZON'}))[0].status,'SAVED_CARD');
 db.clientMarketplaceConnection.count=async()=>2;assert.deepEqual(await catalog.savedCatalogCards(db,{id:'conn',clientId:'client',marketplace:'OZON'}),[]);
 product.productLinksEnabled=()=>true;product.readProductLinks=async()=>[{id:'l',skuId:'s',marketplace:'OZON',barcodes:['002'],status:'LINKED'}];lifecycle.wbReservationQuantities=async()=>new Map();let scope;
 const service=Object.create(Service.prototype);service.prisma=db;service.clientScopes={requireClientAccess:(...args)=>{scope=args}};service.resolveFbsExecutionWarehouseId=async()=>null;
 const result=await service.productLinks('conn',{});assert.deepEqual(result.items[0].barcodes,['002']);assert.deepEqual(result.items[0].sku.barcodes,[{value:'001'}]);assert.equal(scope[1],'client');assert.equal(scope[2],'read');
 process.env.WMS_MARKETPLACE_PRODUCT_LINKS_ENABLED='false';await assert.rejects(()=>service.enableCatalogReconciliation('conn',{id:'u',roleCodes:['ADMIN']}));assert.equal(writes,1);
 assert.equal(Reflect.getMetadata('path',Controller.prototype.enableCatalogReconciliation),':id/catalog-reconciliation/enable');
 require(root+'app.module');console.log(JSON.stringify({passed:8,databaseUsed:false,moduleGraph:true}));
})().catch(e=>{console.error(e);process.exitCode=1});
