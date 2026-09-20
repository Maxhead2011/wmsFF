import { Prisma, type FbsTsdAssembly } from '@prisma/client';
import { sizeSubstitutionEnabled } from './fbs-size-substitution';

// FIX: approval follows the exact task/request/source, never a product-wide exception.
export async function approvedSizeRoutes(db: Prisma.TransactionClient, tasks: FbsTsdAssembly[]): Promise<Set<string>> {
  const candidates = tasks.filter(t => t.marketplace === 'WILDBERRIES' && t.sourceSkuId && t.relabelRequired &&
    !t.relabelConfirmedAt && !t.completedAt && !t.kiz && ['RESERVED', 'WAITING_STOCK'].includes(t.status));
  if (!sizeSubstitutionEnabled() || !candidates.length) return new Set();
  const rows = await db.$queryRaw<Array<{ taskId: string; requestId: string; clientId: string; sourceSkuId: string; targetSkuId: string; warehouseId: string }>>`
    SELECT * FROM "FbsSizeSubstitution" WHERE "taskId" IN (${Prisma.join(candidates.map(t => t.id))})`;
  return new Set(candidates.filter(t => rows.some(r => r.taskId === t.id && r.requestId === t.requestId &&
    r.clientId === t.clientId && r.sourceSkuId === t.sourceSkuId && r.targetSkuId === t.skuId && r.warehouseId === t.stockWarehouseId)).map(t => t.id));
}
