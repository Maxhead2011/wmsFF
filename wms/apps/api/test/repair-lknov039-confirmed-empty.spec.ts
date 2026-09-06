import { describe, expect, it, vi } from 'vitest';
import { approvedEmptyBox, validateEmptyBoxSnapshot, applyEmptyBoxSnapshot, classifyEmptyBoxRepair, emptyBoxRepairKey, emptyBoxSnapshotDigest } from '../src/scripts/repair-lknov039-confirmed-empty';

// TEST: this repair is restricted to the explicitly confirmed source, not a generic write-off.
function snapshot(): any {
  return {
    box: { id: approvedEmptyBox.id, code: approvedEmptyBox.code, clientId: approvedEmptyBox.clientId,
      warehouseId: approvedEmptyBox.warehouseId, status: 'active', storagePlacement: { palletId: 'pallet' } },
    balances: approvedEmptyBox.balances.map(b => ({ ...b, boxId: approvedEmptyBox.id,
      clientId: approvedEmptyBox.clientId, warehouseId: approvedEmptyBox.warehouseId,
      palletId: null, updatedAt: new Date('2026-09-06') })),
    marks: [{ id: approvedEmptyBox.availableMarkId, skuId: approvedEmptyBox.skuId, boxId: approvedEmptyBox.id,
      clientId: approvedEmptyBox.clientId, status: 'AVAILABLE', updatedAt: new Date('2026-09-06') },
      { id: 'old-shipped-mark', status: 'SHIPPING', boxId: approvedEmptyBox.id, clientId: approvedEmptyBox.clientId }],
    requests: [303, 334, 523].map(number => ({ id: `req-${number}`, number, status: 'DONE' })),
    activeTasks: [], counting: 0, protected: { targetBoxCode: 'FFL_LKBBOX_012', quantity: 1 },
  };
}
describe('confirmed empty LKNOV039 correction', () => {
  // TEST: idempotency is checked before validating a later refilled source.
  it('recognizes a completed correction without running it again', () => {
    const movements = approvedEmptyBox.balances.map(b => ({ ...b, quantity: -b.quantity,
      idempotencyKey: `${emptyBoxRepairKey}:${b.id}`, boxId: approvedEmptyBox.id,
      clientId: approvedEmptyBox.clientId, warehouseId: approvedEmptyBox.warehouseId, type: 'INVENTORY_ADJUSTMENT' }));
    expect(classifyEmptyBoxRepair(movements, { id: 'audit' })).toBe(true);
    expect(() => classifyEmptyBoxRepair(movements, null)).toThrow();
    expect(() => classifyEmptyBoxRepair(movements.slice(1), { id: 'audit' })).toThrow();
    expect(classifyEmptyBoxRepair([], null)).toBe(false);
    movements[0].quantity = -3;
    expect(() => classifyEmptyBoxRepair(movements, { id: 'audit' })).toThrow();
  });
  it('invalidates approval digest when a target or source changes', () => {
    const s = snapshot(); const before = emptyBoxSnapshotDigest(s);
    s.protected.quantity = 2;
    expect(emptyBoxSnapshotDigest(s)).not.toBe(before);
  });
  it('accepts only two AVAILABLE and four stale PACKING units', () => {
    expect(validateEmptyBoxSnapshot(snapshot())).toEqual({ available: 2, packing: 4 });
  });
  it.each(['box', 'client', 'warehouse', 'quantity', 'extra balance', 'active mark', 'active task', 'inventory', 'request reopened'])('rejects changed %s', fault => {
    const s = snapshot();
    if (fault === 'box') s.box.code = 'FFL_LKB1107_425';
    if (fault === 'client') s.box.clientId = 'other';
    if (fault === 'warehouse') s.balances[0].warehouseId = 'other';
    if (fault === 'quantity') s.balances[0].quantity++;
    if (fault === 'extra balance') s.balances.push({ ...s.balances[0], id: 'new' });
    if (fault === 'active mark') s.marks.push({ id: 'new', status: 'AVAILABLE' });
    if (fault === 'active task') s.activeTasks.push({ id: 'task' });
    if (fault === 'inventory') s.counting = 1;
    if (fault === 'request reopened') s.requests[0].status = 'IN_WORK';
    expect(() => validateEmptyBoxSnapshot(s)).toThrow();
  });
  function tx() {
    return { stockMovement: { findMany: vi.fn(async () => []), create: vi.fn(async ({ data }: any) => ({ id: data.idempotencyKey })) },
      stockBalance: { deleteMany: vi.fn(async () => ({ count: 1 })) },
      productMark: { updateMany: vi.fn(async () => ({ count: 1 })) },
      auditLog: { findFirst: vi.fn(async () => null), create: vi.fn() }, box: { update: vi.fn() } };
  }
  it('creates correction movements, never another shipment or target stock', async () => {
    const t = tx(); const s = snapshot();
    await applyEmptyBoxSnapshot(t as never, s);
    expect(t.stockMovement.create.mock.calls.map(([a]: any) => [a.data.type, a.data.status, a.data.quantity]))
      .toEqual([['INVENTORY_ADJUSTMENT', 'PACKING', -4], ['INVENTORY_ADJUSTMENT', 'AVAILABLE', -1], ['INVENTORY_ADJUSTMENT', 'AVAILABLE', -1]]);
    expect(t.productMark.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { boxId: null, status: 'BLOCKED' } }));
    expect(t.box.update).not.toHaveBeenCalled();
    expect(t.auditLog.create).toHaveBeenCalledTimes(1);
    expect(t.stockBalance.deleteMany.mock.calls.every(([a]: any) => a.where.boxId === approvedEmptyBox.id)).toBe(true);
  });
  it('rejects a concurrent balance mutation instead of hiding it', async () => {
    const t = tx(); t.stockBalance.deleteMany.mockResolvedValue({ count: 0 });
    await expect(applyEmptyBoxSnapshot(t as never, snapshot())).rejects.toThrow();
    expect(t.productMark.updateMany).not.toHaveBeenCalled();
    expect(t.auditLog.create).not.toHaveBeenCalled();
  });
  it('rejects a concurrent KIZ mutation', async () => {
    const t = tx(); t.productMark.updateMany.mockResolvedValue({ count: 0 });
    await expect(applyEmptyBoxSnapshot(t as never, snapshot())).rejects.toThrow();
    expect(t.auditLog.create).not.toHaveBeenCalled();
  });
  it('propagates audit errors so the encompassing transaction rolls back', async () => {
    const t = tx(); t.auditLog.create.mockRejectedValue(new Error('audit failed'));
    await expect(applyEmptyBoxSnapshot(t as never, snapshot())).rejects.toThrow('audit failed');
  });
});
