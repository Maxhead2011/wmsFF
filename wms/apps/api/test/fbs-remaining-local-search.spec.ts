import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

const admin = { id: 'admin-1', name: 'Администратор', roleCodes: ['ADMIN'], permissionCodes: [], deviceCode: 'TSD-1' } as any;

// TEST: 12 completed orders remain intact; only the thirteenth needs physical collection.
function fixture(enabled = false) {
  const request: any = { id: 'request-592', number: 592, clientId: 'client-1', type: 'OUTBOUND',
    status: 'SUBMITTED', title: 'FBS — 13 заказов', updatedAt: new Date('2026-09-03'),
    fbsEmergencyAssemblyAt: enabled ? new Date('2026-09-04') : null,
    client: { id: 'client-1', code: 'CL-1', name: 'Клиент' } };
  const tasks = Array.from({ length: 13 }, (_, n) => ({ id: `task-${n}`, requestId: request.id,
    marketplace: 'WILDBERRIES', connectionId: 'wb-1', orderId: `order-${n}`, skuId: `sku-${n}`,
    status: n === 12 ? 'RESERVED' : 'COMPLETED', completedAt: n === 12 ? null : new Date('2026-09-03T15:00:00Z'),
    boxId: n === 12 ? null : 'collected-box', barcode: n === 12 ? null : 'barcode',
    kiz: n === 12 ? null : `saved-kiz-${n}`, sourceBarcode: null, relabelConfirmedAt: null,
    reservedBoxCode: 'FFL_LKB2507_126', workerName: n === 12 ? null : 'Сборщик' }));
  request.fbsOrderLinks = tasks.map(task => ({ requestId: request.id, marketplace: 'WILDBERRIES',
    connectionId: task.connectionId, orderId: task.orderId, lastSkuId: task.skuId,
    syncStatus: 'ACTIVE', lastCategory: 'shipped', lastSupplierStatus: 'complete', lastSupplyId: 'WB-GI-1' }));
  const events: any[] = [];
  const audits: any[] = [];
  const db: any = {
    clientRequest: { findUnique: vi.fn(async () => request), updateMany: vi.fn(async ({ where, data }) => {
      if (request.fbsEmergencyAssemblyAt || where.updatedAt !== request.updatedAt) return { count: 0 };
      Object.assign(request, data); return { count: 1 };
    }) },
    fbsOrderRequestLink: { findMany: vi.fn(async () => request.fbsOrderLinks.map(link => ({ ...link, request }))) },
    fbsTsdAssembly: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => tasks), updateMany: vi.fn() },
    stockBalance: { findMany: vi.fn(async () => [{ skuId: 'sku-12', clientId: request.clientId, boxId: 'box-126' }]), update: vi.fn() },
    stockMovement: { create: vi.fn() }, productMark: { update: vi.fn() },
    client: { findMany: vi.fn(async () => []) }, sku: { findMany: vi.fn(async () => []) },
    clientRequestEvent: { create: vi.fn(async ({ data }) => { events.push(data); return { id: 'event' }; }) },
    auditLog: { create: vi.fn(async ({ data }) => { audits.push(data); return { id: 'audit' }; }) },
    $transaction: vi.fn(async fn => {
      const before = { ...request }; const ec = events.length, ac = audits.length;
      try { return await fn(db); } catch (e) { Object.assign(request, before); events.length = ec; audits.length = ac; throw e; }
    }),
  };
  const scopes = { requireClientAccess: vi.fn(), resolveClientFilter: vi.fn(() => request.clientId) };
  const service = new MarketplaceConnectionsService(db, scopes as never) as any;
  return { service, request, tasks, db, scopes, audits, events };
}

afterEach(() => vi.unstubAllGlobals());

