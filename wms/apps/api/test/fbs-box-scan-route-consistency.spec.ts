import { describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

// TEST: real scan/format entry points; a route is a hint, physical reservations stay protected.
function fixture(releasableBackground = false, available = 1) {
  const task: any = { id: 'current', requestId: 'request-585', clientId: 'client', skuId: 'sku',
    connectionId: 'wb', marketplace: 'WILDBERRIES', orderId: 'order', itemCount: 1,
    status: 'IN_PROGRESS', deviceCode: 'TSD-1', workerUserId: 'user', productName: 'Костюм',
    boxId: null, boxCode: null, reservedBoxId: null, reservedBoxCode: null,
    barcode: null, kiz: null, sourceBarcode: null, relabelConfirmedAt: null,
    relabelRequired: false, requiresKiz: true, errorMessage: null };
  const box = { id: 'box', code: 'FFL_G_LKB0707_021', warehouseId: 'warehouse', storagePlacement: null };
  const reservations = [{ taskId: 'other', boxId: 'box', itemCount: 1, releasableBackground }];
  const db: any = {
    storagePallet: { findFirst: vi.fn(async () => null) }, box: { findFirst: vi.fn(async () => box) },
    stockBalance: { aggregate: vi.fn(async () => ({ _sum: { quantity: available } })),
      findMany: vi.fn(async () => available ? [{ boxId: box.id, box, quantity: available }] : []) },
    client: { findUnique: vi.fn(async () => ({ id: 'client' })) }, sku: { findUnique: vi.fn(async () => ({})) },
    clientRequest: { findUnique: vi.fn(async () => ({ number: 585 })) },
    clientRequestItem: { aggregate: vi.fn(async () => ({ _sum: { quantity: 12 } })) },
    fbsTsdAssembly: { aggregate: vi.fn(async () => ({ _sum: { itemCount: 11 } })),
      findFirst: vi.fn(async () => null), updateMany: vi.fn() },
    clientMarketplaceConnection: { findUnique: vi.fn(async () => null) },
    storagePalletBox: { findMany: vi.fn(async () => []) },
  };
  const service = new MarketplaceConnectionsService(db, {} as never) as any;
  vi.spyOn(service, 'loadOwnedFbsTsdAssembly').mockImplementation(async () => task);
  vi.spyOn(service, 'assertFbsTsdLeaseVersion').mockImplementation(async t => t);
  vi.spyOn(service, 'resolveFbsTsdExpectedWarehouseId').mockResolvedValue('warehouse');
  vi.spyOn(service, 'fbsTsdReservationRows').mockImplementation(async () => reservations);
  vi.spyOn(service, 'fbsTsdReservationRowsBySku').mockImplementation(async () => new Map([['sku', reservations]]));
  vi.spyOn(service, 'releaseUntouchedFbsReservationsForScannedBox').mockResolvedValue(0);
  vi.spyOn(service, 'useRelabelingSourceForCurrentFbsTask').mockResolvedValue(null);
  vi.spyOn(service, 'switchFbsTsdAssemblyToBox').mockResolvedValue(null);
  vi.spyOn(service, 'claimFbsTsdBoxAtomically').mockResolvedValue(null);
  vi.spyOn(service, 'getFbsRequestRoute').mockResolvedValue({});
  vi.spyOn(service, 'fbsTsdNextRequestSources').mockResolvedValue([]);
  vi.spyOn(service, 'fbsTsdCompletedToday').mockResolvedValue(0);
  vi.spyOn(service, 'fbsTsdStickerHistory').mockResolvedValue([]);
  vi.spyOn(service, 'fbsTsdSourceBoxUsage').mockResolvedValue(null);
  return { service, task, db, box, reservations, user: { id: 'user', deviceCode: 'TSD-1' } };
}

describe('FBS consistent live box route', () => {
  it('shows a box with an untouched background reservation as claimable', async () => {
    const f = fixture(true);
    expect(await f.service.formatFbsTsdAssembly(f.task, f.user, '')).toMatchObject({ task: { recommendedBoxCode: f.box.code } });
  });
  it('passes a background-only reservation to the atomic physical claim', async () => {
    const f = fixture(true);
    f.service.claimFbsTsdBoxAtomically.mockResolvedValue({ ...f.task, boxId: f.box.id, boxCode: f.box.code });
    expect(await f.service.scanFbsTsdBox(f.task.id, { boxCode: f.box.code }, f.user))
      .toMatchObject({ state: 'SCAN_BARCODE', task: { scannedBoxCode: f.box.code } });
    expect(f.service.claimFbsTsdBoxAtomically).toHaveBeenCalledOnce();
  });
  it('refreshes a fully protected box without an error dialog or releasing physical work', async () => {
    const f = fixture();
    const result = await f.service.scanFbsTsdBox(f.task.id, { boxCode: f.box.code }, f.user);
    expect(result).toMatchObject({ state: 'SCAN_BOX', routeRefreshed: true, task: { recommendedBoxCode: null, scannedBoxCode: null } });
    expect(result.message).toContain('Задание сохранено');
    expect(result.message).not.toContain('другой заявк');
    expect(f.service.claimFbsTsdBoxAtomically).not.toHaveBeenCalled();
    expect(f.db.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
  });
  it('a lost atomic claim refreshes from current stock instead of throwing FBS_ROUTE_STALE', async () => {
    const f = fixture(false, 2);
    f.service.claimFbsTsdBoxAtomically.mockImplementation(async () => {
      f.db.stockBalance.findMany.mockResolvedValue([]); return null;
    });
    expect(await f.service.scanFbsTsdBox(f.task.id, { boxCode: f.box.code }, f.user))
      .toMatchObject({ state: 'SCAN_BOX', routeRefreshed: true, task: { recommendedBoxCode: null } });
  });
  it('fresh response offers the alternative free box rather than repeating the protected one', async () => {
    const f = fixture();
    f.db.stockBalance.findMany.mockResolvedValue([
      { boxId: f.box.id, box: f.box, quantity: 1 },
      { boxId: 'alternative', box: { code: 'FFL_OTHER' }, quantity: 1 },
    ]);
    const result = await f.service.scanFbsTsdBox(f.task.id, { boxCode: f.box.code }, f.user);
    expect(result.task.recommendedBoxCode).toBe('FFL_OTHER');
    expect(result.message).toContain('FFL_OTHER');
  });
  it('never invents stock from own or background reservation when balance is zero', async () => {
    const f = fixture(true, 0); f.task.reservedBoxId = f.box.id;
    expect(await f.service.formatFbsTsdAssembly(f.task, f.user, '')).toMatchObject({ task: { recommendedBoxCode: null } });
  });
  it('does not replace an actual barcode-scanning stage with stale route state after a concurrent scan', async () => {
    const f = fixture(false, 2);
    f.service.claimFbsTsdBoxAtomically.mockImplementation(async () => {
      f.task.boxId = 'new-box'; f.task.boxCode = 'FFL_NEW'; return null;
    });
    expect(await f.service.scanFbsTsdBox(f.task.id, { boxCode: f.box.code }, f.user))
      .toMatchObject({ state: 'SCAN_BARCODE', task: { scannedBoxCode: 'FFL_NEW' } });
  });
  it('still rejects a foreign-branch box', async () => {
    const f = fixture(true); f.box.warehouseId = 'other';
    await expect(f.service.scanFbsTsdBox(f.task.id, { boxCode: f.box.code }, f.user)).rejects.toThrow('другом филиале');
    expect(f.service.claimFbsTsdBoxAtomically).not.toHaveBeenCalled();
  });
  it('preserves the two old return holds from request 304 without claiming their stock', async () => {
    const f = fixture(false, 2);
    f.reservations.push({ ...f.reservations[0], taskId: 'second-return' });
    const result = await f.service.scanFbsTsdBox(f.task.id, { boxCode: f.box.code }, f.user);
    expect(result).toMatchObject({ routeRefreshed: true, task: { recommendedBoxCode: null, scannedBoxCode: null } });
    expect(f.service.claimFbsTsdBoxAtomically).not.toHaveBeenCalled();
    expect(f.db.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
  });
  it('still rejects a wrong box with zero stock when another box was assigned', async () => {
    const f = fixture(false, 0); f.task.reservedBoxCode = 'FFL_EXPECTED';
    await expect(f.service.scanFbsTsdBox(f.task.id, { boxCode: f.box.code }, f.user))
      .rejects.toThrow('нет товара');
  });
  it('does not hide a newly raised synchronization conflict during refresh', async () => {
    const f = fixture(false, 2);
    f.service.claimFbsTsdBoxAtomically.mockImplementation(async () => {
      f.task.status = 'RETURN_REQUIRED'; f.task.errorMessage = 'Нужно решение по возврату'; return null;
    });
    await expect(f.service.scanFbsTsdBox(f.task.id, { boxCode: f.box.code }, f.user))
      .rejects.toThrow('Нужно решение по возврату');
  });
});
