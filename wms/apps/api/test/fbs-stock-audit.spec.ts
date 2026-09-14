import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { validateFbsStockAudit } from '../src/modules/marketplace-connections/fbs-stock-audit';

afterEach(() => vi.unstubAllEnvs());
describe('FBS stock discrepancy routing', () => {
  // TEST: a physical-stock stop must carry scope; parsing translated prose cannot safely select a box.
  it('returns a structured audit stop without replacing an existing KIZ', () => {
    vi.stubEnv('WMS_FBS_PRESERVE_STOCK_KIZ', 'true');
    vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', 'true');
    const service = Object.create(MarketplaceConnectionsService.prototype) as any;
    try {
      service.assertFbsKizRegistrationCapacity({ id: 'task', clientId: 'client', boxId: 'box', boxCode: 'BOX016' }, 2, 2);
      expect.fail('must stop');
    } catch (error: any) {
      expect(error.getResponse()).toMatchObject({ code: 'FBS_STOCK_AUDIT_REQUIRED', taskId: 'task', clientId: 'client', boxCode: 'BOX016' });
    }
  });
  // TEST: sold/disabled installations keep their existing error contract.
  it('keeps the legacy response with the new flag disabled', () => {
    vi.stubEnv('WMS_FBS_PRESERVE_STOCK_KIZ', 'true');
    vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', 'false');
    const service = Object.create(MarketplaceConnectionsService.prototype) as any;
    expect(() => service.assertFbsKizRegistrationCapacity({ boxCode: 'BOX016' }, 2, 2)).toThrow('Замена существующего КИЗ');
  });
});

