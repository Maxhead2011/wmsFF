import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

// FIX: opt-in by deployment AND client; legacy clients do not query the new table.
export function productLinksEnabled(clientId: string) {
  return process.env.WMS_MARKETPLACE_PRODUCT_LINKS_ENABLED === 'true' &&
    (process.env.WMS_MARKETPLACE_PRODUCT_LINK_CLIENTS ?? '').split(',').map(s=>s.trim()).includes(clientId);
}
type Variant = { size?: string|null; color?: string|null };
type Candidate = Variant & {id:string;barcodes:{value:string}[]};
type Product = Variant & {barcodes:string[];productId:string;offerId:string;marketplace:string;payload?:unknown};
export type ProductLink = {id:string;clientId:string;connectionId:string;skuId:string|null;marketplace:string;productId:string;offerId:string;barcodes:string[];size:string|null;color:string|null;status:string;reason:string|null;updatedAt:Date};
const norm=(s?:string|null)=>(s??'').trim().toLocaleLowerCase('ru-RU');
export function productLinkCandidate(p:Variant & {barcodes:string[]}, candidates:Candidate[]) {
  const matches=candidates.filter(s=>s.barcodes.some(b=>p.barcodes.includes(b.value)));
  if(matches.length!==1)return {skuId:null,reason:matches.length?'Несколько товаров с этим штрихкодом':'Нет товара с этим штрихкодом'};
  const s=matches[0];
  if(['size','color'].some(k=>norm(p[k as keyof Variant])&&norm(s[k as keyof Variant])&&norm(p[k as keyof Variant])!==norm(s[k as keyof Variant])))
    return {skuId:null,reason:'Не совпадает размер или цвет'};
  return {skuId:s.id,reason:null};
}
type Db=Prisma.TransactionClient;
// FIX: incoming orders resolve through the same account-specific physical identity as publication.
export function linkedOrderSku(links:ProductLink[],connectionId:string,barcodes:string[],wbIdentity?:string,offerId?:string) {
  const candidates=links.filter(l=>l.connectionId===connectionId&&l.status==='LINKED'&&
    (wbIdentity?l.productId===wbIdentity:offerId?l.offerId===offerId:l.barcodes.some(b=>barcodes.includes(b))));
  return candidates.length===1?candidates[0].skuId:null;
}
// FIX: Ozon consumers use the chosen account's identity even for a WB-origin warehouse SKU.
export async function ozonLinkedSkus<T extends {id:string}>(db:Db,clientId:string,connectionId:string,rows:T[]) {
  if(!productLinksEnabled(clientId))return rows;
  const links=(await readProductLinks(db,clientId,connectionId)).filter(l=>l.marketplace==='OZON'&&l.status==='LINKED');
  const bySku=new Map(links.map(l=>[l.skuId,l]));
  return rows.flatMap(s=>{const link=bySku.get(s.id);return link?[{...s,marketplaceProductId:link.productId,marketplaceOfferId:link.offerId}]:[];});
}
export async function readProductLinks(db:Db,clientId:string,connectionId?:string,productId?:string,skuId?:string) {
  if(!productLinksEnabled(clientId))return [] as ProductLink[];
  return db.$queryRaw<ProductLink[]>`SELECT l.id,l."clientId",l."connectionId",l."skuId",l.marketplace,l."productId",l."offerId",l.barcodes,l.size,l.color,l.status,l.reason,l."updatedAt" FROM "MarketplaceProductLink" l
    JOIN "ClientMarketplaceConnection" c ON c.id=l."connectionId" AND c."clientId"=l."clientId"
    WHERE l."clientId"=${clientId} ${connectionId?Prisma.sql`AND l."connectionId"=${connectionId}`:Prisma.empty}
    ${productId?Prisma.sql`AND l."productId"=${productId}`:Prisma.empty}
    ${skuId?Prisma.sql`AND l."skuId"=${skuId}`:Prisma.empty}
    ORDER BY l."productId"`;
}
// FIX: one WB identity per physical SKU per account, with fail-closed publication before reconciliation.
export async function wbLinkedSkus<T extends {id:string;marketplaceProductId?:string|null}>(db:Db,clientId:string,connectionId:string|undefined,rows:T[]) {
  if(!productLinksEnabled(clientId))return rows;
  if(!connectionId)throw new ConflictException('Для связанных карточек выберите кабинет WB.');
  const links=(await readProductLinks(db,clientId,connectionId)).filter(l=>l.marketplace==='WILDBERRIES'&&l.status==='LINKED'&&l.skuId);
  const bySku=new Map(links.map(l=>[l.skuId,l.productId]));
  return rows.flatMap(s=>bySku.has(s.id)?[{...s,marketplaceProductId:bySku.get(s.id)!}]:[]);
}
export function wbSkuScope(clientId:string,legacy:Prisma.SkuWhereInput) {
  return productLinksEnabled(clientId)?{}:legacy;
}
// FIX: preserve existing identities only when their owning account is unambiguous.
export async function preserveLegacyProductLinks(db:PrismaClient,clientId:string) {
  if(!productLinksEnabled(clientId))return;
  await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "Client" WHERE id=${clientId} FOR UPDATE`;
    const connections=await tx.clientMarketplaceConnection.findMany({where:{clientId,isActive:true,marketplace:{in:['WILDBERRIES','OZON']}},select:{id:true,marketplace:true}});
    const skus=await tx.sku.findMany({where:{clientId,marketplaceProductId:{not:null},isDraft:false},include:{barcodes:true}});
    for(const s of skus){const accounts=connections.filter(c=>c.marketplace===s.marketplace);if(accounts.length!==1)continue;
      await tx.$executeRaw`INSERT INTO "MarketplaceProductLink" (id,"clientId","connectionId","skuId",marketplace,"productId","offerId",barcodes,size,color,status,payload,"updatedAt")
        VALUES (${randomUUID()},${clientId},${accounts[0].id},${s.id},${s.marketplace!},${s.marketplaceProductId!},${s.marketplaceOfferId??''},${s.barcodes.map(b=>b.value)},${s.size},${s.color},'LINKED',${JSON.stringify(s.marketplacePayload??{})}::jsonb,NOW()) ON CONFLICT DO NOTHING`;
    }
  },{timeout:60000});
}
export async function syncProductLink(db:PrismaClient,connection:{id:string;clientId:string;marketplace:string},p:Product,createData:Prisma.SkuUncheckedCreateInput) {
  return db.$transaction(async tx=>{
    // Same-client imports and manual confirmations serialize without locking warehouse movements.
    await tx.$queryRaw`SELECT id FROM "Client" WHERE id=${connection.clientId} FOR UPDATE`;
    const prior=(await readProductLinks(tx,connection.clientId,connection.id,p.productId))[0];
    const candidates=await tx.sku.findMany({where:{clientId:connection.clientId,barcodes:{some:{value:{in:p.barcodes}}}},include:{barcodes:true}});
    let decision=productLinkCandidate(p,candidates);let created=false;
    if(prior?.status==='LINKED') {
      // An established identity never silently switches to a new physical product.
      const linked=await tx.sku.findFirst({where:{id:prior.skuId!,clientId:connection.clientId},include:{barcodes:true}});
      const checked=linked?productLinkCandidate(p,[linked]):{skuId:null,reason:'Связанный товар не найден'};
      decision=checked.skuId===prior.skuId?checked:{skuId:null,reason:'Изменились реквизиты связанной карточки; требуется сверка'};
    } else if(!candidates.length&&!prior&&p.barcodes.length) {
      const existing=await tx.sku.findFirst({where:{clientId:connection.clientId,internalSku:createData.internalSku}});
      if(!existing){const s=await tx.sku.create({data:createData});for(const value of [...new Set(p.barcodes)])await tx.barcode.create({data:{skuId:s.id,value,isPrimary:value===p.barcodes[0]}});decision={skuId:s.id,reason:null};created=true;}
      else decision={skuId:null,reason:'Артикул уже существует с другим штрихкодом'};
    }
    if(decision.skuId){const other=(await readProductLinks(tx,connection.clientId,connection.id,undefined,decision.skuId)).find(l=>l.productId!==p.productId&&l.status==='LINKED');if(other)decision={skuId:null,reason:'Другой размер карточки этого кабинета уже связан с товаром'};}
    const status=decision.skuId?'LINKED':'REVIEW',id=prior?.id??randomUUID();
    await tx.$executeRaw`INSERT INTO "MarketplaceProductLink" (id,"clientId","connectionId","skuId",marketplace,"productId","offerId",barcodes,size,color,status,reason,payload,"updatedAt")
      VALUES (${id},${connection.clientId},${connection.id},${decision.skuId},${connection.marketplace},${p.productId},${p.offerId},${p.barcodes},${p.size??null},${p.color??null},${status},${decision.reason},${JSON.stringify(p.payload??{})}::jsonb,NOW())
      ON CONFLICT ("connectionId","productId") DO UPDATE SET "skuId"=EXCLUDED."skuId", "offerId"=EXCLUDED."offerId",barcodes=EXCLUDED.barcodes,size=EXCLUDED.size,color=EXCLUDED.color,status=EXCLUDED.status,reason=EXCLUDED.reason,payload=EXCLUDED.payload,"updatedAt"=NOW()`;
    return {created,mergedDrafts:0,barcodesTouched:created?p.barcodes.length:0,review:!decision.skuId};
  });
}
export async function confirmProductLink(db:PrismaClient,clientId:string,connectionId:string,linkId:string,skuId:string,expectedUpdatedAt:string,reason:string,actorId:string) {
  if(!productLinksEnabled(clientId))throw new NotFoundException();
  return db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "Client" WHERE id=${clientId} FOR UPDATE`;
    const link=(await readProductLinks(tx,clientId,connectionId)).find(l=>l.id===linkId);
    if(!link||link.status==='LINKED')throw new ConflictException('Карточка уже обработана или не найдена. Обновите сверку.');
    if(new Date(link.updatedAt).toISOString()!==expectedUpdatedAt)throw new ConflictException('Карточка изменилась. Обновите сверку.');
    const sku=await tx.sku.findFirst({where:{id:skuId,clientId},include:{barcodes:true}});
    if(!sku||!reason.trim()||productLinkCandidate(link,[sku]).skuId!==sku.id)throw new ConflictException('Нужны совпадающие штрихкод, размер и цвет и причина решения.');
    if((await readProductLinks(tx,clientId,connectionId)).some(l=>l.id!==link.id&&l.skuId===skuId&&l.status==='LINKED'))
      throw new ConflictException('Этот товар уже связан с другой карточкой кабинета. Обновите сверку.');
    await tx.$executeRaw`UPDATE "MarketplaceProductLink" SET "skuId"=${skuId},status='LINKED',reason=NULL,"updatedAt"=NOW() WHERE id=${linkId}`;
    await tx.auditLog.create({data:{userId:actorId,action:'marketplace_product_link.confirmed',entity:'MarketplaceProductLink',entityId:linkId,payload:{clientId,connectionId,skuId,reason,previous:JSON.parse(JSON.stringify(link))}}});
    return {linked:true};
  });
}
