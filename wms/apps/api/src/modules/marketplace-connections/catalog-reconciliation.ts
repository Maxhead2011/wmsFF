import { ForbiddenException } from '@nestjs/common';
// FIX: enabling a catalogue audit must not switch operational stock/order identity readers.
export const catalogReconciliationKey=(clientId:string)=>`catalog.reconciliation.enabled.v1:${clientId}`;
export async function catalogReconciliationEnabled(db:any,clientId:string){
 return (await db.systemSetting.findUnique({where:{key:catalogReconciliationKey(clientId)}}))?.value===true;
}
export async function enableCatalogReconciliation(db:any,clientId:string,user:{id:string;roleCodes:string[]}){
 if(!user.roleCodes.some(r=>['ADMIN','OWNER'].includes(r)))throw new ForbiddenException('Включить сверку может администратор или собственник.');
 return db.$transaction(async(tx:any)=>{
  await tx.$queryRaw`SELECT id FROM "Client" WHERE id=${clientId} FOR UPDATE`;
  if(await catalogReconciliationEnabled(tx,clientId))return {enabled:true,changed:false};
  await tx.systemSetting.upsert({where:{key:catalogReconciliationKey(clientId)},create:{key:catalogReconciliationKey(clientId),value:true,updatedByUserId:user.id},update:{value:true,updatedByUserId:user.id}});
  await tx.auditLog.create({data:{userId:user.id,action:'CATALOG_RECONCILIATION_ENABLED',entity:'Client',entityId:clientId,payload:{enabled:true,mode:'READ_ONLY',operationalLinksChanged:false}}});
  return {enabled:true,changed:true};
 });
}
// FIX: legacy cards are evidence for an audit, never silently promoted to confirmed links.
export async function savedCatalogCards(db:any,connection:{id:string;clientId:string;marketplace:string}):Promise<import('./marketplace-product-links').ProductLink[]>{
 const accounts=await db.clientMarketplaceConnection.count({where:{clientId:connection.clientId,marketplace:connection.marketplace}});
 if(accounts!==1)return [];
 const skus=await db.sku.findMany({where:{clientId:connection.clientId,marketplace:connection.marketplace,marketplaceProductId:{not:null}},include:{barcodes:true}});
 return skus.map((s:any)=>({id:`saved:${connection.id}:${s.id}`,clientId:connection.clientId,connectionId:connection.id,skuId:s.id,marketplace:connection.marketplace,productId:s.marketplaceProductId,offerId:s.marketplaceOfferId??'',barcodes:s.barcodes.map((b:any)=>b.value),size:s.size,color:s.color,status:'SAVED_CARD',reason:'Сохранённая карточка: межмаркетплейсная связь не подтверждена',updatedAt:s.updatedAt}));
}