// TEST: the public service keeps client and active-task ownership checks in front of the read-only gate.
describe('FBS stock audit endpoint ownership', () => {
  function endpoint() {
    vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', 'true');
    const f = auditFixture();
    const db = { ...f.db, fbsTsdAssembly: { findUnique: vi.fn(async () => f.task) } };
    const service = Object.create(MarketplaceConnectionsService.prototype) as any;
    service.prisma = { $transaction: vi.fn(async (fn: any) => fn(db)) };
    service.clientScopes = { requireClientAccess: vi.fn() };
    service.fbsTsdDeviceCode = () => 'TSD';
    return { ...f, service, call: () => service.validateFbsTsdStockAudit('task', { sessionId: 'session' }, { id: 'worker' }) };
  }
  it('validates the active owned task and checks client access', async () => {
    const f = endpoint(); await expect(f.call()).resolves.toMatchObject({ ready: true });
    expect(f.service.clientScopes.requireClientAccess).toHaveBeenCalledWith({ id: 'worker' }, 'client', 'write');
  });
  it('rejects a task taken by another worker before reading inventory', async () => {
    const f = endpoint(); f.task.workerUserId = 'other';
    await expect(f.call()).rejects.toThrow('Задание на ТСД уже изменилось');
    expect(f.db.inventorySession.findUnique).not.toHaveBeenCalled();
  });
  it('rejects another device before reading inventory', async () => {
    const f = endpoint(); f.task.deviceCode = 'other';
    await expect(f.call()).rejects.toThrow('Задание на ТСД уже изменилось');
    expect(f.db.inventorySession.findUnique).not.toHaveBeenCalled();
  });
  it('can close the same worker audit after a manager released the task, without reviving it', async () => {
    const f = endpoint(); f.task.status = 'RELEASED'; f.task.workerUserId = null; f.task.boxId = null;
    await expect(f.call()).resolves.toMatchObject({ ready: true });
    expect(f.task.status).toBe('RELEASED'); expect(f.task.boxId).toBeNull();
  });
  // TEST: administrator release keeps stock-backed tasks RESERVED, not RELEASED.
  it('returns from a completed audit after administrator release to automatic reservation', async () => {
    vi.stubEnv('WMS_FBS_KIZ_RELABEL_ENABLED', 'true');
    const f = endpoint(); Object.assign(f.task, { status: 'RESERVED', workerUserId: null,
      deviceCode: 'AUTO:FBS:PALLET_SORT', boxId: null, boxCode: null });
    const before = structuredClone(f.task);
    await expect(f.call()).resolves.toMatchObject({ ready: true, taskId: 'task', sessionId: 'session' });
    expect(f.task).toEqual(before);
  });
  it.each(['other-worker', 'wrong-device', 'unfinished', 'foreign-audit', 'missing-kiz'])('keeps audit protection after reservation release: %s', async kind => {
    vi.stubEnv('WMS_FBS_KIZ_RELABEL_ENABLED', 'true');
    const f = endpoint(); Object.assign(f.task, { status: 'RESERVED', workerUserId: null,
      deviceCode: 'AUTO:FBS:PALLET_SORT', boxId: null, boxCode: null });
    if (kind === 'other-worker') f.task.workerUserId = 'other';
    if (kind === 'wrong-device') f.task.deviceCode = 'TSD-OTHER';
    if (kind === 'unfinished') f.session.status = 'IN_PROGRESS';
    if (kind === 'foreign-audit') f.session.createdByUserId = 'other';
    if (kind === 'missing-kiz') f.evidence.length = 0;
    await expect(f.call()).rejects.toThrow();
  });
  it('does not expose the endpoint in a disabled installation', async () => {
    const f = endpoint(); vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', 'false');
    await expect(f.call()).rejects.toThrow('недоступна');
    expect(f.service.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('keeps reserved-task behavior unchanged with the relabel rollout disabled', async () => {
    vi.stubEnv('WMS_FBS_KIZ_RELABEL_ENABLED', 'false');
    const f = endpoint(); Object.assign(f.task, { status: 'RESERVED', workerUserId: null,
      deviceCode: 'AUTO:FBS:PALLET_SORT', boxId: null });
    await expect(f.call()).rejects.toThrow('Задание на ТСД уже изменилось');
  });
});

const kiz = '010460000000000121SERIAL0000001\u001d91TEST\u001d92CRYPTO';
const anotherKiz = kiz.replace('SERIAL0000001', 'SERIAL0000002');
function auditFixture() {
  const task = { id: 'task', clientId: 'client', boxId: 'box', boxCode: 'BOX016', requestId: 'request',
    skuId: 'sku', wbMetaStatus: null, kiz: null, itemCount: 1, status: 'IN_PROGRESS', workerUserId: 'worker', deviceCode: 'TSD' } as any;
  const startedAt = new Date('2026-09-14T00:00:00Z');
  const audit = { id: 'audit', boxId: 'box', boxCode: 'BOX016', startedAt, status: 'MATCHED',
    lines: [{ skuId: 'sku', countedQuantity: 1, difference: 0, decision: 'KEEP_SYSTEM' }] };
  const session = { id: 'session', type: 'BOX_CHECK', status: 'COMPLETED', clientId: 'client', warehouseId: 'warehouse', createdByUserId: 'worker',
    comment: '[FBS_MANDATORY_BOX_CHECK] [FBS_KIZ_STOCK_CHECK] task; discrepancy', boxes: [audit] };
  const marks = [{ id: 'mark', value: kiz, skuId: 'sku', clientId: 'client', boxId: 'box', status: 'AVAILABLE' }];
  const balances = [{ skuId: 'sku', clientId: 'client', warehouseId: 'warehouse', quantity: 1, status: 'AVAILABLE' }];
  const evidence = [{ payload: { sessionId: 'session', boxId: 'box', clientId: 'client', skuId: 'sku',
    roundStartedAt: startedAt.toISOString(), kiz } }];
  const db = {
    inventorySession: { findUnique: vi.fn(async () => session) },
    box: { findUnique: vi.fn(async () => ({ clientId: 'client', warehouseId: 'warehouse', status: 'active' })) },
    clientRequest: { findUnique: vi.fn(async () => ({ warehouseId: 'warehouse' })) },
    productMark: { findMany: vi.fn(async () => marks), findFirst: vi.fn(async () => marks[0] ?? null) },
    stockBalance: { findMany: vi.fn(async () => balances) },
    auditLog: { findMany: vi.fn(async () => evidence) },
    sku: { findMany: vi.fn(async () => [{ id: 'sku', needsChestnyZnak: true, isUnmarked: false }]) },
    stockMovement: { findMany: vi.fn(async () => [] as { quantity: number }[]) },
  };
  return { task, audit, session, marks, balances, evidence, db, run: () => validateFbsStockAudit(db as any, task, 'session', 'worker') };
}

// TEST: a matched count with a substituted KIZ must remain stopped. Every dependency exposes reads only.
describe('physical KIZ audit return gate', () => {
  it('allows confirmed composition without stock/WB writes, including retries', async () => {
    const f = auditFixture();
    await expect(f.run()).resolves.toMatchObject({ ready: true, taskId: 'task', sessionId: 'session' });
    await expect(f.run()).resolves.toMatchObject({ ready: true });
    expect(f.balances[0].quantity).toBe(1);
    expect(f.marks[0].value).toBe(kiz);
  });
  it('blocks quantity-only actualization when a recorded KIZ was not physically scanned', async () => {
    const f = auditFixture(); f.evidence[0].payload.kiz = anotherKiz;
    await expect(f.run()).rejects.toThrow('состав КИЗ');
    expect(f.marks[0].value).toBe(kiz);
  });
  it('requires unique physical scans, not a manual count', async () => {
    const f = auditFixture(); f.evidence.length = 0;
    await expect(f.run()).rejects.toThrow('состав КИЗ');
  });
  it('ignores scan evidence from a previous recount round', async () => {
    const f = auditFixture(); f.evidence[0].payload.roundStartedAt = '2026-09-13T00:00:00Z';
    await expect(f.run()).rejects.toThrow('состав КИЗ');
  });
  it('blocks duplicate registered identities even with different crypto tails', async () => {
    const f = auditFixture(); f.marks.push({ ...f.marks[0], id: 'duplicate', value: kiz.replace('CRYPTO', 'OTHER') });
    await expect(f.run()).rejects.toThrow('состав КИЗ');
  });
  it('allows an actual imported quantity gap without replacing existing KIZs', async () => {
    const f = auditFixture(); f.marks.length = 0;
    await expect(f.run()).resolves.toMatchObject({ ready: true });
    expect(f.marks).toEqual([]);
  });
  it.each(['client', 'box', 'task', 'type'])('rejects another %s in the supplied audit', async field => {
    const f = auditFixture();
    if (field === 'client') f.session.clientId = 'other';
    if (field === 'box') f.audit.boxId = 'other';
    if (field === 'task') f.session.comment = '[FBS_KIZ_STOCK_CHECK] other';
    if (field === 'type') f.session.type = 'PARTIAL';
    await expect(f.run()).rejects.toThrow('не относится');
  });
  it('rejects cross-branch balances', async () => {
    const f = auditFixture(); f.balances[0].warehouseId = 'sold';
    await expect(f.run()).rejects.toThrow('другая принадлежность');
  });
  // TEST: administrator BOX_CHECK sessions intentionally have no warehouse restriction.
  // The box and the FBS request still have to belong to the same physical branch.
  it('accepts an unrestricted administrator audit in the request warehouse', async () => {
    const f = auditFixture(); (f.session as any).warehouseId = null;
    await expect(f.run()).resolves.toMatchObject({ ready: true });
  });
  it('does not allow an unrestricted audit to cross the FBS request warehouse', async () => {
    const f = auditFixture(); (f.session as any).warehouseId = null;
    f.db.clientRequest.findUnique.mockResolvedValue({ warehouseId: 'other-branch' });
    await expect(f.run()).rejects.toThrow('филиал');
  });
  it('still rejects an explicitly different audit warehouse', async () => {
    const f = auditFixture(); f.session.warehouseId = 'other-branch';
    await expect(f.run()).rejects.toThrow('филиал');
  });
  it('rejects stale quantity after a parallel movement', async () => {
    const f = auditFixture(); f.balances[0].quantity = 0;
    await expect(f.run()).rejects.toThrow('не совпадает');
  });
  it('requires completed inventory, even when counts match', async () => {
    const f = auditFixture(); f.session.status = 'ACTIVE';
    await expect(f.run()).rejects.toThrow('завершите');
  });
  it('rejects another worker audit even for a released task', async () => {
    const f = auditFixture(); f.task.status = 'RELEASED'; f.session.createdByUserId = 'other';
    await expect(f.run()).rejects.toThrow('не относится');
  });
  it('preserves the accepted WB KIZ when the pick has not yet committed', async () => {
    const f = auditFixture(); f.task.kiz = kiz; f.task.wbMetaStatus = 'ACCEPTED';
    await expect(f.run()).resolves.toMatchObject({ ready: true });
    expect(f.db.productMark.findFirst).toHaveBeenCalledWith({ where: { clientId: 'client', skuId: 'sku', value: kiz, status: 'AVAILABLE', boxId: 'box' } });
    expect(f.task.kiz).toBe(kiz);
  });
  it('does not require an already picked KIZ back in the original box', async () => {
    const f = auditFixture(); f.task.kiz = kiz; f.task.wbMetaStatus = 'ACCEPTED';
    f.audit.lines[0].countedQuantity = 0; f.balances[0].quantity = 0; f.marks.length = 0; f.evidence.length = 0;
    f.db.stockMovement.findMany.mockResolvedValue([{ quantity: 1 }]);
    f.db.productMark.findFirst.mockResolvedValue({ id: 'picked', value: kiz, skuId: 'sku', clientId: 'client', boxId: null, status: 'PACKING' } as any);
    await expect(f.run()).resolves.toMatchObject({ ready: true });
    expect(f.db.productMark.findFirst).toHaveBeenCalledWith({ where: { clientId: 'client', skuId: 'sku', value: kiz, status: 'PACKING' } });
    expect(f.balances[0].quantity).toBe(0);
  });
  it('does not recreate a missing WB-accepted KIZ from audit scans', async () => {
    const f = auditFixture(); f.task.kiz = kiz; f.task.wbMetaStatus = 'ACCEPTED'; f.marks.length = 0;
    await expect(f.run()).rejects.toThrow('Привязка WB сохранена');
  });
  // TEST: a separate return receipt may already have placed the picked unit into another box.
  it('allows finishing the old box audit after a return without restoring the old placement', async () => {
    const f = auditFixture(); f.task.kiz = kiz; f.task.wbMetaStatus = 'ACCEPTED'; f.task.status = 'RELEASED';
    f.task.boxId = null;
    f.audit.lines[0].countedQuantity = 0; f.balances[0].quantity = 0; f.marks.length = 0; f.evidence.length = 0;
    await expect(f.run()).resolves.toMatchObject({ ready: true });
    expect(f.db.stockMovement.findMany).not.toHaveBeenCalled();
    expect(f.db.productMark.findFirst).not.toHaveBeenCalled();
    expect(f.balances[0].quantity).toBe(0);
  });
});
