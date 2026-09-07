import { afterEach, describe, expect, it, vi } from 'vitest';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';
import { TsdReviewService } from '../src/modules/tsd/tsd-review.service';
import { TsdPayloadParser } from '../src/modules/tsd/tsd-payload.parser';

// TEST: complete physical recount replaces stale identities, never numeric stock or order ownership.
const barcode = '2051761490973';
const kiz = (serial: string) => `0104640569959669215${serial.padEnd(12, 'x')}\u001d91EE12\u001d92test`;
const oldKiz = kiz('old'), newKiz = kiz('new');
const user = { id: 'worker', name: 'Сборщик', deviceCode: 'TSD', roleCodes: ['OPERATOR'],
  activeWarehouseId: 'wh', writableWarehouseIds: ['wh'], permissionCodes: ['stock:write'] } as any;
const admin = { ...user, id: 'admin', roleCodes: ['ADMIN'] };
function fixture() {
  vi.stubEnv('WMS_TSD_PHYSICAL_STOCK_RECONCILIATION_ENABLED', 'true');
  const sku = { id: 'sku', clientId: 'client', needsChestnyZnak: true, isUnmarked: false, name: 'Костюм', barcodes: [{ value: barcode }] };
  const balance = { id: 'balance', clientId: 'client', warehouseId: 'wh', boxId: 'box', skuId: 'sku', status: 'AVAILABLE', quantity: 1, updatedAt: new Date(1), sku };
  const source = { id: 'box', code: 'FFL_SOURCE', clientId: 'client', warehouseId: 'wh', status: 'active', palletId: null, updatedAt: new Date(1), balances: [balance] };
  const marks: any[] = [{ id: 'old', clientId: 'client', skuId: 'sku', boxId: 'box', value: oldKiz, status: 'AVAILABLE', updatedAt: new Date(1), stockMovementId: 'receipt' }];
  const audits: any[] = [], reviews: any[] = [];
  const match = (row: any, where: any): boolean => {
    if (where.OR && !where.OR.some((part: any) => match(row, part))) return false;
    for (const key of ['clientId', 'skuId', 'boxId', 'status', 'id']) if (typeof where[key] === 'string' && row[key] !== where[key]) return false;
    if (where.value?.startsWith && !row.value.startsWith(where.value.startsWith)) return false;
    return true;
  };
  const db: any = {
    box: { findUnique: vi.fn(async () => source), updateMany: vi.fn(async () => ({ count: 1 })) },
    sku: { findFirst: vi.fn(async () => sku) },
    stockBalance: { findMany: vi.fn(async () => structuredClone([balance])),
      upsert: vi.fn(async ({ update }: any) => { balance.quantity += update.quantity.increment; return balance; }),
      update: vi.fn(async ({ data }: any) => { balance.quantity -= data.quantity.decrement; return balance; }), delete: vi.fn() },
    stockMovement: { create: vi.fn(async ({ data }: any) => ({ ...data, id: 'movement' })) },
    clientRequestBoxSelection: { findMany: vi.fn(async () => []) },
    clientRequest: { findMany: vi.fn(async () => []) },
    productMark: {
      findMany: vi.fn(async ({ where }: any) => structuredClone(marks.filter(row => match(row, where)))),
      updateMany: vi.fn(async ({ where, data }: any) => { const row = marks.find(row => match(row, where)); if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 }; }),
      create: vi.fn(async ({ data }: any) => { const row = { ...data, id: 'new', updatedAt: new Date(2) }; marks.push(row); return row; }),
    },
    auditLog: { findUnique: vi.fn(async ({ where }: any) => audits.find(row => row.id === where.id) ?? null), create: vi.fn(async ({ data }: any) => { audits.push(data); return data; }) },
    tsdOperation: { upsert: vi.fn(async ({ where, create }: any) => { let row = reviews.find(row => row.operationKey === where.operationKey); if (!row) { row = { ...create, id: 'review-1' }; reviews.push(row); } return row; }) },
  };
  for (const name of ['fbsTsdAssembly','shippedKizHistory','fbsWebKizStickerPrint','fbsPrintJob','fbsAssemblyAttemptHistory','kizCirculationItem']) db[name] = { findFirst: vi.fn(async () => null) };
  db.$transaction = vi.fn(async (fn: any) => {
    const before = structuredClone({ marks, audits, balance });
    try { return await fn(db); } catch (err) { marks.splice(0, marks.length, ...before.marks); audits.splice(0, audits.length, ...before.audits); Object.assign(balance, before.balance); throw err; }
  });
  const scopes = { requireClientAccess: vi.fn() }, lock = { assertStockMovementsAllowed: vi.fn() };
  const service = new StockOperationsService(db, scopes as any, { balanceKey: () => 'balance-key' } as any, undefined, undefined, lock as any);
  const payload: any = { fromBoxCode: source.code, barcode, kizCodes: [newKiz], allUnitsScanned: true, idempotencyKey: 'recount-1' };
  const preview = (actor = user) => (service as any).previewTsdKizRecount(payload, actor);
  const confirm = async (token?: string, actor = user) => (service as any).confirmTsdKizRecount({ ...payload, snapshot: token ?? (await preview(actor)).snapshot }, actor);
  return { db, source, balance, sku, marks, audits, reviews, scopes, lock, service, payload, preview, confirm };
}
afterEach(() => vi.unstubAllEnvs());
describe('TSD physical KIZ recount', () => {
  // TEST: an administrator confirms physical counts in both boxes, without duplicating stock.
  function crossBoxFixture() {
    const f = fixture();
    const oldBox = { ...f.source, id: 'old-box', code: 'FFL_OLD' };
    const oldBalance = { ...f.balance, id: 'old-balance', boxId: oldBox.id, quantity: 5 };
    f.marks[0].boxId = oldBox.id; f.marks[0].value = newKiz;
    f.marks.push({ ...f.marks[0], id: 'missing', value: kiz('missing') });
    f.db.box.findUnique.mockImplementation(async ({ where }: any) => where.id === oldBox.id ? oldBox : f.source);
    f.db.stockBalance.findMany.mockImplementation(async ({ where }: any) => structuredClone(where.boxId === oldBox.id ? [oldBalance] : [f.balance]));
    f.db.stockBalance.update.mockImplementation(async ({ where, data }: any) => {
      const row = where.id === oldBalance.id ? oldBalance : f.balance; row.quantity -= data.quantity.decrement; return row;
    });
    const transaction = f.db.$transaction.getMockImplementation();
    f.db.$transaction.mockImplementation(async (fn: any) => { const before = oldBalance.quantity;
      try { return await transaction(fn); } catch (error) { oldBalance.quantity = before; throw error; } });
    return { ...f, oldBox, oldBalance };
  }
  it('asks the admin for the old box physical count instead of a manager handoff', async () => {
    const f = crossBoxFixture();
    expect(await f.preview(admin)).toMatchObject({ state: 'ADMIN_BOX_COUNTS_REQUIRED',
      oldBoxes: [{ boxCode: 'FFL_OLD', previousQuantity: 5 }] });
    expect(f.db.stockMovement.create).not.toHaveBeenCalled(); expect(f.reviews).toHaveLength(0);
  });
  it('reconciles old 5 to physical 0 and current 1 to physical 1 exactly once', async () => {
    const f = crossBoxFixture(); f.payload.oldBoxCounts = [{ boxCode: 'FFL_OLD', quantity: 0 }];
    const p = await f.preview(admin); expect(p).toMatchObject({ state: 'RECOUNT_READY', adminConfirmationRequired: true });
    f.payload.adminConfirmed = true;
    await f.confirm(p.snapshot, admin); await f.confirm(p.snapshot, admin);
    expect(f.oldBalance.quantity).toBe(0); expect(f.balance.quantity).toBe(1);
    expect(f.marks.find(x => x.id === 'old')).toMatchObject({ boxId: 'box', status: 'AVAILABLE' });
    expect(f.marks.find(x => x.id === 'missing')).toMatchObject({ boxId: null, status: 'BLOCKED' });
    expect(f.db.productMark.create).not.toHaveBeenCalled();
    expect(f.db.stockMovement.create).toHaveBeenCalledTimes(1);
    expect(f.db.stockMovement.create.mock.calls[0][0].data).toMatchObject({ boxId: 'old-box', quantity: -5 });
    expect(f.audits[0].payload.oldBoxes[0]).toMatchObject({ boxCode: 'FFL_OLD', previousQuantity: 5, quantity: 0 });
  });
  it('requires an explicit administrator confirmation even when current quantity does not change', async () => {
    const f = crossBoxFixture(); f.payload.oldBoxCounts = [{ boxCode: 'FFL_OLD', quantity: 0 }];
    const p = await f.preview(admin); await expect(f.confirm(p.snapshot, admin)).rejects.toThrow('администратора');
    expect(f.oldBalance.quantity).toBe(5);
  });
  it('refuses a stale old-box balance without changing either box', async () => {
    const f = crossBoxFixture(); f.payload.oldBoxCounts = [{ boxCode: 'FFL_OLD', quantity: 0 }];
    const p = await f.preview(admin); f.oldBalance.quantity = 4; f.payload.adminConfirmed = true;
    await expect(f.confirm(p.snapshot, admin)).rejects.toThrow('Повторите сверку');
    expect(f.oldBalance.quantity).toBe(4); expect(f.balance.quantity).toBe(1);
  });
  it('rolls back both boxes and KIZ ownership on audit failure', async () => {
    const f = crossBoxFixture(); f.payload.oldBoxCounts = [{ boxCode: 'FFL_OLD', quantity: 0 }];
    const p = await f.preview(admin); f.payload.adminConfirmed = true;
    f.db.auditLog.create.mockRejectedValue(new Error('audit failed'));
    await expect(f.confirm(p.snapshot, admin)).rejects.toThrow('audit failed');
    expect(f.oldBalance.quantity).toBe(5); expect(f.marks[0].boxId).toBe('old-box');
  });
  it('does not grant cross-box correction to an employee', async () => {
    const f = crossBoxFixture(); f.payload.oldBoxCounts = [{ boxCode: 'FFL_OLD', quantity: 0 }];
    await expect(f.preview()).rejects.toThrow('администратора'); expect(f.oldBalance.quantity).toBe(5);
  });
  it('recognizes a foreign-box KIZ stored with a scanner prefix', async () => {
    const f = crossBoxFixture(); f.marks[0].value = ']d2' + newKiz;
    expect(await f.preview(admin)).toMatchObject({ state: 'ADMIN_BOX_COUNTS_REQUIRED' });
  });
  it.each([null, [], [{ boxCode: 'FFL_OLD', quantity: -1 }], [{ boxCode: 'FFL_OLD', quantity: 1.5 }], [{ boxCode: 'OTHER', quantity: 0 }]])('rejects invalid old-box counts %j', async counts => {
    const f = crossBoxFixture(); f.payload.oldBoxCounts = counts;
    await expect(f.preview(admin)).rejects.toThrow(); expect(f.oldBalance.quantity).toBe(5);
  });
  it('refuses another warehouse and preserves historical non-available marks', async () => {
    const f = crossBoxFixture(); f.oldBox.warehouseId = 'other';
    await expect(f.preview(admin)).rejects.toThrow('филиалу'); f.oldBox.warehouseId = 'wh';
    f.marks.push({ ...f.marks[0], id: 'historical', value: kiz('shipped'), status: 'SHIPPING' });
    f.payload.oldBoxCounts = [{ boxCode: 'FFL_OLD', quantity: 0 }]; f.payload.adminConfirmed = true;
    const p = await f.preview(admin); await f.confirm(p.snapshot, admin);
    expect(f.marks.find(m=>m.id==='historical')).toMatchObject({ status: 'SHIPPING', boxId: 'old-box' });
  });
  it('includes both-box correction in route rebuild and protects a stale mark', async () => {
    const f = crossBoxFixture(); f.payload.oldBoxCounts = [{ boxCode: 'FFL_OLD', quantity: 0 }];
    f.db.clientRequest.findMany.mockResolvedValue([{ id: 'affected' }]);
    const p = await f.preview(admin); f.payload.adminConfirmed = true;
    f.marks[0].updatedAt = new Date(7);
    await expect(f.confirm(p.snapshot, admin)).rejects.toThrow('Повторите сверку');
    const fresh = await f.preview(admin); expect(await f.confirm(fresh.snapshot, admin)).toMatchObject({ affectedRequestIds: ['affected'] });
  });
  // TEST: correction records affected open FBS requests for route refresh, including on retry.
  it('persists affected routes with the count and returns them on idempotent replay', async () => {
    const f = fixture(); f.balance.quantity = 0; f.payload.adminConfirmed = true;
    f.db.clientRequest.findMany.mockResolvedValue([{ id: 'r1' }]);
    const p = await f.preview(admin);
    expect(await f.confirm(p.snapshot, admin)).toMatchObject({ affectedRequestIds: ['r1'] });
    expect(await f.confirm(p.snapshot, admin)).toMatchObject({ affectedRequestIds: ['r1'] });
  });
  it('allows an admin-confirmed physical count to restore an archived but not deleted source', async () => {
    const f = fixture(); f.source.status = 'archived'; f.balance.quantity = 0; f.payload.adminConfirmed = true;
    const p = await f.preview(admin); expect(p.state).toBe('RECOUNT_READY');
    await f.confirm(p.snapshot, admin);
    expect(f.db.box.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'box', status: 'archived' }), data: { status: 'active' } }));
  });
  // TEST: the administrator stays on the TSD instead of receiving a manager queue handoff.
  it('returns an on-device admin decision for a protected KIZ without creating a manager ticket', async () => {
    const f = fixture(); f.db.fbsTsdAssembly.findFirst.mockResolvedValue({ id: 'task' });
    await expect(f.preview(admin)).resolves.toMatchObject({ state: 'ADMIN_REVIEW_REQUIRED' });
    expect(f.reviews).toHaveLength(0);
  });
  // TEST: the administrator decides on the TSD, with explicit quantity delta and server-side rights.
  it.each([0, 3])('administrator corrects quantity %s to physical 1 only after explicit confirmation', async quantity => {
    const f = fixture(); f.balance.quantity = quantity;
    const p = await f.preview(admin);
    expect(p).toMatchObject({ state: 'RECOUNT_READY', previousQuantity: quantity, quantity: 1, delta: 1 - quantity, adminConfirmationRequired: true });
    expect(f.reviews).toHaveLength(0); await expect(f.confirm(p.snapshot, admin)).rejects.toThrow('администратора');
    f.payload.adminConfirmed = true; await f.confirm(p.snapshot, admin); await f.confirm(p.snapshot, admin);
    expect(f.balance.quantity).toBe(1); expect(f.db.stockMovement.create).toHaveBeenCalledTimes(1);
    expect(f.db.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'INVENTORY_ADJUSTMENT', quantity: 1 - quantity }) }));
    expect(f.audits[0]).toMatchObject({ userId: 'admin', payload: { adminConfirmed: true, previousQuantity: quantity, quantity: 1 } });
  });
  it('an employee cannot forge an administrative confirmation', async () => {
    const f = fixture(); f.payload.adminConfirmed = true;
    await expect(f.preview()).rejects.toThrow('администратора'); expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
  });
  it('applies inside the releasing transaction, ignores only its own print history, and still protects shipment history', async () => {
    const f = fixture(); f.payload.adminConfirmed = true; f.payload.snapshot = 'a'.repeat(64);
    await f.service.applyAdminKizRecount(f.db, f.payload, admin, ['released-task']);
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.db.fbsWebKizStickerPrint.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ assemblyId: { notIn: ['released-task'] } }) }));
    const blocked = fixture(); blocked.payload.adminConfirmed = true; blocked.payload.snapshot = 'a'.repeat(64);
    blocked.db.shippedKizHistory.findFirst.mockResolvedValue({ id: 'shipped' });
    await expect(blocked.service.applyAdminKizRecount(blocked.db, blocked.payload, admin, ['released-task'])).rejects.toThrow('отгрузкой');
    expect(blocked.db.productMark.updateMany).not.toHaveBeenCalled();
  });
  it('rolls back the administrator quantity correction together with KIZs on audit failure', async () => {
    const f = fixture(); f.balance.quantity = 3; f.payload.adminConfirmed = true;
    f.db.auditLog.create.mockRejectedValue(new Error('audit failed')); await expect(f.confirm(undefined, admin)).rejects.toThrow('audit failed');
    expect(f.balance.quantity).toBe(3); expect(f.marks[0].boxId).toBe('box');
  });
  it('previews without writes; replaces one stale identity without changing quantity', async () => {
    const f = fixture(); const plan = await f.preview();
    expect(plan).toMatchObject({ state: 'RECOUNT_READY', retiredCount: 1, registeredCount: 1, quantity: 1 });
    expect(f.db.productMark.create).not.toHaveBeenCalled();
    await expect(f.confirm(plan.snapshot)).resolves.toMatchObject({ state: 'RECOUNT_APPLIED' });
    expect(f.marks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'old', boxId: null, status: 'BLOCKED', stockMovementId: 'receipt' }), expect.objectContaining({ value: newKiz, boxId: 'box', status: 'AVAILABLE' })]));
    expect(f.balance.quantity).toBe(1); expect(f.db.stockMovement.create).not.toHaveBeenCalled();
    expect(f.audits[0].payload.previousMarks[0]).toMatchObject({ value: oldKiz, boxId: 'box', status: 'AVAILABLE' });
    expect(f.db.$transaction).toHaveBeenLastCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: 'Serializable' }));
  });
  it('retries the same confirmation without retiring or creating twice', async () => {
    const f = fixture(); const p = await f.preview(); await f.confirm(p.snapshot); await f.confirm(p.snapshot);
    expect(f.db.productMark.create).toHaveBeenCalledTimes(1); expect(f.audits).toHaveLength(1);
    f.payload.kizCodes = [kiz('changed')]; await expect(f.confirm(p.snapshot)).rejects.toThrow();
  });
  it('rolls back retirement when registration fails', async () => {
    const f = fixture(); f.db.productMark.create.mockRejectedValue(new Error('write failed'));
    await expect(f.confirm()).rejects.toThrow('write failed'); expect(f.marks[0].boxId).toBe('box'); expect(f.audits).toHaveLength(0);
  });
  it('rejects a stale snapshot after another worker changes stock', async () => {
    const f = fixture(); const p = await f.preview(); f.balance.updatedAt = new Date(5);
    await expect(f.confirm(p.snapshot)).rejects.toThrow('изменил'); expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
  });
  it('keeps a scanned known mark and registers only the missing identity', async () => {
    const f = fixture(); f.balance.quantity = 2; f.payload.kizCodes.push(oldKiz);
    await f.confirm(); expect(f.marks[0].boxId).toBe('box'); expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
  });
  it('rejects duplicate scanner representations of the same identity', async () => {
    const f = fixture(); f.payload.kizCodes.push(newKiz.replace(/\u001d/g, '<GS>'));
    await expect(f.preview()).rejects.toThrow('повтор'); expect(f.reviews).toHaveLength(0);
  });
  it.each(['allUnitsScanned', 'barcode'])('requires explicit complete count and barcode: %s', async field => {
    const f = fixture(); delete f.payload[field]; await expect(f.preview()).rejects.toThrow();
  });
  it('requires a valid physical KIZ and a nonempty count', async () => {
    const f = fixture(); f.payload.kizCodes = ['123']; await expect(f.preview()).rejects.toThrow();
    f.payload.kizCodes = []; await expect(f.preview()).rejects.toThrow();
  });
  it('requires a preview token before confirmation', async () => {
    const f = fixture(); await expect((f.service as any).confirmTsdKizRecount(f.payload, user)).rejects.toThrow();
  });
  it('queues a quantity mismatch once, without changing stock', async () => {
    const f = fixture(); f.balance.quantity = 2;
    await expect(f.preview()).resolves.toMatchObject({ state: 'NEEDS_REVIEW', reviewId: 'review-1' }); await f.preview();
    expect(f.reviews).toHaveLength(1); expect(f.reviews[0]).toMatchObject({ status: 'NEEDS_REVIEW', operationType: 'tsd_stock_recount' });
    expect(f.db.productMark.updateMany).not.toHaveBeenCalled(); expect(f.balance.quantity).toBe(2);
  });
  // TEST: a new physical count must not disappear into an already rejected manager item.
  it('opens a new review after a manager closed the previous counting attempt', async () => {
    const f = fixture(); f.balance.quantity = 2; await f.preview();
    f.reviews[0].status = 'REJECTED'; f.reviews[0].resolutionMessage = 'Назначена проверка';
    const retry = await f.preview(); expect(retry.message).toContain('уже рассмотрена');
    f.payload.idempotencyKey = 'new-count'; await f.preview();
    expect(f.reviews).toHaveLength(2); expect(f.reviews[1].status).toBe('NEEDS_REVIEW');
  });
  it.each(['fbsTsdAssembly','shippedKizHistory','fbsWebKizStickerPrint','fbsPrintJob','fbsAssemblyAttemptHistory','kizCirculationItem'])('queues protected ownership/history: %s', async delegate => {
    const f = fixture(); f.db[delegate].findFirst.mockResolvedValue({ id: 'protected' });
    await expect(f.preview()).resolves.toMatchObject({ state: 'NEEDS_REVIEW' }); expect(f.db.productMark.create).not.toHaveBeenCalled();
  });
  it.each(['clientId', 'skuId', 'boxId', 'status'])('does not steal a physical mark with different %s', async field => {
    const f = fixture(); f.marks.push({ ...f.marks[0], id: 'scanned', value: newKiz, [field]: 'OTHER' });
    await expect(f.preview()).resolves.toMatchObject({ state: 'NEEDS_REVIEW' });
  });
  it('does not ignore nonavailable stock', async () => {
    const f = fixture(); f.balance.status = 'PACKING'; await expect(f.preview()).resolves.toMatchObject({ state: 'NEEDS_REVIEW' });
  });
  it('does not conceal history database outages as safe counts', async () => {
    const f = fixture(); f.db.shippedKizHistory.findFirst.mockRejectedValue(new Error('offline'));
    await expect(f.preview()).rejects.toThrow('offline'); expect(f.db.productMark.create).not.toHaveBeenCalled();
  });
  it('honours flag, client and warehouse restrictions', async () => {
    const f = fixture(); vi.stubEnv('WMS_TSD_PHYSICAL_STOCK_RECONCILIATION_ENABLED', 'false'); await expect(f.preview()).rejects.toThrow();
    vi.stubEnv('WMS_TSD_PHYSICAL_STOCK_RECONCILIATION_ENABLED', 'true');
    await expect((f.service as any).previewTsdKizRecount(f.payload, { ...user, roleCodes: ['CLIENT'] })).rejects.toThrow();
    f.scopes.requireClientAccess.mockImplementation(() => { throw new Error('no client access'); }); await expect(f.preview()).rejects.toThrow('no client access');
  });
  // TEST: the real manager review accepts the new payload, but cannot bypass its KIZ protection.
  it('can reject a review in the existing queue without applying a numeric inventory adjustment', async () => {
    const f = fixture(); f.balance.quantity = 2; await f.preview();
    f.db.tsdOperation.findUnique = vi.fn(async () => f.reviews[0]);
    f.db.tsdOperation.update = vi.fn(async ({ data }: any) => ({ ...f.reviews[0], ...data }));
    const stock = { adjustInventoryToCounted: vi.fn() };
    const manager = new TsdReviewService(f.db, f.scopes as any, stock as any, new TsdPayloadParser());
    await expect(manager.resolveReviewOperation('review-1', { action: 'APPLY_INVENTORY_ADJUSTMENT' }, user)).rejects.toThrow('inventory_scan');
    await expect(manager.resolveReviewOperation('review-1', { action: 'REJECT', comment: 'Назначена проверка товара' }, user)).resolves.toMatchObject({ operation: { status: 'REJECTED' } });
    expect(f.scopes.requireClientAccess).toHaveBeenLastCalledWith(user, 'client', 'write');
    expect(stock.adjustInventoryToCounted).not.toHaveBeenCalled();
  });
  it('checks the branch, inventory lock and marked SKU', async () => {
    const f = fixture(); f.source.warehouseId = 'other'; await expect(f.preview()).rejects.toThrow('филиалу');
    f.source.warehouseId = 'wh'; f.sku.isUnmarked = true; await expect(f.preview()).rejects.toThrow('маркированному');
    f.sku.isUnmarked = false; f.lock.assertStockMovementsAllowed.mockRejectedValue(new Error('inventory locked'));
    await expect(f.confirm()).rejects.toThrow('inventory locked'); expect(f.db.productMark.create).not.toHaveBeenCalled();
  });
  it('preserves all marks if compare-and-set fails or the audit cannot be written', async () => {
    const f = fixture(); f.db.productMark.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(f.confirm()).rejects.toThrow('Привязка'); expect(f.db.productMark.create).not.toHaveBeenCalled();
    f.db.auditLog.create.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(f.confirm()).rejects.toThrow('audit unavailable'); expect(f.marks).toHaveLength(1); expect(f.marks[0].boxId).toBe('box');
  });
});
