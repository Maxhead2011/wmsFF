import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { storageBoxTransferKizIdentity } from '../src/modules/stock/stock-operations.service';

const kiz = '0104640569959669215abcdefghijkl\u001d91EE12\u001d92test';
const admin: any = { id: 'admin', roleCodes: ['ADMIN'], permissionCodes: ['stock:write'], deviceCode: 'TSD', activeWarehouseId: 'wh' };
function fixture() {
  vi.stubEnv('WMS_TSD_PHYSICAL_STOCK_RECONCILIATION_ENABLED', 'true');
  let task: any = { id: 'task', requestId: 'request', requestItemId: 'item', clientId: 'client', skuId: 'sku', marketplace: 'WILDBERRIES',
    status: 'IN_PROGRESS', itemCount: 1, kiz, boxId: 'box', reservedBoxId: 'box', connectionId: 'connection', orderId: '123', updatedAt: new Date(1) };
  let audit: any = null;
  const source = { id: 'box', code: 'FFL_BOX', clientId: 'client', warehouseId: 'wh', palletId: null, status: 'active' };
  const marks: any[] = [{ id: 'mark', value: kiz, skuId: 'sku', clientId: 'client', boxId: 'box', status: 'AVAILABLE', updatedAt: new Date(1) }];
  const balance = { id: 'balance', boxId: 'box', skuId: 'sku', status: 'AVAILABLE', quantity: 1 };
  const db: any = {
    fbsTsdAssembly: { findMany: vi.fn(async () => structuredClone([task])), findUnique: vi.fn(async () => structuredClone(task)),
      updateMany: vi.fn(async ({ data }: any) => { Object.assign(task, data); return { count: 1 }; }), update: vi.fn(async ({ data }: any) => { Object.assign(task, data); return task; }) },
    productMark: { findMany: vi.fn(async () => structuredClone(marks)), findFirst: vi.fn(async () => structuredClone(marks[0])) },
    stockBalance: { findMany: vi.fn(async () => [balance]) }, stockMovement: { findMany: vi.fn(async () => []) },
    clientRequest: { findUnique: vi.fn(async () => ({ id: 'request', clientId: 'client', warehouseId: 'wh', status: 'IN_PROGRESS' })) },
    fbsOrderRequestLink: { findUnique: vi.fn(async () => ({ requestId: 'request', syncStatus: 'ACTIVE', lastCategory: 'active', lastSupplierStatus: 'confirm' })) },
    auditLog: { findUnique: vi.fn(async () => structuredClone(audit)), create: vi.fn(async ({ data }: any) => { audit = structuredClone(data); return audit; }),
      update: vi.fn(async ({ data }: any) => { Object.assign(audit, structuredClone(data)); return audit; }) },
    clientRequestBoxSelection: { findUnique: vi.fn(async () => ({ id: 'selection', skuId: 'sku', quantity: 3 })), update: vi.fn(), delete: vi.fn() },
    fbsPrintJob: { findFirst: vi.fn(async () => null), updateMany: vi.fn() }, clientRequestEvent: { create: vi.fn() },
    clientMarketplaceConnection: { findFirst: vi.fn(async () => ({ apiKey: 'test-only-key' })) },
  };
  for (const name of ['shippedKizHistory', 'fbsAssemblyAttemptHistory', 'kizCirculationItem', 'fbsWebKizStickerPrint']) db[name] = { findFirst: vi.fn(async () => null) };
  db.$transaction = vi.fn(async (fn: any) => {
    const before = structuredClone({ task, audit });
    try { return await fn(db); } catch (e) { task = before.task; audit = before.audit; throw e; }
  });
  const service: any = Object.create(MarketplaceConnectionsService.prototype);
  Object.assign(service, { prisma: db, inventoryLock: { assertStockMovementsAllowed: vi.fn() }, fbsOrdersCache: new Map(), fbsTsdRequestFallbackCache: new Map(),
    repairFbsRequestSelection: vi.fn(async () => ({ repaired: true })),
    loadWildberriesFbsKizPreflight: vi.fn(async () => ({ supplierStatus: 'confirm', wbStatus: 'waiting', remoteKizValues: [], alreadyAttached: false })) });
  const identity = storageBoxTransferKizIdentity(kiz)!;
  const load = vi.fn(async () => ({ source, skuId: 'sku', scans: [{ raw: kiz, key: `01${identity.gtin}21${identity.serial}`, ...identity }] }));
  const apply = vi.fn(async () => ({ state: 'RECOUNT_APPLIED' }));
  const payload: any = { idempotencyKey: 'count', adminConfirmed: true };
  const preview = () => service.adminTsdKizRecount(payload, admin, false, load, apply);
  const confirm = () => service.adminTsdKizRecount(payload, admin, true, load, apply);
  return { service, db, marks, source, load, apply, payload, preview, confirm, task: () => task, audit: () => audit };
}
afterEach(() => vi.unstubAllEnvs());
describe('Marketplace admin physical recount integration', () => {
  // TEST: request/order identity and unrelated selection quantities survive release.
  it('releases only the scanned order and refreshes its request after the count', async () => {
    const f = fixture(); const p = await f.preview(); f.payload.snapshot = p.snapshot;
    expect(p).toMatchObject({ state: 'RECOUNT_READY', adminRelease: true }); expect(f.audit()).toBeNull();
    await f.confirm(); await f.confirm();
    expect(f.task()).toMatchObject({ id: 'task', requestId: 'request', status: 'WAITING_STOCK', kiz: null });
    expect(f.apply).toHaveBeenCalledTimes(1); expect(f.apply.mock.calls[0][1]).toEqual(['task']);
    expect(f.db.clientRequestBoxSelection.update).toHaveBeenCalledWith({ where: { id: 'selection' }, data: { quantity: { decrement: 1 } } });
    expect(f.service.repairFbsRequestSelection).toHaveBeenCalledWith('request', admin);
    expect(f.audit().payload.context.tasks[0].kiz).toBe(kiz);
  });
  it('blocks actual WB shipment and preserves local stock', async () => {
    const f = fixture(); f.payload.snapshot = (await f.preview()).snapshot;
    f.service.loadWildberriesFbsKizPreflight.mockResolvedValue({ supplierStatus: 'complete', wbStatus: 'sold', remoteKizValues: [], alreadyAttached: false });
    await expect(f.confirm()).rejects.toThrow('complete/sold'); expect(f.apply).not.toHaveBeenCalled();
  });
  it('keeps stock unchanged and allows same-device retry after a WB read failure', async () => {
    const f = fixture(); f.payload.snapshot = (await f.preview()).snapshot;
    f.service.loadWildberriesFbsKizPreflight.mockRejectedValueOnce(new Error('WB offline'));
    await expect(f.confirm()).rejects.toThrow('WB offline'); expect(f.apply).not.toHaveBeenCalled();
    await f.confirm(); expect(f.apply).toHaveBeenCalledTimes(1);
  });
  it('retries route refresh without resetting or counting twice', async () => {
    const f = fixture(); f.payload.snapshot = (await f.preview()).snapshot;
    f.service.repairFbsRequestSelection.mockRejectedValueOnce(new Error('route offline'));
    await expect(f.confirm()).rejects.toThrow('route offline'); await f.confirm();
    expect(f.apply).toHaveBeenCalledTimes(1); expect(f.service.repairFbsRequestSelection).toHaveBeenCalledTimes(2);
  });
  it('rolls back the task reset when physical recount fails', async () => {
    const f = fixture(); f.payload.snapshot = (await f.preview()).snapshot; f.apply.mockRejectedValue(new Error('count conflict'));
    await expect(f.confirm()).rejects.toThrow('count conflict'); expect(f.task().kiz).toBe(kiz);
    expect(f.task().status).toBe('ADMIN_RECOUNT_PENDING'); expect(f.audit().payload.phase).toBe('PREPARED');
  });
  it.each(['shippedKizHistory', 'fbsAssemblyAttemptHistory', 'kizCirculationItem'])('does not offer release for history %s', async delegate => {
    const f = fixture(); f.db[delegate].findFirst.mockResolvedValue({ id: 'protected' });
    await expect(f.preview()).rejects.toThrow('история'); expect(f.audit()).toBeNull();
  });
  it('never releases another KIZ placed into the WB order', async () => {
    const f = fixture(); f.payload.snapshot = (await f.preview()).snapshot;
    f.service.loadWildberriesFbsKizPreflight.mockResolvedValue({ supplierStatus: 'confirm', wbStatus: 'waiting', remoteKizValues: ['other'], alreadyAttached: false });
    await expect(f.confirm()).rejects.toThrow('другой КИЗ'); expect(f.apply).not.toHaveBeenCalled();
  });
  // TEST: the early PACKING deduction is returned using the established ledger, not a second blind increment.
  it('uses the existing reservation return with an explicit physical destination', async () => {
    const f = fixture(); f.marks[0].status = 'PACKING'; f.marks[0].boxId = null;
    f.db.stockMovement.findMany.mockResolvedValue([{ quantity: 1, status: 'PACKING' }]);
    f.service.returnCompletedWildberriesStockReservation = vi.fn(async () => {});
    f.payload.snapshot = (await f.preview()).snapshot; await f.confirm();
    expect(f.service.returnCompletedWildberriesStockReservation).toHaveBeenCalledWith(f.db, expect.objectContaining({ id: 'task' }),
      expect.objectContaining({ boxId: 'box', warehouseId: 'wh', mark: expect.objectContaining({ id: 'mark' }) }));
  });
  it('refuses an inconsistent picking ledger instead of adding stock twice', async () => {
    const f = fixture(); f.db.stockMovement.findMany.mockResolvedValue([{ quantity: 2 }]);
    f.payload.snapshot = (await f.preview()).snapshot; await expect(f.confirm()).rejects.toThrow('учётом');
    expect(f.apply).not.toHaveBeenCalled();
  });
  it.each([{ clientId: 'other' }, { skuId: 'other' }, { boxId: 'other' }, { status: 'SHIPPING' }])('protects mark ownership %j', changes => {
    const f = fixture(); Object.assign(f.marks[0], changes);
    return expect(f.preview()).rejects.toThrow();
  });
  it('refuses duplicate identities', async () => {
    const f = fixture(); f.marks.push({ ...f.marks[0], id: 'duplicate' });
    await expect(f.preview()).rejects.toThrow('КИЗ');
  });
  // TEST: a physical count must never recreate stock moved while the WB request was in flight.
  it('refuses a changed box composition after preparation rather than replaying the old count', async () => {
    const f = fixture(); f.payload.snapshot = (await f.preview()).snapshot;
    f.service.loadWildberriesFbsKizPreflight.mockImplementation(async () => {
      f.marks[0].updatedAt = new Date(99);
      return { supplierStatus: 'confirm', wbStatus: 'waiting', remoteKizValues: [], alreadyAttached: false };
    });
    await expect(f.confirm()).rejects.toThrow('состав'); expect(f.apply).not.toHaveBeenCalled();
  });
});
