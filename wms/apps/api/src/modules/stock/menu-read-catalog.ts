import { Prisma } from '@prisma/client';

export const menuReadsEnabled = () => process.env.WMS_MENU_READS_ENABLED === 'true';
// FIX: only keys consumed by buildShkCatalogFromSkus cross the DB boundary.
export const instructionPayloadKeys = ['barcode','barCode','sku','offerBarcode','nmID','nmId','imtID','imtId','vendorCode','offerId',
  'brand','brandName','ip','seller','sellerName','supplierName','color','colour','colorName','size','techSize','russianSize'];

export async function leanInstructionCatalog(db: Prisma.TransactionClient, clientId:string) {
  const rows = await db.sku.findMany({where:{clientId},omit:{marketplacePayload:true},include:{barcodes:{select:{value:true,isPrimary:true}}}});
  if(!rows.length)return [];
  const payloads = await db.$queryRaw<Array<{id:string;payload:Prisma.JsonValue}>>(Prisma.sql`
    SELECT id, COALESCE((SELECT jsonb_object_agg(key,value)
      FROM jsonb_each(CASE WHEN jsonb_typeof("marketplacePayload")='object' THEN "marketplacePayload" ELSE '{}'::jsonb END)
      WHERE key IN (${Prisma.join(instructionPayloadKeys)})), '{}'::jsonb) AS payload
    FROM "Sku" WHERE "clientId"=${clientId} AND id IN (${Prisma.join(rows.map(r=>r.id))})`);
  const byId=new Map(payloads.map(r=>[r.id,r.payload]));
  return rows.map(r=>({...r,marketplacePayload:byId.get(r.id)??null}));
}
