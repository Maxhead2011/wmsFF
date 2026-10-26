import { Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { receiptPublicationPolicy } from '../warehouse/receipt-channel-policy';
import { normalizeSharedStockSnapshot, StockOrderLine, StockRequestLine } from './multishop-stock-snapshot';

export type SharedStockRead = { revision: string; quantities: Map<string, { available: number; reserved: number; free: number }> };
const activeStatuses = ['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'IN_WORK', 'PACKED'] as const;

// FIX: every quantity used for one publication plan comes from one repeatable-read
// warehouse snapshot. Orders are fresh complete marketplace input supplied by the caller.
export async function readSharedStock(db: PrismaClient, clientId: string, warehouseId: string, skuIds: string[], incomingOrders: StockOrderLine[]): Promise<SharedStockRead> {
  return db.$transaction(async tx => {
    const client = await tx.client.findUniqueOrThrow({ where: { id: clientId }, select: { storesWithoutBoxes: true, stockBalanceMode: true } });
    const policy = await receiptPublicationPolicy(tx, clientId, warehouseId);
    const skus = await tx.sku.findMany({ where: { clientId, isDraft: false }, select: { id: true, barcodes: { select: { value: true } } } });
    const allSkuIds = new Set(skus.map(s => s.id));
    if (skuIds.some(id => !allSkuIds.has(id))) throw new Error('В группе есть товар другого клиента или черновик.');
    const barcodeIds = new Map<string, Set<string>>();
    for (const sku of skus) for (const barcode of sku.barcodes) {
      const ids = barcodeIds.get(barcode.value) ?? new Set(); ids.add(sku.id); barcodeIds.set(barcode.value, ids);
    }
    const requests = await tx.clientRequest.findMany({ where: { clientId, type: 'OUTBOUND', status: { in: [...activeStatuses] },
      OR: [{ warehouseId }, { warehouseId: null }] }, select: { id: true, warehouseId: true, items: { select: { skuId: true, barcode: true, quantity: true } } } });
    if (requests.some(r => !r.warehouseId)) throw new Error('У активной заявки не указан физический склад. Требуется сверка перед отправкой.');
    const activeRequestIds = new Set(requests.map(r => r.id));
    const links = await tx.fbsOrderRequestLink.findMany({ where: { clientId, request: { warehouseId },
      OR: [{ requestId: { in: [...activeRequestIds] } }, { orderId: { in: incomingOrders.map(o => o.orderId) }, connectionId: { in: [...new Set(incomingOrders.map(o => o.connectionId))] } }] },
      select: { connectionId: true, orderId: true, marketplace: true, requestId: true } });
    const incomingKeys = new Set(incomingOrders.map(o => JSON.stringify([o.marketplace, o.connectionId, o.orderId])));
    const requestIds = [...new Set([...activeRequestIds, ...links.filter(l => incomingKeys.has(JSON.stringify([l.marketplace, l.connectionId, l.orderId]))).map(l => l.requestId)])];
    const [balances, movements, tasks] = await Promise.all([
      tx.stockBalance.findMany({ where: { clientId, warehouseId, skuId: { in: skuIds }, status: 'AVAILABLE', quantity: { gt: 0 },
        ...(client.storesWithoutBoxes ? { boxId: null } : { boxId: { not: null, ...(policy.blocked.length ? { notIn: policy.blocked } : {}) }, box: {
          warehouseId, status: { notIn: ['deleted', 'archived', 'shipped'] }, ...(client.stockBalanceMode === 'BOXES' ? {} : { storagePlacement: { isNot: null } }),
        } }) }, select: { skuId: true, quantity: true } }),
      requestIds.length ? tx.stockMovement.groupBy({ by: ['sourceDocument', 'skuId'], where: { clientId, warehouseId, sourceDocument: { in: requestIds },
        status: 'AVAILABLE', type: { in: ['PICK', 'PACK', 'SHIP', 'RETURN', 'MOVE'] },
        OR: [{ idempotencyKey: null }, { NOT: { idempotencyKey: { startsWith: 'fbs-sticker-pick:' } } }] }, _sum: { quantity: true } }) : [],
      tx.fbsTsdAssembly.findMany({ where: { clientId, OR: [{ requestId: { in: requestIds } }, { orderId: { in: incomingOrders.map(o => o.orderId) }, connectionId: { in: [...new Set(incomingOrders.map(o => o.connectionId))] } }], status: { notIn: ['CANCELLED'] } },
        select: { id: true, connectionId: true, orderId: true, requestId: true, skuId: true, sourceSkuId: true, relabelConfirmedAt: true, itemCount: true, marketplace: true } }),
    ]);
    if (tasks.some(t => t.sourceSkuId && t.sourceSkuId !== t.skuId && !t.relabelConfirmedAt && (skuIds.includes(t.sourceSkuId) || skuIds.includes(t.skuId)))) {
      throw new Error('Есть незавершённая переклейка между товарами группы. Сначала завершите или отмените её.');
    }
    const available = new Map(skuIds.map(id => [id, 0]));
    for (const row of balances) available.set(row.skuId, (available.get(row.skuId) ?? 0) + row.quantity);
    const requestRows: StockRequestLine[] = [];
    for (const request of requests) for (const item of request.items) {
      const candidates = item.barcode ? barcodeIds.get(item.barcode) : undefined;
      const skuId = item.skuId ?? (candidates?.size === 1 ? [...candidates][0] : null);
      if (!skuId || !allSkuIds.has(skuId)) throw new Error('Позиция активной заявки не имеет однозначного товара WMS.');
      requestRows.push({ requestId: request.id, skuId, quantity: item.quantity });
    }
    const byOrder = new Map(links.map(l => [JSON.stringify([l.marketplace, l.connectionId, l.orderId]), l.requestId]));
    for (const task of tasks) task.requestId = byOrder.get(JSON.stringify([task.marketplace, task.connectionId, task.orderId])) ?? task.requestId;
    const orders = incomingOrders.map(row => ({ ...row, requestId: byOrder.get(JSON.stringify([row.marketplace, row.connectionId, row.orderId])) ?? row.requestId }));
    if (orders.some(o => !allSkuIds.has(o.skuId))) throw new Error('Заказ связан с товаром другого клиента.');
    // Legacy Ozon requests can initially put the entire posting quantity in its first
    // item. Replace only that task's contribution in the read model, never in business rows.
    const ozonTasks = tasks.filter(t => t.marketplace === 'OZON' && activeRequestIds.has(t.requestId));
    const expanded = ozonTasks.length ? await tx.$queryRaw<{ assemblyId: string }[]>(Prisma.sql`SELECT "assemblyId" FROM "OzonFbsPickState" WHERE "assemblyId" IN (${Prisma.join(ozonTasks.map(t => t.id))})`) : [];
    const expandedIds = new Set(expanded.map(r => r.assemblyId));
    for (const task of ozonTasks) {
      if (expandedIds.has(task.id)) continue;
      const composition = orders.filter(o => o.marketplace === 'OZON' && o.connectionId === task.connectionId && o.orderId === task.orderId && o.requestId === task.requestId);
      if (composition.length <= 1) continue;
      if (composition.reduce((n, o) => n + o.quantity, 0) !== task.itemCount) throw new Error('Состав заказа Ozon изменился относительно задания WMS.');
      let remaining = task.itemCount;
      for (const row of requestRows) if (row.requestId === task.requestId && row.skuId === task.skuId) {
        const take = Math.min(remaining, row.quantity); row.quantity -= take; remaining -= take;
      }
      if (remaining) throw new Error('В заявке WMS недостаточно единиц для сверки состава Ozon.');
      for (const line of composition) requestRows.push({ requestId: task.requestId, skuId: line.skuId, quantity: line.quantity });
    }
    const physical = movements.map(m => ({ requestId: m.sourceDocument!, skuId: m.skuId, quantity: Math.max(0, -(m._sum.quantity ?? 0)) }));
    // A supply move can rebind the task to a new request; its physical evidence is
    // keyed by task, not the old sourceDocument. Keep it out of the generic sum above.
    for (let offset = 0; offset < tasks.length; offset += 100) {
      const batch = tasks.slice(offset, offset + 100);
      const picks = await tx.stockMovement.findMany({ where: { clientId, warehouseId, status: 'PACKING',
        OR: batch.map(t => ({ idempotencyKey: { startsWith: `fbs-sticker-pick:${t.id}:` } })) }, select: { idempotencyKey: true, quantity: true } });
      const totals = new Map<string, number>();
      for (const pick of picks) { const id = pick.idempotencyKey?.split(':')[1]; if (id) totals.set(id, (totals.get(id) ?? 0) + pick.quantity); }
      for (const task of batch) physical.push({ requestId: task.requestId, skuId: task.skuId, quantity: Math.max(0, totals.get(task.id) ?? 0) });
    }
    const quantities = normalizeSharedStockSnapshot(available, requestRows, orders, physical);
    // No receipt-credit addition: leaving grandfathered reservations conservative cannot
    // make blocked receipts available for new marketplace sales.
    const scoped = new Map(skuIds.map(id => [id, quantities.get(id) ?? { available: 0, reserved: 0, free: 0 }]));
    const revision = createHash('sha256').update(JSON.stringify([...scoped].sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
    return { quantities: scoped, revision };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
}
