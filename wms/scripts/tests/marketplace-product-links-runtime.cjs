// TEST: execute emitted JavaScript against the isolated local migration, never production.
const assert=require('node:assert/strict'),path=require('node:path'),{randomUUID}=require('node:crypto');
const root=process.argv[2];if(!root)throw Error('Pass compiled API directory');
const prisma=require(process.argv[3]||path.join(root,'node_modules/@prisma/client'));
const {PrismaClient}=prisma;
// Only this test process resolves the isolated generated client; do not modify shared dependencies.
const Module=require('node:module'),originalLoad=Module._load;
Module._load=function(request,parent,isMain){return request==='@prisma/client'?prisma:originalLoad.call(this,request,parent,isMain);};
const {syncProductLink,preserveLegacyProductLinks,readProductLinks}=require(path.join(root,'modules/marketplace-connections/marketplace-product-links'));
const {MarketplaceConnectionsService}=require(path.join(root,'modules/marketplace-connections/marketplace-connections.service'));
const {MarketplaceConnectionsController}=require(path.join(root,'modules/marketplace-connections/marketplace-connections.controller'));
assert.equal(Reflect.getMetadata('path',MarketplaceConnectionsController.prototype.productLinks),':id/product-links');
assert.deepEqual(Reflect.getMetadata('requiredAnyPermissions',MarketplaceConnectionsController.prototype.confirmProductLink),['clients:write','marketplace-api:write']);
const db=new PrismaClient({datasources:{db:{url:'postgresql://codex_tests@127.0.0.1:55479/postgres?schema=marketplace_links_test'}}});
(async()=>{
 const clientId=randomUUID(),skuId=randomUUID(),warehouseId=randomUUID();
 process.env.WMS_MARKETPLACE_PRODUCT_LINKS_ENABLED='true';process.env.WMS_MARKETPLACE_PRODUCT_LINK_CLIENTS=clientId;
 await db.client.create({data:{id:clientId,code:clientId,name:'TEST emitted runtime',storesWithoutBoxes:true}});
 await db.warehouse.create({data:{id:warehouseId,code:warehouseId,name:'TEST emitted'}});
 const wb=await db.clientMarketplaceConnection.create({data:{clientId,marketplace:'WILDBERRIES',apiKey:'test'}});
 await db.clientMarketplaceConnection.create({data:{clientId,marketplace:'OZON',apiKey:'test'}});
 await db.sku.create({data:{id:skuId,clientId,internalSku:skuId,name:'Physical',marketplace:'OZON',marketplaceProductId:'ozon-id',barcodes:{create:{value:'runtime-barcode'}}}});
 await db.stockBalance.create({data:{balanceKey:randomUUID(),clientId,skuId,warehouseId,status:'AVAILABLE',quantity:518}});
 await db.clientRequest.create({data:{clientId,warehouseId,type:'OUTBOUND',status:'APPROVED',title:'Ozon FBO',items:{create:{skuId,quantity:393}}}});
 await preserveLegacyProductLinks(db,clientId);
 await syncProductLink(db,wb,{productId:'123:456',offerId:'wb-offer',marketplace:'WILDBERRIES',barcodes:['runtime-barcode']},{clientId,internalSku:'not-created',name:'Not created'});
 const service=new MarketplaceConnectionsService(db,{});service.loadFbsOrders=async()=>({orders:[]});
 const result=await service.calculateFbsStockQuantities(clientId,[skuId],warehouseId,wb.id);
 assert.deepEqual(result.get(skuId),{skuId,chrtId:456,available:518,reserved:393,sellable:125});
 assert.equal((await readProductLinks(db,clientId)).length,2);
 assert.equal((await db.sku.findUnique({where:{id:skuId}})).marketplaceProductId,'ozon-id');
 assert.equal(await db.stockMovement.count({where:{clientId}}),0);
 console.log(JSON.stringify({passed:true,emittedRuntime:true,free:125,identities:2,stockMovements:0}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.$disconnect());
