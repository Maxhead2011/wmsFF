import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type Movement = { id: string; sourceDocument: string | null; quantity: number; createdAt: Date; idempotencyKey: string | null };
type Request = { id: string; number: number; clientId: string; warehouseId: string | null; status: string; type: string };
type Task = { id: string; requestId: string; updatedAt: Date };
type ShipmentProof = { assemblyId: string; requestId: string; clientId: string; warehouseId: string | null; skuId: string; quantity: number; shippedAt: Date };
type Balance = { id: string; clientId: string; warehouseId: string | null; skuId: string; boxId: string | null; palletId: string | null; quantity: number };
export const historicalPackingEnabled = () => process.env.WMS_HISTORICAL_PACKING_REPAIR_ENABLED === 'true';

// FIX: historical cleanup uses DONE as the same shipment authority as the normal
// close workflow. Unknown deductions consume eligible old stock first. Today's
// and non-DONE requests are never used to fund a correction.
export function planHistoricalPacking(balance: Balance, movements: Movement[], requests: Request[], tasks: Task[], cutoff: Date, proofs: ShipmentProof[] = []) {
  if (!Number.isFinite(cutoff.getTime())) throw new Error('Invalid explicit cutoff');
  const byDoc = new Map<string | null, { quantity: number; today: boolean; first: number; taskIds: Set<string> }>();
  for (const m of movements) {
    const group = byDoc.get(m.sourceDocument) ?? { quantity: 0, today: false, first: Infinity, taskIds: new Set<string>() };
    group.quantity += m.quantity;
    if (m.quantity > 0) {
      group.today ||= m.createdAt >= cutoff;
      group.first = Math.min(group.first, m.createdAt.getTime());
      if (m.idempotencyKey?.startsWith('fbs-sticker-pick:')) group.taskIds.add(m.idempotencyKey.split(':')[1]);
    }
    byDoc.set(m.sourceDocument, group);
  }
  if (movements.reduce((sum, m) => sum + m.quantity, 0) !== balance.quantity) throw new ConflictException('Packing ledger differs from balance');
  const taskById = new Map(tasks.map(t => [t.id, t]));
  // FIX: archived/deleted tasks still have immutable shipment evidence. Never
  // replace a present transferred task's ownership with its older shipment.
  const archivedProof = (id: string, requestId: string) => {
    const ownQuantity = movements.filter(m => m.idempotencyKey?.startsWith(`fbs-sticker-pick:${id}:`)).reduce((s, m) => s + m.quantity, 0);
    return !taskById.has(id) && proofs.some(p => p.assemblyId === id && p.requestId === requestId &&
      p.clientId === balance.clientId && p.warehouseId === balance.warehouseId && p.skuId === balance.skuId &&
      p.shippedAt < cutoff && p.quantity >= ownQuantity);
  };
  let deductions = -[...byDoc.values()].reduce((sum, g) => sum + Math.min(0, g.quantity), 0);
  const eligible = requests.filter(r => {
    const g = byDoc.get(r.id);
    return g && g.quantity > 0 && !g.today && r.status === 'DONE' && ['OUTBOUND', 'DELIVERY'].includes(r.type) &&
      r.clientId === balance.clientId && Boolean(balance.warehouseId) && r.warehouseId === balance.warehouseId &&
      [...g.taskIds].every(id => taskById.get(id)?.requestId === r.id || archivedProof(id, r.id));
  }).sort((a, b) => byDoc.get(a.id)!.first - byDoc.get(b.id)!.first || a.id.localeCompare(b.id));
  const debits: { requestId: string; number: number; quantity: number }[] = [];
  for (const r of eligible) {
    const own = byDoc.get(r.id)!.quantity;
    const absorbed = Math.min(own, deductions);
    deductions -= absorbed;
    if (own > absorbed) debits.push({ requestId: r.id, number: r.number, quantity: own - absorbed });
  }
  const quantity = debits.reduce((sum, d) => sum + d.quantity, 0);
  if (quantity > balance.quantity) throw new ConflictException('Historical correction exceeds balance');
  // FIX: apply must reproduce the reviewed plan, including task ownership and
  // every intervening movement. A changed request or new scan invalidates it.
  const fingerprint = createHash('sha256').update(JSON.stringify({ cutoff, balance,
    movements: [...movements].sort((a, b) => a.id.localeCompare(b.id)),
    requests: [...requests].sort((a, b) => a.id.localeCompare(b.id)),
    tasks: [...tasks].sort((a, b) => a.id.localeCompare(b.id)),
    proofs: [...proofs].sort((a, b) => a.assemblyId.localeCompare(b.assemblyId)), debits })).digest('hex');
  return { balanceId: balance.id, before: balance.quantity, quantity, after: balance.quantity - quantity, debits, fingerprint };
}

