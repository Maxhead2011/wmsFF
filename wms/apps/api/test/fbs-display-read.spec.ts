import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const user: any = { id: 'admin', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'] };
const response = (id = 'c1') => ({ client: { id, name: id, code: id }, connected: true,
  connections: [], fetchedAt: '2026-09-16T10:00:00Z', orders: [],
  counts: { active: 0, shipped: 0, cancelled: 0, archive: 0, all: 0 },
  deliveryPlan: { destination: 'PICKUP_POINT', itemsPerCargoPlace: 2000000000, requiresCargoPlaces: true } });
function fixture() {
  const prisma: any = { clientMarketplaceConnection: { findMany: vi.fn().mockResolvedValue([
    { client: response().client }, { client: response('c2').client },
  ]) } };
  const scopes = { requireClientAccess: vi.fn(), resolveClientFilter: vi.fn().mockReturnValue({ in: ['c1', 'c2'] }) };
  const service: any = new MarketplaceConnectionsService(prisma, scopes as any);
  vi.spyOn(service, 'scopeFbsOrdersForUser').mockImplementation(async (value: any) => value);
  vi.spyOn(service, 'mergeSyncedFbsTsdRequestOrders').mockImplementation(async (_: any, value: any) => value);
  vi.spyOn(service, 'loadFbsTsdRequestOrders').mockImplementation(async (id: any) => response(id));
  vi.spyOn(service, 'loadFbsOrders').mockImplementation(() => new Promise(() => {}));
  return { service, prisma, scopes };
}

// TEST: screens must settle without waiting for WB, invoice locks or shipment reconciliation.
describe('FBS display reads', () => {
  it('reads marketplace orders without supply writes, reserves, reconciliation or billing', async () => {
    vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', 'true');
    const write = vi.fn(() => { throw new Error('Unexpected database write'); });
    const db: any = {
      client: { findUnique: vi.fn(async () => response().client) },
      clientMarketplaceConnection: { findMany: vi.fn(async () => [{ id: 'connection', marketplace: 'WILDBERRIES', accountName: 'WB' }]) },
      clientFbsBillingSettings: { findUnique: vi.fn(async () => null) },
      sku: { findMany: vi.fn(async () => []) },
      fbsSupplyPlan: { findMany: vi.fn(async () => [{ id: 'plan', connectionId: 'connection', marketplace: 'WILDBERRIES', supplyId: 'WB1' }]), update: write },
      $transaction: write,
    };
    const service: any = new MarketplaceConnectionsService(db, {} as any);
    vi.spyOn(service, 'fetchWildberriesFbsOrders').mockResolvedValue([{ id: 101, connectionId: 'connection', marketplace: 'WILDBERRIES', supplyId: 'WB1', supplierStatus: 'confirm', wbStatus: 'waiting', skus: [], warehouseId: 42 }]);
    vi.spyOn(service, 'applyFbsRelabelingStockSources').mockImplementation(async (_: any, orders: any) => orders);
    const facts = vi.spyOn(service, 'applyLocalWbShipments').mockImplementation(async (_: any, orders: any, readOnly: any) => {
      expect(readOnly).toBe(true); return orders;
    });
    vi.spyOn(service, 'loadActiveFbsOrderRequestLinks').mockResolvedValue([]);
    vi.spyOn(service, 'syncFbsPalletSortReservations').mockImplementation(async (_: any, __: any, readOnly: any) => {
      expect(readOnly).toBe(true); return new Map();
    });
    for (const name of ['syncFbsRequestsFromMarketplace', 'ensureFbsProcessingCharges']) vi.spyOn(service, name).mockImplementation(write);
    const result = await service.loadFbsOrdersUncached('c1', undefined, { readOnly: true });
    expect(result.orders).toHaveLength(1); expect(facts).toHaveBeenCalledOnce(); expect(write).not.toHaveBeenCalled();
    await service.onModuleDestroy();
  });

  it('reads the existing box/pallet reservation without allocating or releasing anything', async () => {
    const db: any = {
      client: { findUnique: vi.fn(async () => ({ storesWithoutBoxes: false })) },
      fbsTsdAssembly: { findMany: vi.fn(async () => [{ connectionId: 'connection', orderId: '101', status: 'RESERVED', reservedBoxId: 'box', reservedBoxCode: 'BOX', reservedAt: new Date('2026-09-01') }]) },
      storagePalletBox: { findMany: vi.fn(async () => [{ boxId: 'box', pallet: { code: 'PALLET', warehouseId: 'wh' } }]) },
    };
    const service: any = new MarketplaceConnectionsService(db, {} as any);
    const reservations = await service.syncFbsPalletSortReservations('c1', [{ id: '101', connectionId: 'connection', marketplace: 'WILDBERRIES' }], true);
    expect(reservations.get('connection:101')).toMatchObject({ status: 'RESERVED', boxCode: 'BOX', palletCode: 'PALLET', warehouseId: 'wh' });
    expect(db.fbsTsdAssembly.findMany).toHaveBeenCalledOnce(); await service.onModuleDestroy();
  });

  it('preserves recorded shipment facts without retrying missing physical evidence', async () => {
    const write = vi.fn(() => { throw new Error('Unexpected write'); });
    const db: any = {
      wbOrderShipment: { findMany: vi.fn(async (query: any) => query.take ? [{ assemblyId: 'a', connectionId: 'connection', orderId: '101', shippedAt: new Date('2026-09-01'), orderSnapshot: { id: '101' } }] : [{ assemblyId: 'a' }]) },
      fbsTsdAssembly: { findMany: vi.fn(async () => [{ id: 'a', connectionId: 'connection', orderId: '101' }]) },
      $transaction: write, fbsPrintJob: { findMany: write }, clientRequest: { findMany: write },
    };
    const service: any = new MarketplaceConnectionsService(db, {} as any);
    const orders = await service.applyLocalWbShipments('c1', [], true);
    expect(orders[0]).toMatchObject({ id: '101', category: 'shipped', statusLabel: 'Отгружен из ВМС' });
    expect(write).not.toHaveBeenCalled(); await service.onModuleDestroy();
  });

  it('applies the viewer scope after fetching a shared snapshot', async () => {
    const { service } = fixture();
    service.fbsOrdersCache.set('c1', { expiresAt: Date.now() + 60_000, value: response() });
    service.scopeFbsOrdersForUser.mockImplementation(async (value: any, viewer: any) => ({ ...value, orders: [{ id: viewer.id }] }));
    expect((await service.listFbsOrdersForDisplay('c1', { ...user, id: 'branch1' })).orders[0].id).toBe('branch1');
    expect((await service.listFbsOrdersForDisplay('c1', { ...user, id: 'branch2' })).orders[0].id).toBe('branch2');
    expect(service.fbsOrdersCache.get('c1').value.orders).toEqual([]); await service.onModuleDestroy();
  });
  it('returns expired data immediately and coalesces repeated refreshes', async () => {
    const { service } = fixture();
    service.fbsOrdersCache.set('c1', { expiresAt: 0, value: response() });
    const result = await service.listFbsOrdersForDisplay('c1', user, true);
    await service.listFbsOrdersForDisplay('c1', user, true);
    expect(result.sync).toMatchObject({ refreshing: true, partial: false });
    expect(result.fetchedAt).toBe(response().fetchedAt);
    await new Promise(resolve => setImmediate(resolve));
    expect(service.loadFbsOrders).toHaveBeenCalledTimes(1);
    expect(service.loadFbsOrders).toHaveBeenCalledWith('c1', undefined, { readOnly: true, billingMode: 'skip' });
    expect(service.fbsOrdersCache.get('c1').expiresAt).toBe(0);
    service.onModuleDestroy();
  });

  it('does not mistake a cold, incomplete local list for a fresh zero', async () => {
    const { service } = fixture();
    const result = await service.listFbsOrdersForDisplay('c1', user);
    expect(result.sync).toMatchObject({ refreshing: true, partial: true, lastSuccessAt: null });
    expect(result.fetchedAt).toBe('');
    service.onModuleDestroy();
  });

  it('keeps cold cabinets visible without waiting for the first blocked cabinet', async () => {
    const { service, prisma } = fixture();
    const result = await service.listFbsActiveClients(user, 'WILDBERRIES', true);
    expect(result.map((row: any) => row.client.id)).toEqual(['c1', 'c2']);
    expect(result.every((row: any) => row.sync.partial)).toBe(true);
    expect(prisma.clientMarketplaceConnection.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ clientId: { in: ['c1', 'c2'] } }),
    }));
    service.onModuleDestroy();
  });

  it('checks client access before reading caches or starting background work', async () => {
    const { service, scopes } = fixture();
    scopes.requireClientAccess.mockImplementation(() => { throw new ForbiddenException(); });
    await expect(service.listFbsOrdersForDisplay('other', user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.loadFbsOrders).not.toHaveBeenCalled();
    expect(service.loadFbsTsdRequestOrders).not.toHaveBeenCalled();
    service.onModuleDestroy();
  });
});
