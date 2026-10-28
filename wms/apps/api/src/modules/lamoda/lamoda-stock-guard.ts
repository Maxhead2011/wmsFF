import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { wbReservationQuantities } from '../../common/stock/wb-order-stock-lifecycle';
import { receiptAllows, receiptRules } from '../warehouse/receipt-channel-policy';

type Demand = { skuId: string; barcode: string; quantity: number };

// FIX: run on the creation transaction's snapshot, never trust an earlier UI preview.
// AVAILABLE has already lost picked units; the canonical reader subtracts only remaining demand.
export async function lamodaStockAvailability(
  tx: Prisma.TransactionClient, clientId: string, warehouseId: string,
  items: Demand[], excludeRequestId?: string,
) {
  const grouped = new Map<string, Demand>();
  for (const item of items) {
    const previous = grouped.get(item.skuId);
    grouped.set(item.skuId, { ...item, quantity: (previous?.quantity ?? 0) + item.quantity });
  }
  if (!grouped.size) return [];
  const skuIds = [...grouped.keys()];
  const client = await tx.client.findUniqueOrThrow({ where: { id: clientId }, select: { storesWithoutBoxes: true } });
  const balances = await tx.stockBalance.findMany({ where: {
    clientId, warehouseId, skuId: { in: skuIds }, status: 'AVAILABLE', quantity: { gt: 0 },
    ...(client.storesWithoutBoxes ? { boxId: null, palletId: null } : {
      box: { clientId, warehouseId, status: 'active' },
    }),
  }, select: { skuId: true, boxId: true, quantity: true } });
  const boxIds = [...new Set(balances.flatMap(b => b.boxId ? [b.boxId] : []))];
  const rules = boxIds.length ? await receiptRules(tx, clientId, warehouseId, boxIds) : new Map();
  const reserved = await wbReservationQuantities(tx, clientId, skuIds, warehouseId, excludeRequestId);
  const stock = new Map<string, number>();
  for (const balance of balances) {
    if (balance.boxId && !receiptAllows(rules.get(balance.boxId), 'fbo')) continue;
    stock.set(balance.skuId, (stock.get(balance.skuId) ?? 0) + balance.quantity);
  }
  return [...grouped.values()].map(item => {
    const stockQuantity = stock.get(item.skuId) ?? 0;
    const reservedQuantity = reserved.get(item.skuId) ?? 0;
    const availableQuantity = Math.max(0, stockQuantity - reservedQuantity);
    return { ...item, stockQuantity, reservedQuantity, availableQuantity,
      shortageQuantity: Math.max(0, item.quantity - availableQuantity) };
  });
}

export async function assertLamodaStockAvailable(
  tx: Prisma.TransactionClient, clientId: string, warehouseId: string, items: Demand[],
) {
  const shortages = (await lamodaStockAvailability(tx, clientId, warehouseId, items)).filter(r => r.shortageQuantity > 0);
  if (shortages.length) throw new ConflictException({
    message: 'Недостаточно свободного остатка для Lamoda. ' + shortages.map(r =>
      `ШК ${r.barcode}: нужно ${r.quantity}, доступно ${r.availableQuantity}, дефицит ${r.shortageQuantity}.`).join(' '),
    shortages,
  });
}
