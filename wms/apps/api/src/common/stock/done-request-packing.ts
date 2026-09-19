import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// FIX: opt-in only for our installation; sold WMS retains its existing behavior.
export const doneRequestPackingEnabled = () => process.env.WMS_DONE_PACKING_RECONCILIATION_ENABLED === 'true';

type LedgerRow = { sourceDocument: string | null; quantity: number };
// FIX: a request may consume only its proven residual, never another request's stock.
export function donePackingQuantity(requestId: string, quantity: number, ledger: LedgerRow[]) {
  const byRequest = new Map<string | null, number>();
  for (const row of ledger) byRequest.set(row.sourceDocument, (byRequest.get(row.sourceDocument) ?? 0) + row.quantity);
  const own = byRequest.get(requestId) ?? 0;
  if (own <= 0) return 0;
  if (Array.from(byRequest.values()).some(value => value < 0) ||
      ledger.reduce((sum, row) => sum + row.quantity, 0) !== quantity || own > quantity) {
    throw new ConflictException('Остаток «В сборке» не сходится с движениями заявок. Требуется сверка, автоматическое списание остановлено.');
  }
  return own;
}

// FIX: run inside the caller's transaction; all balances are checked before any debit.
export async function reconcileDoneRequestPacking(tx: Prisma.TransactionClient, requestId: string, dryRun = false) {
  if (!dryRun && !doneRequestPackingEnabled()) return 0;
  if (!dryRun) await tx.$queryRaw`SELECT id FROM "ClientRequest" WHERE id=${requestId} FOR UPDATE`;
  const request = await tx.clientRequest.findUnique({ where: { id: requestId }, select: {
    id: true, number: true, clientId: true, warehouseId: true, status: true, type: true,
  } });
  if (!request || request.status !== 'DONE' || !['OUTBOUND', 'DELIVERY'].includes(request.type)) return 0;
  const groups = await tx.stockMovement.groupBy({ by: ['warehouseId', 'skuId', 'boxId', 'palletId'],
    where: { clientId: request.clientId, sourceDocument: request.id, status: 'PACKING' }, _sum: { quantity: true },
  });
  const candidates = groups.filter(group => (group._sum.quantity ?? 0) > 0);
  if (!candidates.length) return 0;
  // FIX: request -> task -> balance matches print/transfer lock order.
  const picks = await tx.stockMovement.findMany({ where: { clientId: request.clientId, sourceDocument: request.id,
    status: 'PACKING', quantity: { gt: 0 }, idempotencyKey: { startsWith: 'fbs-sticker-pick:' } }, select: { idempotencyKey: true } });
  const taskIds = [...new Set(picks.map(row => row.idempotencyKey!.split(':')[1]))].sort();
  for (let offset = 0; offset < taskIds.length; offset += 1000) {
    const ids = taskIds.slice(offset, offset + 1000);
    if (!dryRun) await tx.$queryRaw`SELECT id FROM "FbsTsdAssembly" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
    if (await tx.fbsTsdAssembly.count({ where: { id: { in: ids }, requestId: { not: request.id } } })) {
      throw new ConflictException('Отбор перенесён в другую заявку. Требуется сверка истории переноса.');
    }
  }
  const plans: Array<{ balance: { id: string; warehouseId: string | null; skuId: string; boxId: string | null; palletId: string | null; quantity: number }; quantity: number }> = [];
  // FIX: fixed lock order protects shared packing balances across concurrent requests.
  candidates.sort((a, b) => JSON.stringify([a.warehouseId, a.skuId, a.boxId, a.palletId]).localeCompare(JSON.stringify([b.warehouseId, b.skuId, b.boxId, b.palletId])));
  for (const group of candidates) {
    if (!request.warehouseId || group.warehouseId !== request.warehouseId) {
      throw new ConflictException('Филиал движений не совпадает со сданной заявкой. Требуется сверка.');
    }
    const where = { clientId: request.clientId, warehouseId: group.warehouseId, skuId: group.skuId,
      boxId: group.boxId, palletId: group.palletId, status: 'PACKING' as const };
    const found = await tx.stockBalance.findMany({ where, select: { id: true } });
    if (found.length !== 1) throw new ConflictException('Не найден однозначный остаток сданной заявки. Требуется сверка.');
    if (!dryRun) await tx.$queryRaw`SELECT id FROM "StockBalance" WHERE id=${found[0].id} FOR UPDATE`;
    const balance = await tx.stockBalance.findUniqueOrThrow({ where: { id: found[0].id } });
    const ledger = await tx.stockMovement.findMany({ where, select: { sourceDocument: true, quantity: true, idempotencyKey: true } });
    const quantity = donePackingQuantity(request.id, balance.quantity, ledger);
    plans.push({ balance, quantity });
  }
  if (dryRun) return plans.reduce((sum, plan) => sum + plan.quantity, 0);
  for (const { balance, quantity } of plans) {
    if (!quantity) continue;
    const changed = await tx.stockBalance.updateMany({ where: { id: balance.id, quantity: balance.quantity }, data: { quantity: { decrement: quantity } } });
    if (changed.count !== 1) throw new ConflictException('Остаток изменился. Повторите закрытие заявки.');
    await tx.stockMovement.create({ data: { clientId: request.clientId, warehouseId: balance.warehouseId,
      skuId: balance.skuId, boxId: balance.boxId, palletId: balance.palletId, status: 'PACKING', type: 'SHIP', quantity: -quantity,
      sourceDocument: request.id, idempotencyKey: `done-packing:${request.id}:${balance.id}`,
      comment: `Закрытие остатка «В сборке» сданной заявки №${request.number}. Без повторного списания AVAILABLE.`,
    } });
  }
  return plans.reduce((sum, plan) => sum + plan.quantity, 0);
}
