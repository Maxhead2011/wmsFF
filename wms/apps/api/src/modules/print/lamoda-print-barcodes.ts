import type { PrismaService } from '../../common/prisma/prisma.service';

const active = { isPresent: true, linkState: 'CONFIRMED', account: { isActive: true } };
type Barcode = { id: string; value: string; isPrimary: boolean; source?: string };
type Product = { id: string; clientId: string; barcodes: Barcode[] };

// FIX: print-only aliases never become warehouse Barcode records or stock identities.
export async function withLamodaPrintBarcodes<T extends Product>(db: PrismaService, skus: T[]): Promise<T[]> {
  if (process.env.WMS_LAMODA_ENABLED !== 'true' || !skus.length) return skus;
  const links = await db.lamodaProduct.findMany({
    where: { ...active, OR: skus.map(s => ({ skuId: s.id, account: { isActive: true, clientId: s.clientId } })) },
    select: { id: true, skuId: true, barcode: true, account: { select: { clientId: true } } },
    orderBy: { id: 'asc' },
  });
  return skus.map(sku => {
    const barcodes = sku.barcodes.map(b => ({ ...b }));
    for (const link of links) {
      if (link.skuId !== sku.id || link.account.clientId !== sku.clientId || !link.barcode?.trim()) continue;
      const existing = barcodes.find(b => b.value === link.barcode);
      if (existing) existing.source = 'LAMODA';
      else {
        barcodes.push({ id: `lamoda:${link.id}`, value: link.barcode, isPrimary: false, source: 'LAMODA' });
      }
    }
    return { ...sku, barcodes };
  });
}

// FIX: the agent independently rechecks a current confirmed link in the SKU's client.
export async function isLamodaPrintBarcode(db: PrismaService, skuId: string, clientId: string, barcode: string) {
  if (process.env.WMS_LAMODA_ENABLED !== 'true') return false;
  return Boolean(await db.lamodaProduct.findFirst({
    where: { ...active, skuId, barcode, account: { isActive: true, clientId } },
    select: { id: true },
  }));
}
