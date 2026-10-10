import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { confirmProductLink, preserveLegacyProductLinks, readProductLinks, syncProductLink, wbLinkedSkus, linkedOrderSku } from '../src/modules/marketplace-connections/marketplace-product-links';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { ozonLinkedSkus } from '../src/modules/marketplace-connections/marketplace-product-links';
import { resolveOzonLineSku } from '../src/modules/marketplace-connections/ozon-fbs-pick-lines';
import { OzonFboService } from '../src/modules/ozon-fbo/ozon-fbo.service';
import * as XLSX from 'xlsx';

// TEST: explicitly opt-in, dedicated LOCAL schema only; never use DATABASE_URL.
const url=process.env.MARKETPLACE_LINKS_TEST_URL;
if(url){const u=new URL(url);if(u.hostname!=='127.0.0.1'||u.searchParams.get('schema')!=='marketplace_links_test')throw Error('Isolated localhost schema required');}
describe.skipIf(!url)('marketplace links PostgreSQL regression',()=>{
 const db=new PrismaClient({datasources:{db:{url:url??'postgresql://codex_tests@127.0.0.1:55479/postgres?schema=marketplace_links_test'}}});
 const clientId=randomUUID(),otherClient=randomUUID(),skuId=randomUUID(),actorId=randomUUID(),warehouseId=randomUUID();
 const wb={id:randomUUID(),clientId,marketplace:'WILDBERRIES'},ozon={id:randomUUID(),clientId,marketplace:'OZON'};
 const product={productId:'100:200',offerId:'model42',marketplace:'WILDBERRIES',barcodes:['test-barcode'],size:'42',color:'black'};
 const create={clientId,internalSku:'must-not-create',name:'Test'};
 const previousFlag=process.env.WMS_MARKETPLACE_PRODUCT_LINKS_ENABLED,previousClients=process.env.WMS_MARKETPLACE_PRODUCT_LINK_CLIENTS;
 beforeAll(async()=>{
  process.env.WMS_MARKETPLACE_PRODUCT_LINKS_ENABLED='true';process.env.WMS_MARKETPLACE_PRODUCT_LINK_CLIENTS=clientId+','+otherClient;
  // Test the migration itself, including constraints absent from Prisma db push.
  await db.$executeRawUnsafe('DROP TABLE IF EXISTS "MarketplaceProductLink"');
  const sql=readFileSync(join(__dirname,'../prisma/migrations/20261010100000_marketplace_product_links/migration.sql'),'utf8');
  for(let repeat=0;repeat<2;repeat++)for(const statement of sql.split(';').filter(s=>s.trim()))await db.$executeRawUnsafe(statement);
  await db.client.create({data:{id:clientId,code:clientId,name:'TEST links',storesWithoutBoxes:true}});
  await db.client.create({data:{id:otherClient,code:otherClient,name:'TEST other'}});
  await db.user.create({data:{id:actorId,name:'Test',email:actorId+'@invalid',passwordHash:'test'}});
  await db.warehouse.create({data:{id:warehouseId,code:warehouseId,name:'TEST'}});
  await db.clientMarketplaceConnection.create({data:{...wb,marketplace:'WILDBERRIES',apiKey:'test'}});
  await db.clientMarketplaceConnection.create({data:{...ozon,marketplace:'OZON',apiKey:'test'}});
  await db.sku.create({data:{id:skuId,clientId,internalSku:skuId,name:'Warehouse product',size:'42',color:'black',marketplace:'OZON',marketplaceProductId:'ozon-123',marketplaceOfferId:'ozon-offer',barcodes:{create:{value:'test-barcode'}}}});
  await db.stockBalance.create({data:{balanceKey:randomUUID(),clientId,skuId,warehouseId,status:'AVAILABLE',quantity:127}});
  await db.stockBalance.create({data:{balanceKey:randomUUID(),clientId,skuId,warehouseId,status:'PACKING',quantity:391}});
 },30000);
 afterAll(async()=>{await db.$disconnect();if(previousFlag===undefined)delete process.env.WMS_MARKETPLACE_PRODUCT_LINKS_ENABLED;else process.env.WMS_MARKETPLACE_PRODUCT_LINKS_ENABLED=previousFlag;if(previousClients===undefined)delete process.env.WMS_MARKETPLACE_PRODUCT_LINK_CLIENTS;else process.env.WMS_MARKETPLACE_PRODUCT_LINK_CLIENTS=previousClients;});

 it('WB → Ozon → WB preserves both identities, physical SKU and balances',async()=>{
  const before=await db.sku.findUnique({where:{id:skuId},include:{barcodes:true}});
  const balances=await db.stockBalance.findMany({where:{clientId}});
  await preserveLegacyProductLinks(db,clientId);
  await syncProductLink(db,wb,product,create);
  await syncProductLink(db,ozon,{...product,marketplace:'OZON',productId:'ozon-123'},create);
  await syncProductLink(db,wb,product,create);
  expect(await db.sku.findUnique({where:{id:skuId},include:{barcodes:true}})).toEqual(before);
  expect(await db.stockBalance.findMany({where:{clientId}})).toEqual(balances);
  expect(await db.stockMovement.count({where:{clientId}})).toBe(0);
  const links=await readProductLinks(db,clientId);
  expect(links).toHaveLength(2);expect(new Set(links.map(l=>l.skuId))).toEqual(new Set([skuId]));
  expect((await wbLinkedSkus(db,clientId,wb.id,[before!]))[0].marketplaceProductId).toBe('100:200');
  expect(await wbLinkedSkus(db,clientId,ozon.id,[before!])).toEqual([]);
  expect(await readProductLinks(db,otherClient,wb.id)).toEqual([]);
  expect(linkedOrderSku(links,wb.id,[],'100:200')).toBe(skuId);
  expect(linkedOrderSku(links,ozon.id,[],undefined,product.offerId)).toBe(skuId);
 });

 it('Ozon FBO Excel and TSD resolve the account offer even when warehouse metadata came from WB',async()=>{
  const id=randomUUID();
  await db.sku.create({data:{id,clientId,internalSku:id,name:'WB original',marketplace:'WILDBERRIES',marketplaceProductId:'900:901',barcodes:{create:{value:'other-barcode'}}}});
  await syncProductLink(db,ozon,{...product,marketplace:'OZON',productId:'ozon-other',offerId:'ozon-only-offer',barcodes:['other-barcode']},create);
  const rows=await db.sku.findMany({where:{id},include:{barcodes:true}});
  const linked=await ozonLinkedSkus(db,clientId,ozon.id,rows);
  expect(resolveOzonLineSku({productId:777,offerId:'ozon-only-offer',quantity:1,barcodes:[]},linked).id).toBe(id);
  expect(await ozonLinkedSkus(db,clientId,wb.id,rows)).toEqual([]);
  await db.clientMarketplaceConnection.update({where:{id:ozon.id},data:{sellerId:'test'}});
  const service=new OzonFboService(db as never,{requireClientAccess(){}} as never);
  vi.spyOn(service as any,'fetchClusters').mockResolvedValue([{id:'1',name:'Москва',macrolocal_cluster_id:'1'}]);
  vi.spyOn(service as any,'fetchProducts').mockResolvedValue([{offer_id:'ozon-only-offer',sku:'777',name:'Remote'}]);
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Артикул продавца','Москва'],['ozon-only-offer',2]]),'Test');
  const plan=await service.importPlan({clientId,connectionId:ozon.id},{originalname:'test.xlsx',buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})} as any,{id:actorId,name:'Test'} as any);
  const items=await db.ozonFboPlanItem.findMany({where:{planId:plan.id}});
  expect(items).toHaveLength(1);expect(items[0]).toMatchObject({skuId:id,isValid:true,quantity:2});
 });

 it('deducts only outstanding FBO demand and keeps quantities consistent across accounts',async()=>{
  const request=await db.clientRequest.create({data:{clientId,warehouseId,type:'OUTBOUND',status:'IN_WORK',title:'FBO Ozon',items:{create:{skuId,quantity:393}}}});
  await db.stockMovement.create({data:{clientId,warehouseId,skuId,type:'MOVE',status:'AVAILABLE',quantity:-391,sourceDocument:request.id}});
  const service=new MarketplaceConnectionsService(db as never,{} as never);
  vi.spyOn(service as any,'loadFbsOrders').mockResolvedValue({orders:[]});
  // TEST: reproduces the old failure: a warehouse SKU last imported from Ozon disappears from WB.
  process.env.WMS_MARKETPLACE_PRODUCT_LINKS_ENABLED='false';
  expect((await service.calculateFbsStockQuantities(clientId,[skuId],warehouseId,wb.id)).has(skuId)).toBe(false);
  process.env.WMS_MARKETPLACE_PRODUCT_LINKS_ENABLED='true';
  const result=await service.calculateFbsStockQuantities(clientId,[skuId],warehouseId,wb.id);
  expect(result.get(skuId)).toMatchObject({chrtId:200,available:127,reserved:2,sellable:125});
  expect((await service.calculateFbsStockQuantities(clientId,[skuId],warehouseId)).get(skuId)).toMatchObject({available:127,reserved:2,sellable:125});
  await db.clientRequest.create({data:{clientId,warehouseId,type:'OUTBOUND',status:'SUBMITTED',title:'Other demand',items:{create:{skuId,quantity:3}}}});
  expect((await service.calculateFbsStockQuantities(clientId,[skuId],warehouseId,wb.id)).get(skuId)?.sellable).toBe(122);
 });

 it('serializes concurrent imports without duplicate links or stock',async()=>{
  const before=await db.sku.count({where:{clientId}});
  await Promise.all([syncProductLink(db,wb,product,create),syncProductLink(db,wb,product,create)]);
  expect((await readProductLinks(db,clientId,wb.id))).toHaveLength(1);
  expect(await db.sku.count({where:{clientId}})).toBe(before);
 });

 it('requires manual review for duplicates, rejects stale/foreign decisions, audits atomic confirmation',async()=>{
  const ids=[randomUUID(),randomUUID()];
  for(const id of ids)await db.sku.create({data:{id,clientId,internalSku:id,name:'Duplicate',size:'42',color:'black',barcodes:{create:{value:'duplicate'}}}});
  const p={...product,productId:'300:400',barcodes:['duplicate']};
  expect((await syncProductLink(db,wb,p,create)).review).toBe(true);
  const row=(await readProductLinks(db,clientId,wb.id)).find(l=>l.productId===p.productId)!;
  const foreign=await db.sku.create({data:{clientId:otherClient,internalSku:randomUUID(),name:'Other client',size:'42',color:'black',barcodes:{create:{value:'duplicate'}}}});
  await expect(confirmProductLink(db,clientId,wb.id,row.id,foreign.id,row.updatedAt.toISOString(),'checked',actorId)).rejects.toThrow();
  await expect(confirmProductLink(db,clientId,wb.id,row.id,ids[0],'2000-01-01T00:00:00.000Z','checked',actorId)).rejects.toThrow();
  await expect(confirmProductLink(db,clientId,ozon.id,row.id,ids[0],row.updatedAt.toISOString(),'checked',actorId)).rejects.toThrow();
  // Missing actor violates the audit FK: link update must roll back as well.
  await expect(confirmProductLink(db,clientId,wb.id,row.id,ids[0],row.updatedAt.toISOString(),'checked',randomUUID())).rejects.toThrow();
  expect((await readProductLinks(db,clientId,wb.id)).find(l=>l.id===row.id)?.status).toBe('REVIEW');
  await confirmProductLink(db,clientId,wb.id,row.id,ids[0],row.updatedAt.toISOString(),'Physically verified',actorId);
  expect(await db.auditLog.count({where:{entityId:row.id}})).toBe(1);
  expect((await readProductLinks(db,clientId,wb.id)).find(l=>l.id===row.id)?.skuId).toBe(ids[0]);
  await expect(confirmProductLink(db,clientId,wb.id,row.id,ids[1],row.updatedAt.toISOString(),'retry',actorId)).rejects.toThrow();
 });

 it('blocks outbound publication after a variant changes, before any WB request',async()=>{
  await syncProductLink(db,wb,{...product,size:'44'},create);
  const service=new MarketplaceConnectionsService(db as never,{} as never);
  await expect((service as any).bindWbPublications(clientId,wb.id,[{sku:{id:skuId,marketplaceProductId:'ozon-123'}}])).rejects.toThrow('Публикация остановлена');
 });
});
