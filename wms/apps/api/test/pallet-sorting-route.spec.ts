import { afterEach, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
afterEach(() => vi.unstubAllEnvs());
it('can reroute a scoped AUTO reservation without inventing a ClientRequest or calling WB', async () => {
  // TEST: background reservations do not have a real request row; sorting must not fail on them.
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
  const task = { id: 'auto-task', requestId: 'AUTO:order', status: 'WAITING_STOCK', skuId: 'sku', itemCount: 1, updatedAt: new Date(), boxId: null, barcode: null, kiz: null, sourceBarcode: null, relabelConfirmedAt: null };
  const db: any = {
    fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([task]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    stockBalance: { findMany: vi.fn().mockResolvedValue([{ boxId: 'target', quantity: 2, box: { code: 'TARGET', storagePlacement: { pallet: { code: 'PALLET' } } } }]) },
  };
  const service = Object.create(MarketplaceConnectionsService.prototype) as any;
  service.prisma = db; service.clientScopes = { requireClientAccess: vi.fn() };
  service.fbsTsdReservationRows = vi.fn().mockResolvedValue([]);
  service.withActivePalletSortBoxLock = vi.fn(async (_input, run) => run(db));
  await service.repairFbsSortingAutomaticTasks(['auto-task'], 'client', { id: 'admin', roleCodes: ['ADMIN'], activeWarehouseId: 'wh' });
  expect(db.fbsTsdAssembly.findMany.mock.calls[0][0].where).toMatchObject({ clientId: 'client', id: { in: ['auto-task'] }, requestId: { startsWith: 'AUTO:' } });
  expect(db.stockBalance.findMany.mock.calls[0][0].where).toMatchObject({ clientId: 'client', warehouseId: 'wh' });
  expect(db.fbsTsdAssembly.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'auto-task', barcode: null, kiz: null }, data: { reservedBoxId: 'target', status: 'RESERVED' } });
});
it.each([{ storesWithoutBoxes: false, count: 1 }, { storesWithoutBoxes: true, count: 1 }, { storesWithoutBoxes: false, count: 0 }])('repairs the exact sorting subset safely: %j', async ({ storesWithoutBoxes, count }) => {
  // TEST: the ordinary whole-request repair is too broad for a missing sorting source.
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
  const task = { id: 'affected', requestId: 'request', connectionId: 'connection', orderId: 'order', status: 'WAITING_STOCK', skuId: 'sku', itemCount: 1, updatedAt: new Date(), boxId: null, barcode: null, kiz: null, sourceBarcode: null, relabelConfirmedAt: null };
  const db: any = {
    clientRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'request', number: 1, type: 'OUTBOUND', status: 'IN_WORK', clientId: 'client', warehouseId: 'wh', client: { storesWithoutBoxes }, items: [], fbsOrderLinks: [{ orderId: 'order', marketplace: 'WILDBERRIES', connectionId: 'connection' }] }) },
    fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([task]), updateMany: vi.fn().mockResolvedValue({ count }), update: vi.fn().mockResolvedValue({}), createMany: vi.fn() },
    stockBalance: { findMany: vi.fn().mockResolvedValue([]), aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 5 } }) },
    clientRequestEvent: { create: vi.fn() },
  };
  const service = Object.create(MarketplaceConnectionsService.prototype) as any;
  service.prisma = db;
  service.clientScopes = { requireClientAccess: vi.fn() };
  service.getFbsRequestRoute = vi.fn().mockResolvedValue({ boxes: [], version: 'v' });
  service.fbsTsdReservationRows = vi.fn().mockResolvedValue([]);
  const repair = service.repairFbsRequestSelection('request', { id: 'admin', roleCodes: ['ADMIN'], activeWarehouseId: 'wh' }, ['affected']);
  // TEST: a concurrent task update must keep the sorting route in the retry queue.
  if (!count) { await expect(repair).rejects.toThrow('изменилось'); return; }
  await repair;
  expect(db.stockBalance.aggregate).not.toHaveBeenCalled();
  expect(db.fbsTsdAssembly.findMany).toHaveBeenCalledTimes(1);
  expect(db.fbsTsdAssembly.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ['affected'] }, requestId: 'request' }) }));
  expect(db.fbsTsdAssembly.updateMany).toHaveBeenCalledTimes(1);
  expect(db.fbsTsdAssembly.updateMany.mock.calls[0][0].where.id).toBe('affected');
  expect(db.fbsTsdAssembly.createMany).not.toHaveBeenCalled();
});