describe('FBS remaining-only local search', () => {
  it('enables local search with no task reset, stock writes, KIZ writes or WB requests', async () => {
    const f = fixture(); const before = structuredClone(f.tasks); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(f.service.enableFbsRemainingSearch(f.request.id, admin)).resolves.toMatchObject({
      status: 'APPLIED', completedOrders: 12, remainingOrders: 1,
    });
    expect(f.request.fbsEmergencyAssemblyAt).toBeInstanceOf(Date);
    expect(f.tasks).toEqual(before);
    expect(f.db.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
    expect(f.db.stockBalance.update).not.toHaveBeenCalled();
    expect(f.db.stockMovement.create).not.toHaveBeenCalled();
    expect(f.db.productMark.update).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(f.audits[0]).toMatchObject({ userId: admin.id, action: 'FBS_REMAINING_SEARCH_ENABLED',
      payload: { completedOrders: 12, remainingOrders: 1, wbMutationPerformed: false, resetAssemblies: 0 } });
  });

  it('shows one remaining order and 12/13 progress despite completion preceding local activation', async () => {
    const f = fixture(true);
    const result = await f.service.listFbsTsdRequests('TSD-1', admin);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]).toMatchObject({ requestNumber: 592, totalOrders: 1,
      readyOrders: 1, completedOrders: 12, awaitingWbConfirmation: 0 });
    expect(result.requests[0].title).toContain('12/13');
  });

  it('does not archive a partly collected local request', async () => {
    const f = fixture(true);
    expect((await f.service.listFbsTsdRequests('TSD-1', admin, true)).requests).toEqual([]);
  });

  it('archives all 13 when the last item really is collected, retaining earlier completion times', async () => {
    const f = fixture(true); f.tasks[12].status = 'COMPLETED'; f.tasks[12].completedAt = new Date();
    expect((await f.service.listFbsTsdRequests('TSD-1', admin)).requests).toEqual([]);
    expect((await f.service.listFbsTsdRequests('TSD-1', admin, true)).requests[0])
      .toMatchObject({ totalOrders: 13, completedOrders: 13 });
  });

  it('does not expose shipped orders without explicit local activation', async () => {
    const f = fixture();
    expect((await f.service.listFbsTsdRequests('TSD-1', admin)).requests).toEqual([]);
  });

  // TEST: run the actual queue allocator against completed and remaining tasks together.
  it('assigns only the thirteenth order without recreating any completed task or calling WB', async () => {
    const f = fixture(true); const completedBefore = structuredClone(f.tasks.slice(0, 12));
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const boxes = [{ code: 'FFL_LKB2507_126', quantity: 1, status: 'AVAILABLE' }];
    const response = { orders: f.request.fbsOrderLinks.map((link: any) => ({
      id: link.orderId, connectionId: link.connectionId, marketplace: 'WILDBERRIES',
      category: 'active', supplierStatus: 'confirm', request: f.request,
      product: { id: link.lastSkuId, name: 'Костюм', needsChestnyZnak: true },
      storageBoxes: boxes, barcodes: ['barcode'], itemCount: 1,
      requiredMeta: [], optionalMeta: [], createdAt: '2026-09-03', supplyId: 'WB-GI-1',
    })) };
    f.db.clientMarketplaceConnection = { findMany: vi.fn(async () => [{ clientId: 'client-1' }]) };
    f.db.clientRequestItem = { findFirst: vi.fn(async () => ({ id: 'item-12' })) };
    f.db.fbsTsdAssembly.findUnique = vi.fn(async ({ where }: any) => f.tasks.find(task =>
      where.id ? task.id === where.id : task.orderId === where.marketplace_connectionId_orderId.orderId));
    f.db.fbsTsdAssembly.create = vi.fn();
    f.db.fbsTsdAssembly.updateMany.mockImplementation(async ({ where, data }: any) => {
      const task = f.tasks.find(task => task.id === where.id && task.status === where.status);
      if (!task) return { count: 0 }; Object.assign(task, data); return { count: 1 };
    });
    vi.spyOn(f.service, 'loadFbsTsdRequestOrders').mockResolvedValue(response);
    vi.spyOn(f.service, 'mergeSyncedFbsTsdRequestOrders').mockResolvedValue(response);
    vi.spyOn(f.service, 'resolveFbsTsdStockSource').mockResolvedValue({ storageBoxes: boxes, withoutBoxQuantity: 0, relabelRequired: false });
    vi.spyOn(f.service, 'formatFbsTsdAssembly').mockImplementation(async task => ({ task }));
    expect(await f.service.getNextFbsTsdAssembly('TSD-1', admin, f.request.id))
      .toMatchObject({ task: { orderId: 'order-12', status: 'IN_PROGRESS' } });
    expect(f.db.fbsTsdAssembly.updateMany).toHaveBeenCalledTimes(1);
    expect(f.db.fbsTsdAssembly.create).not.toHaveBeenCalled();
    expect(f.tasks.slice(0, 12)).toEqual(completedBefore);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cannot finish the missing item before source, barcode and KIZ are scanned', async () => {
    const f = fixture(true);
    vi.spyOn(f.service, 'loadOwnedFbsTsdAssembly').mockResolvedValue({ ...f.tasks[12], requiresKiz: true });
    await expect(f.service.completeFbsTsdAssembly('task-12', admin)).rejects.toThrow(/источник и товар/);
    expect(f.db.stockMovement.create).not.toHaveBeenCalled();
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });

  it('is idempotent and does not reset tasks on repeated activation', async () => {
    const f = fixture();
    await f.service.enableFbsRemainingSearch(f.request.id, admin);
    expect((await f.service.enableFbsRemainingSearch(f.request.id, admin)).status).toBe('ALREADY_APPLIED');
    expect(f.events).toHaveLength(1); expect(f.audits).toHaveLength(1);
  });

  it.each(['DONE', 'CANCELLED', 'REJECTED'])('rejects a %s request', async status => {
    const f = fixture(); f.request.status = status;
    await expect(f.service.enableFbsRemainingSearch(f.request.id, admin)).rejects.toThrow();
    expect(f.db.clientRequest.updateMany).not.toHaveBeenCalled();
  });

  it.each(['active', 'cancelled', 'OZON', 'RETURN_REQUIRED', 'physical scan', 'all completed'])(
    'does not enable unsafe remaining search: %s', async fault => {
      const f = fixture();
      if (fault === 'active') { f.request.fbsOrderLinks[12].lastCategory = 'active'; f.request.fbsOrderLinks[12].lastSupplierStatus = 'confirm'; }
      if (fault === 'cancelled') f.request.fbsOrderLinks[12].lastCategory = 'cancelled';
      if (fault === 'OZON') f.request.fbsOrderLinks[12].marketplace = 'OZON';
      if (fault === 'RETURN_REQUIRED') f.tasks[12].status = 'RETURN_REQUIRED';
      if (fault === 'physical scan') f.tasks[12].barcode = 'already-scanned';
      if (fault === 'all completed') f.tasks[12].status = 'COMPLETED';
      await expect(f.service.enableFbsRemainingSearch(f.request.id, admin)).rejects.toThrow();
      expect(f.db.clientRequest.updateMany).not.toHaveBeenCalled();
    });

  it('requires admin and client access', async () => {
    const f = fixture();
    await expect(f.service.enableFbsRemainingSearch(f.request.id, { ...admin, roleCodes: ['CLIENT'] })).rejects.toThrow();
    expect(f.db.clientRequest.findUnique).not.toHaveBeenCalled();
    f.scopes.requireClientAccess.mockImplementation(() => { throw Error('forbidden client'); });
    await expect(f.service.enableFbsRemainingSearch(f.request.id, admin)).rejects.toThrow('forbidden client');
    expect(f.db.clientRequest.updateMany).not.toHaveBeenCalled();
  });

  it.each(['race', 'audit'])('rolls back activation on %s failure', async failure => {
    const f = fixture();
    if (failure === 'race') f.db.clientRequest.updateMany.mockResolvedValue({ count: 0 });
    else f.db.auditLog.create.mockRejectedValue(Error('audit failed'));
    await expect(f.service.enableFbsRemainingSearch(f.request.id, admin)).rejects.toThrow();
    expect(f.request.fbsEmergencyAssemblyAt).toBeNull();
    expect(f.events).toEqual([]);
  });
});
