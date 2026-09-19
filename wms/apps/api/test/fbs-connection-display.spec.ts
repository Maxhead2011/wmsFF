import { afterEach, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

function fixture() {
  const connections = ['good', 'bad'].map(id => ({ id, marketplace: 'OZON', accountName: id }));
  const db = { client: { findUnique: vi.fn().mockResolvedValue({ id: 'client', name: 'Client' }) },
    clientMarketplaceConnection: { findMany: vi.fn().mockResolvedValue(connections) } };
  const service = new MarketplaceConnectionsService(db as never, { requireClientAccess: vi.fn() } as never) as any;
  vi.spyOn(service, 'loadFbsDeliveryPlan').mockResolvedValue({ destination: 'PICKUP_POINT' });
  vi.spyOn(service, 'fetchOzonFbsOrders').mockImplementation(async (c: any) => {
    if (c.id === 'bad') throw new Error('Client-Id header value should be positive integer');
    return [{ id: 'posting-1', connectionId: c.id, marketplace: 'OZON', supplierStatus: 'awaiting_packaging', skus: [] }];
  });
  vi.spyOn(service, 'applyFbsRelabelingStockSources').mockImplementation(async (_id: any, orders: any) => orders);
  vi.spyOn(service, 'applyLocalWbShipments').mockImplementation(async (_id: any, orders: any) => orders);
  vi.spyOn(service, 'loadActiveFbsOrderRequestLinks').mockResolvedValue([]);
  vi.spyOn(service, 'syncFbsPalletSortReservations').mockResolvedValue(new Map());
  vi.spyOn(service, 'syncFbsRequestsFromMarketplace').mockResolvedValue(undefined);
  vi.spyOn(service, 'ensureFbsProcessingCharges').mockResolvedValue(new Map());
  return service;
}
afterEach(() => vi.unstubAllEnvs());

// TEST: the existing operational loader must still reject a broken cabinet even when isolation is enabled.
it('never uses incomplete upstream data for operations', async () => {
  vi.stubEnv('WMS_FBS_CONNECTION_ISOLATION', 'true');
  const service = fixture();
  await expect(service.loadFbsOrdersUncached('client')).rejects.toThrow('Client-Id');
  expect(service.syncFbsRequestsFromMarketplace).not.toHaveBeenCalled();
});

// TEST: this adapter is present on the published source, which is ahead of this legacy branch.
const hasDisplay = typeof (MarketplaceConnectionsService.prototype as any).listFbsOrdersForDisplay === 'function';
it.runIf(hasDisplay)('retains live Ozon orders on the published read-only path without syncing requests', async () => {
  vi.stubEnv('WMS_FBS_CONNECTION_ISOLATION', 'true');
  const service = fixture();
  const result = await service.loadFbsOrdersUncached('client', undefined, { readOnly: true, billingMode: 'skip' });
  expect(result.orders).toHaveLength(1);
  expect(result.orders[0]).toMatchObject({ id: 'posting-1', connectionId: 'good', category: 'active' });
  expect(result.connectionErrors).toEqual([expect.objectContaining({ connectionId: 'bad' })]);
  expect(service.syncFbsRequestsFromMarketplace).not.toHaveBeenCalled();
  expect(service.ensureFbsProcessingCharges).not.toHaveBeenCalled();
});

it.runIf(hasDisplay)('keeps sold display reads strict when the flag is off', async () => {
  vi.stubEnv('WMS_FBS_CONNECTION_ISOLATION', 'false');
  await expect(fixture().loadFbsOrdersUncached('client', undefined, { readOnly: true })).rejects.toThrow('Client-Id');
});

it.runIf(hasDisplay)('shows connection warnings only within the selected branch', async () => {
  const service = fixture();
  const value = { fetchedAt: new Date().toISOString(), connections: [{ id: 'good' }, { id: 'bad' }], orders: [],
    connectionErrors: [{ connectionId: 'bad', marketplace: 'OZON', accountName: 'bad', message: 'Cabinet unavailable' }] };
  vi.spyOn(service, 'mergeSyncedFbsTsdRequestOrders').mockImplementation(async (_id: any, response: any) => response);
  service.fbsOrdersCache.set('client', { value, expiresAt: Date.now() + 60000 });
  vi.spyOn(service, 'scopeFbsOrdersForUser').mockResolvedValue({ ...value, connections: [{ id: 'good' }] });
  const hidden = await service.listFbsOrdersForDisplay('client', {});
  expect(hidden.connectionErrors).toEqual([]);
  expect(hidden.sync.error).toBeNull();
  service.scopeFbsOrdersForUser.mockResolvedValue(value);
  const visible = await service.listFbsOrdersForDisplay('client', {}, false, true);
  expect(visible.connectionErrors).toEqual(value.connectionErrors);
  expect(visible.sync.error).toBe('Cabinet unavailable');
  expect(visible.sync.partial).toBe(true);
});
