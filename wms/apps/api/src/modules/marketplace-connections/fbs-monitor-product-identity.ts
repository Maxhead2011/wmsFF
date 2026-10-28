import { Prisma } from '@prisma/client';
import { productLinksEnabled } from './marketplace-product-links';
type Row = { clientId: string; connectionId: string; skuId: string; marketplaceProductId?: string | null };
type Identity = { nmId: string; chrtId: number };
export const monitorIdentityKey = (row: Row) => JSON.stringify([row.clientId, row.connectionId, row.skuId]);
function parse(value?: string | null): Identity | null {
  const [nmId = '', size = ''] = (value ?? '').trim().split(':');
  const chrtId = Number(size);
  return nmId && Number.isSafeInteger(chrtId) && chrtId > 0 ? { nmId, chrtId } : null;
}
// FIX: a physical SKU's legacy marketplace id may belong to Ozon. Resolve WB
// through the exact opted-in client/account, with no fallback for ambiguous links.
export async function monitorProductIdentities(db: Prisma.TransactionClient, rows: Row[]) {
  const result = new Map<string, Identity | null>();
  const linked = rows.filter(row => productLinksEnabled(row.clientId));
  const links = linked.length ? await db.marketplaceProductLink.findMany({
    where: { marketplace: 'WILDBERRIES', status: 'LINKED', OR: linked.map(({clientId, connectionId, skuId}) => ({clientId, connectionId, skuId})) },
    select: {clientId: true, connectionId: true, skuId: true, productId: true},
  }) : [];
  for (const row of rows) {
    const matches = links.filter(link => link.clientId === row.clientId && link.connectionId === row.connectionId && link.skuId === row.skuId);
    result.set(monitorIdentityKey(row), productLinksEnabled(row.clientId)
      ? matches.length === 1 ? parse(matches[0].productId) : null
      : parse(row.marketplaceProductId));
  }
  return result;
}