// FIX: caller supplies a transaction and a reviewed fingerprint to authorize
// mutations. Preview has no writes or locks and works in READ ONLY transactions.
export async function reconcileHistoricalPacking(tx: Prisma.TransactionClient, balanceId: string, cutoff: Date, expected?: string) {
  if (expected && !historicalPackingEnabled()) throw new Error('Historical repair flag is disabled');
  const select = { id: true, clientId: true, warehouseId: true, skuId: true, boxId: true, palletId: true, quantity: true } as const;
  const initial = await tx.stockBalance.findUniqueOrThrow({ where: { id: balanceId }, select: { ...select, status: true } });
  if (initial.status !== 'PACKING') throw new Error('Only PACKING may be reconciled');
  const where = { clientId: initial.clientId, warehouseId: initial.warehouseId, skuId: initial.skuId,
    boxId: initial.boxId, palletId: initial.palletId, status: 'PACKING' as const };
  const movementSelect = { id: true, sourceDocument: true, quantity: true, createdAt: true, idempotencyKey: true } as const;
  const first = await tx.stockMovement.findMany({ where, select: movementSelect });
  const requestIds = [...new Set(first.map(m => m.sourceDocument).filter((v): v is string => Boolean(v)))].sort();
  const taskIds = [...new Set(first.filter(m => m.quantity > 0 && m.idempotencyKey?.startsWith('fbs-sticker-pick:')).map(m => m.idempotencyKey!.split(':')[1]))].sort();
  if (expected) {
    // FIX: request -> assembly -> balance agrees with the production workflows.
    if (requestIds.length) await tx.$queryRaw`SELECT id FROM "ClientRequest" WHERE id IN (${Prisma.join(requestIds)}) ORDER BY id FOR UPDATE`;
    if (taskIds.length) await tx.$queryRaw`SELECT id FROM "FbsTsdAssembly" WHERE id IN (${Prisma.join(taskIds)}) ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "StockBalance" WHERE id=${balanceId} FOR UPDATE`;
  }
  const balance = await tx.stockBalance.findUniqueOrThrow({ where: { id: balanceId }, select });
  const movements = await tx.stockMovement.findMany({ where, select: movementSelect });
  const requests = await tx.clientRequest.findMany({ where: { id: { in: requestIds } }, select: {
    id: true, number: true, clientId: true, warehouseId: true, status: true, type: true } });
  const tasks = await tx.fbsTsdAssembly.findMany({ where: { id: { in: taskIds } }, select: { id: true, requestId: true, updatedAt: true } });
  const present = new Set(tasks.map(t => t.id));
  const missing = taskIds.filter(id => !present.has(id));
  const proofSelect = { assemblyId: true, requestId: true, clientId: true, warehouseId: true, skuId: true, shippedAt: true } as const;
  const shipments = missing.length ? await tx.wbOrderShipment.findMany({ where: { clientId: balance.clientId, assemblyId: { in: missing } }, select: { ...proofSelect, quantity: true } }) : [];
  const kizShipments = missing.length ? await tx.shippedKizHistory.findMany({ where: { clientId: balance.clientId, assemblyId: { in: missing } }, select: proofSelect }) : [];
  const proofs = [...shipments, ...kizShipments.filter(p => p.assemblyId && p.requestId && !shipments.some(s => s.assemblyId === p.assemblyId))
    .map(p => ({ ...p, assemblyId: p.assemblyId!, requestId: p.requestId!, quantity: 1 }))];
  const plan = planHistoricalPacking(balance, movements, requests, tasks, cutoff, proofs);
  if (!expected) return plan;
  if (plan.fingerprint !== expected) throw new ConflictException('Reviewed plan changed; make a new preview');
  if (!plan.quantity) return plan;
  const changed = await tx.stockBalance.updateMany({ where: { id: balanceId, quantity: balance.quantity, status: 'PACKING' }, data: { quantity: { decrement: plan.quantity } } });
  if (changed.count !== 1) throw new ConflictException('Concurrent stock change');
  // FIX: these shipments already exist. Record a stock correction, not a second
  // shipment that could inflate shipment-based reports.
  for (const debit of plan.debits) await tx.stockMovement.create({ data: { ...where, type: 'INVENTORY_ADJUSTMENT', quantity: -debit.quantity,
    sourceDocument: debit.requestId, idempotencyKey: `historical-packing:${plan.fingerprint}:${debit.requestId}`,
    comment: `Сверка старой сданной заявки №${debit.number}; исключены положительные движения от ${cutoff.toISOString()}. Остаток ${balance.quantity} -> ${plan.after}. AVAILABLE не списывается повторно.` } });
  return plan;
}
