import { Prisma } from '@prisma/client';

type RouteBox = { id: string; code: string; warehouseId: string; palletCode: string; quantity: number; freeQuantity: number };
export type RelabelRoute = {
  sourceSkuId: string; sourceProductName: string; sourceArticle: string;
  sourceBarcodes: string[]; boxes: RouteBox[];
};
// FIX: discover same-size source stock only after the ordinary route has no free box.
// The caller must recheck stock/reservations under the existing box lock before saving.
export async function findFbsRelabelRoute(db: Pick<Prisma.TransactionClient, 'client' | 'sku' | 'clientArticleMapping'>, input: {
  clientId: string; warehouseId: string | null; skuId: string; taskId: string; quantity: number; exactSourceId?: string | null;
}, reservations: (skuId: string) => Promise<Array<{boxId: string | null; itemCount: number}>>): Promise<RelabelRoute | null> {
  if (process.env.WMS_FBS_RELABEL_ROUTE_REPAIR_ENABLED !== 'true' || !input.warehouseId) return null;
  const client = await db.client.findUnique({where: {id: input.clientId}, select: {relabelingEnabled: true}});
  if (!client?.relabelingEnabled) return null;
  const target = await db.sku.findFirst({where: {id: input.skuId, clientId: input.clientId}, select: {article: true, clientSku: true, internalSku: true, size: true}});
  if (!target?.size) return null;
  const references = [...new Set([target.article, target.clientSku, target.internalSku].filter((value): value is string => Boolean(value)))];
  if (!references.length) return null;
  const mappings = await db.clientArticleMapping.findMany({where: {clientId: input.clientId,
    OR: references.map(article => ({targetArticle: {equals: article, mode: Prisma.QueryMode.insensitive}}))}, orderBy: [{createdAt: 'asc'}, {id: 'asc'}]});
  const sources = [...new Set<string>(mappings.map(m => m.sourceArticle).filter(Boolean))];
  if (!sources.length) return null;
  const candidates = await db.sku.findMany({where: {clientId: input.clientId, id: input.exactSourceId ? {equals: input.exactSourceId, not: input.skuId} : {not: input.skuId},
    size: {equals: target.size, mode: Prisma.QueryMode.insensitive},
    OR: sources.flatMap(article => [
      {article: {equals: article, mode: Prisma.QueryMode.insensitive}},
      {clientSku: {equals: article, mode: Prisma.QueryMode.insensitive}},
      {internalSku: {equals: article, mode: Prisma.QueryMode.insensitive}},
      {internalSku: {startsWith: article + '-', mode: Prisma.QueryMode.insensitive}},
    ])}, select: {id: true, name: true, article: true, clientSku: true, internalSku: true,
      barcodes: {select: {value: true}}, balances: {where: {status: 'AVAILABLE', quantity: {gt: 0},
        warehouseId: input.warehouseId, boxId: {not: null}, box: {clientId: input.clientId,
          warehouseId: input.warehouseId, status: {notIn: ['deleted', 'archived']},
          storagePlacement: {pallet: {clientId: input.clientId, warehouseId: input.warehouseId}}}},
        select: {quantity: true, box: {select: {id: true, code: true, warehouseId: true,
          storagePlacement: {select: {pallet: {select: {code: true}}}}}}}}}, orderBy: {id: 'asc'}});
  for (const source of candidates) {
    const reserved = new Map<string, number>();
    for (const r of await reservations(source.id)) if (r.boxId) reserved.set(r.boxId, (reserved.get(r.boxId) ?? 0) + r.itemCount);
    const boxes = new Map<string, RouteBox>();
    for (const b of source.balances) {
      const box = b.box;
      if (!box?.storagePlacement?.pallet || box.warehouseId !== input.warehouseId) continue;
      const current = boxes.get(box.id) ?? {id: box.id, code: box.code, warehouseId: box.warehouseId,
        palletCode: box.storagePlacement.pallet.code, quantity: 0, freeQuantity: 0};
      current.quantity += b.quantity; boxes.set(box.id, current);
    }
    const eligible = [...boxes.values()].map(b => ({...b, freeQuantity: b.quantity - (reserved.get(b.id) ?? 0)}))
      .filter(b => b.freeQuantity >= input.quantity)
      .sort((a,b) => a.freeQuantity - b.freeQuantity || a.code.localeCompare(b.code));
    if (eligible.length) return {sourceSkuId: source.id, sourceProductName: source.name,
      sourceArticle: source.article ?? source.clientSku ?? source.internalSku,
      sourceBarcodes: [...new Set<string>(source.barcodes.map(b => b.value))], boxes: eligible};
  }
  return null;
}
