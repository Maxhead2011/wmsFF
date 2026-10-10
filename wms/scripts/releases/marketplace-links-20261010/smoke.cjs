const assert=require('assert/strict');const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();const root='/app/apps/api/dist';
const {productLinksEnabled,readProductLinks,wbLinkedSkus}=require(root+'/modules/marketplace-connections/marketplace-product-links');
const {MarketplaceConnectionsController:C}=require(root+'/modules/marketplace-connections/marketplace-connections.controller');
(async()=>{const cid='c401202c-be57-4310-9939-2ea36767da37';assert(productLinksEnabled(cid));assert(!productLinksEnabled('other-client'));assert.equal(Reflect.getMetadata('path',C.prototype.productLinks),':id/product-links');
 const links=await readProductLinks(db,cid);assert(links.some(l=>l.marketplace==='WILDBERRIES'&&l.status==='LINKED'));assert(links.some(l=>l.marketplace==='OZON'&&l.status==='LINKED'));
 const common=links.filter(l=>l.marketplace==='WILDBERRIES'&&l.status==='LINKED'&&links.some(o=>o.marketplace==='OZON'&&o.skuId===l.skuId));assert(common.length>0);
 const rows=await wbLinkedSkus(db,cid,common[0].connectionId,[{id:common[0].skuId}]);assert.equal(rows[0].marketplaceProductId,common[0].productId);
 console.log(JSON.stringify({passed:true,links:links.length,sharedSku:common.length,readOnly:true}));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.$disconnect());
