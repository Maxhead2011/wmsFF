import { afterEach, expect, it, vi } from 'vitest';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { InventoryResolutionAction } from '../src/modules/inventory/dto/inventory.dto';

const startedAt = new Date('2026-09-09T09:00:00Z');
const user: any = { id: 'admin', name: 'Администратор' };
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
  const auditBox: any = { id: 'audit', boxId: 'source', boxCode: 'SOURCE', clientId: 'client', startedAt,
    session: { type: 'BOX_CHECK', status: 'REVIEW', warehouseId: 'wh', title: 'Сверка', comment: null } };
  const line: any = { id: 'line', auditBoxId: 'audit', skuId: 'sku', countedQuantity: 3, decision: 'PENDING', decidedAt: null, auditBox };
  const box = { id: 'source', code: 'SOURCE', clientId: 'client', warehouseId: 'wh', palletId: null, status: 'active' };
  let quantity = 1;
  const movements: any[] = [{ id: 'sorting-move', boxId: 'source', skuId: 'sku', createdAt: new Date('2026-09-09T09:10:00Z'), sourceDocument: 'PALLET_SORTING:session' }];
  const db: any = {
    inventoryAuditLine: { findUnique: vi.fn(async () => line), updateMany: vi.fn(async () => { line.decision = 'APPLY_ACTUAL'; return { count: 1 }; }) },
    inventoryAuditBox: { findUnique: vi.fn(async () => auditBox) },
    box: { findUnique: vi.fn(async () => box) },
    stockBalance: { findFirst: vi.fn(async () => ({ id: 'balance', quantity })),
      update: vi.fn(async ({ data }: any) => { quantity = data.quantity; }), delete: vi.fn(async () => { quantity = 0; }), create: vi.fn() },
    stockMovement: { findFirst: vi.fn(async ({ where }: any) => movements.find(m => m.boxId === where.boxId && m.skuId === where.skuId &&
      m.createdAt >= where.createdAt.gte && m.sourceDocument.startsWith(where.sourceDocument.startsWith)) ?? null), create: vi.fn() },
    $transaction: vi.fn(async (run: any) => {
      const beforeQuantity = quantity, beforeDecision = line.decision;
      try { return await run(db); } catch (error) { quantity = beforeQuantity; line.decision = beforeDecision; throw error; }
    }),
  };
  const service: any = new InventoryService(db, { requireClientAccess: vi.fn() } as never, {} as never);
  service.requireManager = vi.fn(); service.requireSessionWarehouse = vi.fn(); service.requirePhysicalBoxWarehouse = vi.fn();
  service.refreshBoxResolution = vi.fn();
  return { service, db, line, auditBox, movements, quantity: () => quantity };
}
it.each(['FULL', 'BOX_CHECK'].flatMap(type => [InventoryResolutionAction.APPLY_ACTUAL, InventoryResolutionAction.DELETE_FROM_BOX].map(action => ({ type, action }))))('rejects stale destructive decision after ADMIN sorting: %j', async ({ type, action }) => {
  // TEST: old counted=3 must neither restore source stock nor delete a later physical unit.
    const f = fixture(); f.auditBox.session.type = type;
    await expect(f.service.decideLine('line', { action }, user)).rejects.toThrow('сортиров');
    expect(f.quantity()).toBe(1); expect(f.line.decision).toBe('PENDING');
    expect(f.db.stockBalance.update).not.toHaveBeenCalled(); expect(f.db.stockBalance.delete).not.toHaveBeenCalled();
    expect(f.db.stockMovement.create).not.toHaveBeenCalled(); expect(f.service.refreshBoxResolution).not.toHaveBeenCalled();
    expect(f.db.stockMovement.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      boxId: 'source', skuId: 'sku', createdAt: { gte: startedAt }, sourceDocument: { startsWith: 'PALLET_SORTING:' },
    } }));
});
it('allows a new recount started after the administrative movement', async () => {
  // TEST: the conflict asks for a fresh physical count, not a permanent box block.
  const f = fixture(); f.auditBox.startedAt = new Date('2026-09-09T09:20:00Z');
  await f.service.decideLine('line', { action: InventoryResolutionAction.APPLY_ACTUAL }, user);
  expect(f.quantity()).toBe(3); expect(f.db.stockMovement.create).toHaveBeenCalledTimes(1);
});
it('allows older sorting history before the count snapshot', async () => {
  const f = fixture(); f.movements[0].createdAt = new Date('2026-09-09T08:00:00Z');
  await f.service.decideLine('line', { action: InventoryResolutionAction.APPLY_ACTUAL }, user);
  expect(f.quantity()).toBe(3);
});
it.each(['other-box', 'other-sku', 'ordinary-transfer'])('does not extend this guard to unrelated movement: %s', async condition => {
  // TEST: existing non-sorting inventory behavior is outside this narrow fix.
  const f = fixture();
  if (condition === 'other-box') f.movements[0].boxId = 'other';
  if (condition === 'other-sku') f.movements[0].skuId = 'other';
  if (condition === 'ordinary-transfer') f.movements[0].sourceDocument = 'TSD_TRANSFER';
  await f.service.decideLine('line', { action: InventoryResolutionAction.APPLY_ACTUAL }, user);
  expect(f.quantity()).toBe(3);
});
it('keeps the sold/disabled installation path unchanged', async () => {
  // TEST: the new guard has the same installation flag as administrative sorting.
  const f = fixture(); vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'false');
  await f.service.decideLine('line', { action: InventoryResolutionAction.APPLY_ACTUAL }, user);
  expect(f.quantity()).toBe(3); expect(f.db.stockMovement.findFirst).not.toHaveBeenCalled();
});
it('does not block accepting unchanged stock without a stock mutation', async () => {
  const f = fixture();
  await f.service.decideLine('line', { action: InventoryResolutionAction.ACCEPT_AS_IS }, user);
  expect(f.quantity()).toBe(1); expect(f.db.stockMovement.findFirst).not.toHaveBeenCalled();
  expect(f.db.stockMovement.create).not.toHaveBeenCalled();
});
