const fs=require('fs'),assert=require('assert/strict');const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();
const cid='c401202c-be57-4310-9939-2ea36767da37',root='/app/apps/api/dist';
const {MarketplaceConnectionsService}=require(root+'/modules/marketplace-connections/marketplace-connections.service');
const {preserveLegacyProductLinks,syncProductLink,readProductLinks,productLinkCandidate}=require(root+'/modules/marketplace-connections/marketplace-product-links');
process.env.WMS_MARKETPLACE_PRODUCT_LINKS_ENABLED='true';process.env.WMS_MARKETPLACE_PRODUCT_LINK_CLIENTS=cid;
(async()=>{
 const sql=fs.readFileSync('/test/migration.sql','utf8');await db.$transaction(async tx=>{for(const s of sql.split(';').map(s=>s.trim()).filter(Boolean))await tx.$executeRawUnsafe(s);},{timeout:60000});
 const conn=await db.clientMarketplaceConnection.findUniqueOrThrow({where:{id:'93ac9eae-1eb9-4db1-bbcd-f4ea941c3343'}});assert.equal(conn.clientId,cid);assert.equal(conn.isActive,true);
 const service=new MarketplaceConnectionsService(db,{});const products=await service.fetchMarketplaceProducts(conn);
 const skus=await db.sku.findMany({where:{clientId:cid},include:{barcodes:true}});
 // Release initialization only links existing SKUs; new/unmatched products need the regular import UI.
 const missing=products.filter(p=>!skus.some(s=>s.barcodes.some(b=>p.barcodes.includes(b.value))));assert.equal(missing.length,0,'Unexpected new WB cards: stop initialization');
 await preserveLegacyProductLinks(db,cid);
 for(const p of products)await syncProductLink(db,conn,p,{clientId:cid,internalSku:p.internalSku,name:p.name});
 const links=await readProductLinks(db,cid);const publications=await db.fbsStockPublication.findMany({where:{clientId:cid},select:{connectionId:true,skuId:true,enabled:true}});
 const missingPublications=publications.filter(p=>!links.some(l=>l.connectionId===p.connectionId&&l.skuId===p.skuId&&l.status==='LINKED'));assert.equal(missingPublications.length,0,'Existing publications must retain a confirmed link');
 const summary={products:products.length,linked:links.filter(l=>l.marketplace==='WILDBERRIES'&&l.status==='LINKED').length,review:links.filter(l=>l.marketplace==='WILDBERRIES'&&l.status==='REVIEW').length,ozon:links.filter(l=>l.marketplace==='OZON').length,publications:publications.length};
 await db.auditLog.create({data:{action:'marketplace_product_link.release_initialized',entity:'Client',entityId:cid,payload:{release:'PR553',...summary}}});console.log(JSON.stringify(summary));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.$disconnect());
