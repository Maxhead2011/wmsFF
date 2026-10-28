import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { wbReservationQuantities } from '../../common/stock/wb-order-stock-lifecycle';
import { receiptAllows, receiptRules } from '../warehouse/receipt-channel-policy';

type Demand = { skuId: string; barcode: string; quantity: number };
export type LamodaQuantity = { skuId: string; quantity: number };

// FIX: corrections only reduce the selected warehouse demand; the imported plan remains immutable.
export function adjustLamodaComposition(
  original: { items: Demand[]; directions: { name: string; items: Demand[] }[] },
  quantities?: LamodaQuantity[],
) {
  if (quantities === undefined) return original;
  const limits = new Map(original.items.map(i => [i.skuId, i.quantity]));
  const selected = new Map<string, number>();
  if (!Array.isArray(quantities) || quantities.length !== limits.size) throw new BadRequestException('Передайте количество каждого товара из проверенного плана.');
  for (const row of quantities) {
    if (!row || !limits.has(row.skuId) || selected.has(row.skuId) || !Number.isSafeInteger(row.quantity)
      || row.quantity < 0 || row.quantity > limits.get(row.skuId)!) throw new BadRequestException('Корректировка может только уменьшать количество товаров исходного плана. Повторите проверку.');
    selected.set(row.skuId, row.quantity);
  }
  if (![...selected.values()].some(n => n > 0)) throw new BadRequestException('Нет доступного товара для сборки. Заявка не создана.');
  const remaining = new Map(selected);
  const directions = original.directions.map(d => ({ ...d, items: d.items.map(i => {
    const quantity = Math.min(i.quantity, remaining.get(i.skuId) ?? 0);
    remaining.set(i.skuId, (remaining.get(i.skuId) ?? 0) - quantity);
    return { ...i, quantity };
  }).filter(i => i.quantity > 0) })).filter(d => d.items.length);
  return { items: original.items.map(i => ({ ...i, quantity: selected.get(i.skuId)! })).filter(i => i.quantity > 0), directions };
}

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
